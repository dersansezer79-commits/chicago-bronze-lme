// London Indices updater (no npm deps).
// Priority: Stooq (several variants) -> Yahoo fallback.
// Writes lme_automation/londonstock.json

import { writeFileSync } from "node:fs";

// ---------- helpers ----------
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };

  // robust split (commas outside quotes)
  const splitCSV = (line) => {
    const out = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQ = !inQ;
      } else if (ch === "," && !inQ) {
        out.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out.map(s => s.replace(/^"|"$/g, ""));
  };

  const headers = splitCSV(lines[0]).map(h => h.toLowerCase());
  const rows = lines.slice(1).map(line => {
    const cols = splitCSV(line);
    const obj = {};
    headers.forEach((h, i) => (obj[h] = cols[i] ?? ""));
    return obj;
  });
  return { headers, rows };
}

function mapStooqRows(rows) {
  const out = {};
  for (const r of rows) {
    const sym = (r.symbol || r.ticker || "").toLowerCase();
    const close = Number(r.close);
    if (sym === "ukx" || sym === "^ukx") {
      out["^FTSE"] = {
        shortName: "FTSE 100",
        price: Number.isFinite(close) ? close : null,
        source: "stooq",
      };
    } else if (sym === "ftmc" || sym === "^ftmc") {
      out["^FTMC"] = {
        shortName: "FTSE 250",
        price: Number.isFinite(close) ? close : null,
        source: "stooq",
      };
    }
  }
  return out;
}

async function fetchText(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return await res.text();
}

// ---------- sources ----------
async function fromStooq() {
  const tries = [
    "https://stooq.com/q/l/?s=ukx,ftmc&i=d",
    "https://stooq.pl/q/l/?s=ukx,ftmc&i=d",
    "https://stooq.com/q/l/?s=%5Eukx,%5Eftmc&i=d",
    "https://stooq.pl/q/l/?s=%5Eukx,%5Eftmc&i=d",
  ];

  for (const url of tries) {
    try {
      const txt = (await fetchText(url)).trim();
      const { headers, rows } = parseCSV(txt);
      const mapped = mapStooqRows(rows);
      if (Object.keys(mapped).length) return mapped;
      console.warn(`[stooq] parsed 0 rows for ${url}. First 120 chars:\n${txt.slice(0, 120)}`);
      // small pause to be nice
      await sleep(400);
    } catch (e) {
      console.warn(`[stooq] ${String(e)}`);
    }
  }
  return {};
}

const Y_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  Referer: "https://finance.yahoo.com/",
};

async function fromYahoo() {
  try {
    const url =
      "https://query1.finance.yahoo.com/v7/finance/quote?symbols=%5EFTSE,%5EFTMC";
    const r = await fetch(url, { headers: Y_HEADERS, cache: "no-store" });
    if (!r.ok) throw new Error(`Yahoo HTTP ${r.status}`);
    const js = await r.json();
    const out = {};
    for (const q of js.quoteResponse?.result ?? []) {
      const key = q.symbol;
      if (key === "^FTSE" || key === "^FTMC") {
        out[key] = {
          shortName: q.shortName,
          price: q.regularMarketPrice ?? q.postMarketPrice ?? null,
          change: q.regularMarketChange ?? null,
          changePercent: q.regularMarketChangePercent ?? null,
          source: "yahoo",
        };
      }
    }
    return out;
  } catch (e) {
    console.warn(`[yahoo] ${String(e)}`);
    return {};
  }
}

// ---------- main ----------
(async () => {
  try {
    let indices = await fromStooq();
    if (!Object.keys(indices).length) {
      console.warn("[info] Stooq returned empty, trying Yahoo…");
      indices = await fromYahoo();
    }
    const out = { as_of: new Date().toISOString(), indices };
    writeFileSync("londonstock.json", JSON.stringify(out, null, 2));
    console.log("Wrote londonstock.json with keys:", Object.keys(indices));
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
