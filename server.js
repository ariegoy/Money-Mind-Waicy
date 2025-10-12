// Money Mind backend — CommonJS build for Render

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

// limit each IP to 100 requests per 15 minutes
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false
});
app.use(limiter);

// serve front-end
app.use(express.static("public"));

/* ---------- API ROUTES ---------- */

// health check
app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "Money Mind" });
});

// live quotes
app.get("/api/quotes", async (req, res) => {
  try {
    const { symbols } = req.query;
    if (!symbols) return res.status(400).json({ error: "symbols required" });

    const list = symbols.split(",").map(s => s.trim()).slice(0, 40);

    const results = await Promise.all(
      list.map(async sym => {
        const r = await fetch(
          `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${FINNHUB_KEY}`
        );
        if (!r.ok) return { symbol: sym, error: true };
        const j = await r.json();
        return { symbol: sym, price: j.c };
      })
    );

    res.json({ data: results });
  } catch (e) {
    console.error("Quote fetch failed:", e);
    res.status(500).json({ error: "quote_failed" });
  }
});

// send index.html for anything else (SPA fallback)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`✅ Money Mind backend running on port ${PORT}`);
});
