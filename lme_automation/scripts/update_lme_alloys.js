// Auto-update six LME base metals into lme_automation/lme.json
// Metals: CU, SN, NI, AL, ZN, PB
// Node >= 18 (native fetch). No npm deps.
// Strategy: (1) Yahoo page via r.jina.ai proxy → scrape regularMarketPrice.raw
//           (2) Stooq CSV fallback
//           (3) Keep previous value if all sources fail
// Units: usd_per_tonne. CU from USD/lb → USD/tonne using 2204.6226.

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const TARGET = "lme_automation/lme.json";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36";
const LB_TO_TONNE = 2204.62262185;

// --- Metal config ---
// yahoo: list of page symbols we can open at https://finance.yahoo.com/quote/SYMBOL
// stooq: CSV symbols (https://stooq.com/q/l/?s=SYMBOL&i=d)
// NOTE: these symbols are “best-effort” public proxies for LME-ish pricing.
// If you find better public symbols, just add them to the arrays below.
const METALS = {
  CU: {
    yahoo: ["HG=F"],           // Copper futures (USD/lb)
    stooq: ["hg.f"],
    convert: (p) => p * LB_TO_TONNE,
    min: 3000, max: 15000,
  },
  AL: {
    yahoo: ["ALI=F"],          // Aluminum (often USD/tonne)
    stooq: ["ali.f", "al.f"],
    convert: (p) => p,
    min: 1500, max: 5000,
  },
  ZN: {
    yahoo: ["ZNC=F"],          // Zinc
    stooq: ["znc.f", "zn.f"],
    convert: (p) => p,
    min: 1500, max: 6000,
  },
  PB: {
    yahoo: ["LED=F", "PB=F"],  // Lead (different listings)
    stooq: ["lead.f", "pb.f"],
    convert: (p) => p,
    min: 1500, max: 3500,
  },
  NI: {
    yahoo: ["NI=F", "NIC=F", "NICKEL=F"], // Nickel candidates
    stooq: ["ni.f", "nickel.f"],
    convert: (p) => p,
    min: 10000, max: 60000,
  },
  SN: {
    yahoo: ["TIN=F"],          // Tin
    stooq: ["tin.f", "sn.f"],
    convert: (p) => p,
    min: 10000, max: 60000,
  },
};

function log(...a){ console.log("[alloys]", ...a); }

function loadCurrent() {
  try {
    if (existsSync(TARGET)) {
      const js = JSON.parse(readFileSync(TARGET, "utf8") || "{}");
      if (js && typeof js === "object") return js;
    }
  } catch {}
  return {};
}

// --- Yahoo via proxy: fetch HTML, scrape "regularMarketPrice":{"raw":...} ---
async function fetchYahooPagePrice(symbol) {
  const page = `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`;
  const viaProxy = `https://r.jina.ai/http://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`;
  const r = await fetch(viaProxy, { headers: { "User-Agent": UA, "Accept": "text/plain" }, cache: "no-store" });
  if (!r.ok) throw new Error(`Yahoo page ${symbol} HTTP ${r.status}`);
  const text = await r.text();

  // Find the embedded JSON price quickly
  const m = text.match(/"regularMarketPrice"\s*:\s*\{\s*"raw"\s*:\s*([0-9.]+)/);
  if (!m) throw new Error(`Yahoo page ${symbol} no price match`);
  const price = Number(m[1]);
  if (!Number.isFinite(price)) throw new Error(`Yahoo page ${symbol} price NaN`);
  return price;
}

// --- Stooq CSV ---
function parseCSV(text) {
  const rows = text.trim().split(/\r?\n/).filter(Boolean);
  if (rows.length < 2) return [];
  const split = (s) => {
    const out = []; let buf="", q=false;
    for (const ch of s) {
      if (ch === '"') q = !q;
      else if (ch === "," && !q) { out.push(buf); buf=""; }
      else buf += ch;
    }
    out.push(buf);
    return out.map(x => x.replace(/^"|"$/g, ""));
  };
  const headers = split(rows[0]).map(h => h.toLowerCase());
  return rows.slice(1).map(line => {
    const cols = split(line); const o = {};
    headers.forEach((h,i)=> o[h] = cols[i] ?? "");
    return o;
  });
}

async function fetchStooqPrice(symbol) {
  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(symbol)}&i=d`;
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "text/csv" }, cache: "no-store" });
  if (!r.ok) throw new Error(`Stooq ${symbol} HTTP ${r.status}`);
  const rows = parseCSV(await r.text());
  if (!rows.length) throw new Error(`Stooq ${symbol} empty CSV`);
  const close = Number(rows[0]["close"]);
  if (!Number.isFinite(close)) throw new Error(`Stooq ${symbol} close NaN`);
  return close;
}

function plausible(v, min, max){ return Number.isFinite(v) && v >= min && v <= max; }

async function resolveMetal(code, current){
  const cfg = METALS[code];

  // A) Yahoo via proxy
  for (const sym of cfg.yahoo) {
    try {
      const p = await fetchYahooPagePrice(sym);
      const v = cfg.convert(p);
      if (plausible(v, cfg.min, cfg.max)) return v;
      log(code, sym, "out-of-range", v);
    } catch(e){ log(code, "Yahoo fail", sym, String(e)); }
  }

  // B) Stooq CSV
  for (const sym of cfg.stooq) {
    try {
      const p = await fetchStooqPrice(sym);
      const v = cfg.convert(p);
      if (plausible(v, cfg.min, cfg.max)) return v;
      log(code, sym, "out-of-range", v);
    } catch(e){ log(code, "Stooq fail", sym, String(e)); }
  }

  // C) Keep previous if any
  const prev = current?.metals?.[code]?.usd_per_tonne;
  if (Number.isFinite(prev)) { log(code, "kept previous", prev); return prev; }

  log(code, "no data");
  return null;
}

(async () => {
  try {
    const current = loadCurrent();
    const result = { as_of: new Date().toISOString(), metals: { ...(current.metals||{}) } };

    for (const code of Object.keys(METALS)) {
      const v = await resolveMetal(code, current);
      if (Number.isFinite(v)) result.metals[code] = { usd_per_tonne: v };
    }

    writeFileSync(TARGET, JSON.stringify(result, null, 2));
    log("wrote", TARGET, "->", Object.keys(result.metals));
  } catch (e) {
    console.error("update_lme_alloys failed:", e);
    process.exit(1);
  }
})();
