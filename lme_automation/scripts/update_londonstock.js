// ESM + native fetch (Node 18+) — writes londonstock.json
import { writeFileSync } from "node:fs";

const symbols = ["^FTSE", "^FTMC"];
const url =
  "https://query1.finance.yahoo.com/v7/finance/quote?symbols=" +
  encodeURIComponent(symbols.join(","));

try {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
  const js = await res.json();

  const map = {};
  for (const q of js.quoteResponse?.result ?? []) {
    map[q.symbol] = {
      shortName: q.shortName,
      price: q.regularMarketPrice ?? q.postMarketPrice ?? null,
      change: q.regularMarketChange ?? null,
      changePercent: q.regularMarketChangePercent ?? null
    };
  }

  const out = { as_of: new Date().toISOString(), indices: map };
  writeFileSync("londonstock.json", JSON.stringify(out, null, 2));
  console.log("Wrote londonstock.json");
} catch (e) {
  console.error(e);
  process.exit(1);
}
