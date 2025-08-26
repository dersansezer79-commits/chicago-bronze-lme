// Update FTSE 100 (^FTSE) and FTSE 250 (^FTMC) -> londonstock.json
import { writeFileSync } from "node:fs";

const YAHOO_URL = (symbols) =>
  "https://query1.finance.yahoo.com/v7/finance/quote?symbols=" +
  encodeURIComponent(symbols.join(","));

const Y_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  Referer: "https://finance.yahoo.com/",
};

async function fetchYahoo(symbols) {
  const res = await fetch(YAHOO_URL(symbols), { headers: Y_HEADERS, cache: "no-store" });
  if (!res.ok) throw new Error("Yahoo HTTP " + res.status);
  const js = await res.json();
  const out = {};
  for (const q of js.quoteResponse?.result ?? []) {
    out[q.symbol] = {
      shortName: q.shortName,
      price: q.regularMarketPrice ?? q.postMarketPrice ?? null,
      change: q.regularMarketChange ?? null,
      changePercent: q.regularMarketChangePercent ?? null,
      source: "yahoo",
    };
  }
  return out;
}

// very light fallback: Stooq daily CSV (delayed)
// ukx = FTSE100, ftmc = FTSE250
async function fetchStooq() {
  const map = { "^FTSE": "ukx", "^FTMC": "ftmc" };
  const out = {};
  for (const [sym, stq] of Object.entries(map)) {
    const url = `https://stooq.com/q/l/?s=${stq}&i=d`;
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) continue;
    const txt = await r.text(); // e.g., "symbol,date,time,open,high,low,close,volume\nukx,2025-08-26,15:00,...."
    const line = txt.split("\n")[1]?.trim();
    const close = line?.split(",")?.[6];
    const price = close ? Number(close) : null;
    out[sym] = {
      shortName: sym === "^FTSE" ? "FTSE 100" : "FTSE 250",
      price,
      change: null,
      changePercent: null,
      source: "stooq",
    };
  }
  return out;
}

try {
  const symbols = ["^FTSE", "^FTMC"];
  let data;
  try {
    data = await fetchYahoo(symbols);
  } catch (e) {
    console.warn(String(e) + " — falling back to Stooq");
    data = await fetchStooq();
  }
  const out = { as_of: new Date().toISOString(), indices: data };
  writeFileSync("londonstock.json", JSON.stringify(out, null, 2));
  console.log("Wrote londonstock.json");
} catch (e) {
  console.error(e);
  process.exit(1);
}
