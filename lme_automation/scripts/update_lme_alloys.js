// Auto-update six LME base metals into lme_automation/lme.json
// Metals: CU, SN, NI, AL, ZN, PB
// - No npm deps; Node >= 18 (native fetch)
// - Yahoo first, Stooq CSV fallback
// - All outputs are USD per metric tonne (usd_per_tonne)
// - If a fetch fails, keeps the previous value and logs why

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const TARGET = "lme_automation/lme.json";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36";

// 1 lb = 0.45359237 kg -> 2204.62262185 lb per tonne
const LB_TO_TONNE = 2204.62262185;

// Configure symbol candidates + unit/conversion + plausibility ranges
// (If a Yahoo symbol changes, you only need to tweak the array below.)
const METALS = {
  CU: {
    yahoo: ["HG=F"],             // COMEX copper (USD/lb)
    stooq: ["hg.f"],             // fallback guess
    convert: (p) => p * LB_TO_TONNE,
    min: 3000, max: 15000,
  },
  AL: {
    yahoo: ["ALI=F"],            // usually USD/tonne
    stooq: ["ali.f", "al.f"],
    convert: (p) => p,
    min: 1500, max: 5000,
  },
  ZN: {
    yahoo: ["ZNC=F"],
    stooq: ["zn.f", "znc.f"],
    convert: (p) => p,
    min: 1500, max: 6000,
  },
  PB: {
    yahoo: ["PB=F", "LED=F"],    // try a few
    stooq: ["pb.f", "lead.f"],
    convert: (p) => p,
    min: 1500, max: 3500,
  },
  NI: {
    yahoo: ["NIC=F", "NI=F", "NICKEL=F"], // candidates
    stooq: ["ni.f", "nickel.f"],
    convert: (p) => p,
    min: 10000, max: 60000,
  },
  SN: {
    yahoo: ["TIN=F"],
    stooq: ["tin.f", "sn.f"],
    convert: (p) => p,
    min: 10000, max: 60000,
  },
};

function log(...args) { console.log("[alloys]", ...args); }

function loadCurrent() {
  try {
    if (existsSync(TARGET)) {
      const s = readFileSync(TARGET, "utf8");
      const js = JSON.parse(s || "{}");
      return js && typeof js === "object" ? js : {};
    }
  } catch {}
  return {};
}

async function fetchYahoo(sym) {
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(sym)}`;
  const r = await fetch(url, {
    headers: { "User-Agent": UA, "Accept": "application/json, text/plain,*/*" },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`Yahoo ${sym} HTTP ${r.status}`);
  const js = await r.json();
  const q = js?.quoteResponse?.result?.[0];
  const price = q?.regularMarketPrice ?? q?.postMarketPrice ?? null;
  if (price == null) throw new Error(`Yahoo ${sym} returned null`);
  return Number(price);
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const split = (s) => {
    const out = []; let buf = "", inQ = false;
    for (const ch of s) {
      if (ch === '"') inQ = !inQ;
      else if (ch === "," && !inQ) { out.push(buf); buf = ""; }
      else buf += ch;
    }
    out.push(buf);
    return out.map(v => v.replace(/^"|"$/g, ""));
  };
  const headers = split(lines[0]).map(h => h.toLowerCase());
  const rows = lines.slice(1).map(line => {
    const cols = split(line);
    const row = {};
    headers.forEach((h, i) => row[h] = cols[i] ?? "");
    return row;
  });
  return rows;
}

async function fetchStooq(sym) {
  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(sym)}&i=d`;
  const r = await fetch(url, {
    headers: { "User-Agent": UA, "Accept": "text/csv,*/*;q=0.8" },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`Stooq ${sym} HTTP ${r.status}`);
  const rows = parseCSV(await r.text());
  if (!rows.length) throw new Error(`Stooq ${sym} empty CSV`);
  const close = Number(rows[0]["close"]);
  if (!Number.isFinite(close)) throw new Error(`Stooq ${sym} close NaN`);
  return close;
}

function plausible(v, min, max) {
  return Number.isFinite(v) && v >= min && v <= max;
}

async function updateOne(code, current) {
  const cfg = METALS[code];
  if (!cfg) return null;

  // Try Yahoo candidates
  for (const sym of cfg.yahoo) {
    try {
      const p = await fetchYahoo(sym);
      const t = cfg.convert(p);
      if (plausible(t, cfg.min, cfg.max)) return t;
      log(code, sym, "out of range:", t);
    } catch (e) { log(code, "Yahoo fail", sym, String(e)); }
  }

  // Fallback Stooq
  for (const sym of cfg.stooq) {
    try {
      const p = await fetchStooq(sym);
      const t = cfg.convert(p);
      if (plausible(t, cfg.min, cfg.max)) return t;
      log(code, sym, "out of range:", t);
    } catch (e) { log(code, "Stooq fail", sym, String(e)); }
  }

  // Keep previous if available
  const prev = current?.metals?.[code]?.usd_per_tonne;
  if (Number.isFinite(prev)) {
    log(code, "kept previous:", prev);
    return prev;
  }

  log(code, "no data");
  return null;
}

(async () => {
  try {
    const current = loadCurrent();
    const result = {
      as_of: new Date().toISOString(),
      metals: { ...(current.metals || {}) },
    };

    // Update each metal
    for (const code of Object.keys(METALS)) {
      const v = await updateOne(code, current);
      if (Number.isFinite(v)) result.metals[code] = { usd_per_tonne: v };
    }

    writeFileSync(TARGET, JSON.stringify(result, null, 2));
    log("wrote", TARGET, "->", Object.keys(result.metals));
  } catch (e) {
    console.error("update_lme_alloys failed:", e);
    process.exit(1);
  }
})();
