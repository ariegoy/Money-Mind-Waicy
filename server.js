import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const app = express();
const PORT = process.env.PORT || 3000;
const FINNHUB_KEY = process.env.FINNHUB_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const __dirname = dirname(fileURLToPath(import.meta.url));

app.use(cors());
app.use(express.json());

// ✅ serve the front-end files
app.use(express.static(join(__dirname, "public")));

/* ----------------- Finnhub: live quotes ----------------- */
// GET /api/quotes?symbols=AAPL,VOO,VTI
app.get("/api/quotes", async (req, res) => {
  try {
    const { symbols } = req.query;
    if (!symbols) return res.status(400).json({ error: "symbols required" });
    const list = symbols.split(",").map(s => s.trim());
    const results = await Promise.all(
      list.map(async sym => {
        const r = await fetch(
          `https://finnhub.io/api/v1/quote?symbol=${sym}&token=${FINNHUB_KEY}`
        );
        const j = await r.json();
        return { symbol: sym, price: j.c };
      })
    );
    res.json({ data: results });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "quote_failed" });
  }
});

/* ----------------- OpenAI: AI coach ----------------- */
// POST /api/coach { prompt, amount, category }
app.post("/api/coach", async (req, res) => {
  try {
    if (!OPENAI_API_KEY)
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });

    const { prompt, amount, category } = req.body || {};
    const content = `You are a concise financial coach. Amount: ${amount}. Category: ${category}.
Prompt: ${prompt}. Give one actionable suggestion and one motivational reason.`;

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are Money Mind Coach." },
          { role: "user", content }
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

/* ----------------- Catch-all route ----------------- */
app.get("*", (req, res) => {
  res.sendFile(join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`✅ Money Mind server running on port ${PORT}`);
});
