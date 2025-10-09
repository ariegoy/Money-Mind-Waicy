import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());

// Endpoint: /api/quotes?symbols=AAPL,VOO,VTI
app.get("/api/quotes", async (req, res) => {
  const { symbols } = req.query;
  if (!symbols) return res.status(400).json({ error: "symbols required" });

  const list = symbols.split(",").map(s => s.trim());
  try {
    const results = await Promise.all(
      list.map(async sym => {
        const r = await fetch(
          `https://finnhub.io/api/v1/quote?symbol=${sym}&token=${process.env.FINNHUB_KEY}`
        );
        const j = await r.json();
        return { symbol: sym, price: j.c };
      })
    );
    res.json({ data: results });
  } catch (e) {
    res.status(500).json({ error: "quote_failed", detail: String(e) });
  }
});

app.listen(3000, () => console.log("Proxy running on port 3000"));
