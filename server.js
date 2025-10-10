import express from "express";
import cors from "cors";
import compression from "compression";
import rateLimit from "express-rate-limit";
import fetch from "node-fetch";
import morgan from "morgan";
import NodeCache from "node-cache";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// ---------- Firestore (admin SDK) ----------
import admin from "firebase-admin";
const svcJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!svcJson) {
  console.warn("⚠ FIREBASE_SERVICE_ACCOUNT_JSON not set — Firestore endpoints will be disabled.");
}
if (svcJson && !admin.apps.length) {
  const creds = JSON.parse(svcJson);
  admin.initializeApp({ credential: admin.credential.cert(creds) });
}
const db = admin.apps.length ? admin.firestore() : null;

// ---------- App setup ----------
const app = express();
const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const FINNHUB_KEY = process.env.FINNHUB_KEY || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(compression());
app.use(morgan("tiny"));
app.use(express.static(join(__dirname, "public")));

const limiter = rateLimit({ windowMs: 60 * 1000, max: 90 });
app.use("/api/", limiter);

// Tiny in-memory cache for quotes
const cache = new NodeCache({ stdTTL: 300 }); // 5 min

// ---------- Quotes proxy (Finnhub) ----------
// GET /api/quotes?symbols=AAPL,VOO,VTI,BTC-USD,XAU/USD
app.get("/api/quotes", async (req, res) => {
  try {
    const { symbols } = req.query;
    if (!symbols) return res.status(400).json({ error: "symbols required" });
    const list = symbols.split(",").map(s => s.trim()).slice(0, 40);

    const results = await Promise.all(list.map(async (sym) => {
      const key = `q:${sym}`;
      const hit = cache.get(key);
      if (hit) return hit;
      const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${FINNHUB_KEY}`;
      const r = await fetch(url);
      if (!r.ok) return { symbol: sym, error: true };
      const j = await r.json(); // { c, o, h, l, pc, t }
      const data = { symbol: sym, price: j.c, ts: j.t };
      cache.set(key, data);
      return data;
    }));

    res.json({ data: results });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "quotes_failed" });
  }
});

// ---------- AI Coach (OpenAI) ----------
// POST /api/coach { prompt, amount, category }
app.post("/api/coach", async (req, res) => {
  try {
    if (!OPENAI_API_KEY) return res.status(500).json({ error: "no_openai_key" });
    const { prompt, amount, category } = req.body || {};

    const userPrompt =
`You are a concise, supportive financial coach for teens.
Amount saved: ${amount ?? "unknown"}, Category: ${category ?? "unknown"}.
Question: ${prompt ?? "What should I do with this money?"}
In 2 short sentences: 1) specific action (save/invest/debt), 2) motivational reason.
Educational examples only.`;

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are Money Mind Coach. Be clear, kind, and safe." },
          { role: "user", content: userPrompt }
        ],
        max_tokens: 160,
        temperature: 0.7
      })
    });
    const j = await r.json();
    const answer = j?.choices?.[0]?.message?.content?.trim() || "Save it toward your goal.";
    res.json({ answer });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "coach_failed" });
  }
});

// ---------- Firestore helpers ----------
async function incCommunity(amount) {
  if (!db) return;
  const ref = db.collection("stats").doc("community");
  await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    const cur = snap.exists ? (snap.data().totalSaved || 0) : 0;
    t.set(ref, { totalSaved: cur + amount }, { merge: true });
  });
}

// ---------- Save (records a save, updates user + leaderboard + community) ----------
// POST /api/save { userId, name, region, compId, amount, category, note }
app.post("/api/save", async (req, res) => {
  try {
    if (!db) return res.status(500).json({ error: "firestore_not_configured" });
    const { userId, name, region = "NA", compId = "region", amount, category, note } = req.body || {};
    if (!userId || !name || !amount) return res.status(400).json({ error: "userId, name, amount required" });

    const now = Date.now();
    // 1) save entry
    await db.collection("saves").add({ userId, name, region, compId, amount, category, note, ts: now });

    // 2) user totals/score
    const uref = db.collection("users").doc(userId);
    await db.runTransaction(async (t) => {
      const u = await t.get(uref);
      const tot = u.exists ? (u.data().totalSaved || 0) : 0;
      const scr = u.exists ? (u.data().score || 0) : 0;
      t.set(uref, { name, region, totalSaved: tot + amount, score: scr + Math.round(amount) }, { merge: true });
    });

    // 3) competition member score
    const cref = db.collection("competitions").doc(compId).collection("members").doc(userId);
    await db.runTransaction(async (t) => {
      const m = await t.get(cref);
      const prev = m.exists ? (m.data().score || 0) : 0;
      t.set(cref, { name, region, score: prev + Math.round(amount), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    });

    // 4) community total
    await incCommunity(amount);

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "save_failed" });
  }
});

// ---------- Join competition ----------
// POST /api/competition/join { userId, name, region, compId }
app.post("/api/competition/join", async (req, res) => {
  try {
    if (!db) return res.status(500).json({ error: "firestore_not_configured" });
    const { userId, name, region = "NA", compId = "region" } = req.body || {};
    if (!userId || !name) return res.status(400).json({ error: "userId and name required" });

    await db.collection("users").doc(userId).set({ name, region }, { merge: true });
    await db.collection("competitions").doc(compId).collection("members").doc(userId)
      .set({ name, region, score: 0, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "join_failed" });
  }
});

// ---------- Leaderboard ----------
// GET /api/competition/leaderboard?compId=region&limit=10
app.get("/api/competition/leaderboard", async (req, res) => {
  try {
    if (!db) return res.status(500).json({ error: "firestore_not_configured" });
    const compId = req.query.compId || "region";
    const lim = Math.min(parseInt(req.query.limit || "10", 10), 50);
    const snap = await db.collection("competitions").doc(compId).collection("members")
      .orderBy("score", "desc").limit(lim).get();
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ data: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "leaderboard_failed" });
  }
});

// ---------- Community total ----------
// GET /api/community
app.get("/api/community", async (req, res) => {
  try {
    if (!db) return res.status(500).json({ error: "firestore_not_configured" });
    const doc = await db.collection("stats").doc("community").get();
    const totalSaved = doc.exists ? (doc.data().totalSaved || 0) : 0;
    res.json({ totalSaved });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "community_failed" });
  }
});

// ---------- SPA catch-all ----------
app.get("*", (req, res) => {
  res.sendFile(join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`✅ Money Mind backend live on port ${PORT}`);
});
