// Money Mind backend — CommonJS, runs cleanly on Render/Node
const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;
const FINNHUB_KEY = process.env.FINNHUB_KEY || "";

app.use(cors());
app.use(compression());
app.use(express.json());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true }));

// serve static
app.use(express.static("public"));

// health
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// live quotes (Finnhub proxy)
app.get("/api/quotes", async (req, res) => {
  try {
    const { symbols } = req.query;
    if (!symbols) return res.status(400).json({ error: "symbols required" });
    const list = symbols.split(",").map(s => s.trim()).slice(0, 40);
    const results = await Promise.all(
      list.map(async sym => {
        const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${FINNHUB_KEY}`);
        if (!r.ok) return { symbol: sym, error: true };
        const j = await r.json();
        return { symbol: sym, price: j.c };
      })
    );
    res.json({ data: results });
  } catch (e) {
    console.error("quote_failed", e);
    res.status(500).json({ error: "quote_failed" });
  }
});

// SPA fallback
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => console.log(`✅ Money Mind backend running on http://localhost:${PORT}`));
