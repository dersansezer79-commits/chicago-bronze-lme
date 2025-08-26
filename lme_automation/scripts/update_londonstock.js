// Robust FTSE fetch -> londonstock.json
import { writeFileSync } from "node:fs";

const Y_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  Referer: "https://finance.yahoo.com/",
};

async function fetchYahoo(symbols) {
  const url =
    "https://query1.finance.yahoo.com/v7/finance/quote?symbols=" +
    encodeURIComponent(symbols.join(","));
  const res = await fetch(url, { headers: Y_HEADERS, cache: "no-store" });
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

// Stooq fallback – request both in one call, parse safely
async function fetchStooq() {
  // ukx = FTSE 100, ftmc = FTSE 250
  const res = await fetch("https://stooq.com/q/l/?s=ukx,ftmc&i=d", { cache: "no-store" });
  if (!res.ok) throw new Error("Stooq HTTP " + res.status);
  const txt = (await res.text()).trim();
  // CSV header + one line per symbol
  // symbol,date,time,open,high,low,close,volume
  const lines = txt.split(/\r?\n/).filter(Boolean);
  const header = lines[0]?.split(",") ?? [];
  const idx = Object.fromEntries(header.map((h, i) => [h.toLowerCase(), i]));

  const out = {};
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const sym = cols[idx.symbol]?.toLowerCase();
    const close = cols[idx.close] ? Number(cols[idx.close]) : null;
    if (sym === "ukx") {
      out["^FTSE"] = {
        shortName: "FTSE 100",
        price: isFinite(close) ? close : null,
        change: null,
        changePercent: null,
        source: "stooq",
      };
    } else if (sym === "ftmc") {
      out["^FTMC"] = {
        shortName: "FTSE 250",
        price: isFinite(close) ? close : null,
        change: null,
        changePercent: null,
        source: "stooq",
      };
    }
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
