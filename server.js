// Money Mind backend — Node/Express version

import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import compression from "compression";
import rateLimit from "express-rate-limit";

const app = express();
const PORT = process.env.PORT || 10000;
const FINNHUB_KEY = process.env.FINNHUB_KEY || "";

app.use(cors());
app.use(compression());
app.use(express.json());

// Simple rate-limit: 100 requests per 15 minutes per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false
});
app.use(limiter);

// Serve front-end from /public
app.use(express.static("public"));

/* ----------------  API ROUTES  ---------------- */

// Health check
app.get("/api/health", (req, res) => res.json({ ok: true, service: "Money Mind" }));

// Live quotes endpoint
app.get("/api/quotes", async (req, res) => {
  try {
    const symbols = req.query.symbols;
    if (!symbols) return res.status(400).json({ error: "symbols required" });

    const list = symbols.split(",").map(s => s.trim()).slice(0, 40);

    const results = await Promise.all(
      list.map(async sym => {
        const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${FINNHUB_KEY}`;
        const r = await fetch(url);
        if (!r.ok) return { symbol: sym, error: true };
        const j = await r.json();
        return { symbol: sym, price: j.c };
      })
    );

    res.json({ data: results });
  } catch (err) {
    console.error("Quote error:", err);
    res.status(500).json({ error: "quote_failed" });
  }
});

// Catch-all: serve index.html for any unknown route
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));

app.get("*", (req, res) => {
  res.sendFile(join(__dirname, "public", "index.html"));
});

/* ----------------  START SERVER  ---------------- */

app.listen(PORT, () => {
  console.log(`✅ Money Mind backend running on port ${PORT}`);
});
