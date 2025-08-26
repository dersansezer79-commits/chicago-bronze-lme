// Update 6 LME-style metals into lme_automation/lme.json
// Sources (in order): Investing.com page (via r.jina.ai) → Yahoo page (via r.jina.ai) → Stooq CSV
// Outputs USD/tonne for: CU, AL, ZN, PB, NI, SN. Keeps previous if all sources fail.
// Node >= 18, no npm deps.

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const TARGET = "lme_automation/lme.json";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36";
const LB_TO_TONNE = 2204.62262185;

const METALS = {
  CU: {
    investingSlug: "copper",          // Investing.com → USD/lb typically
    yahoo: ["HG=F"],
    stooq: ["hg.f"],
    convertFromInvesting: (p, pageText) => {
      // If page hints 'lb', convert; otherwise assume already per tonne
      const isLb = /\b(lb|pound)\b/i.test(pageText);
      return isLb ? p * LB_TO_TONNE : p;
    },
    convertFromYahoo: (p) => p * LB_TO_TONNE, // HG=F is USD/lb
    convertFromStooq: (p) => p * LB_TO_TONNE, // hg.f is USD/lb
    min: 3000, max: 15000,
  },
  AL: {
    investingSlug: "aluminum",        // Usually USD/tonne
    yahoo: ["ALI=F"],
    stooq: ["ali.f", "al.f"],
    convertFromInvesting: (p) => p,
    convertFromYahoo: (p) => p,       // ALI=F often already per tonne
    convertFromStooq: (p) => p,
    min: 1500, max: 5000,
  },
  ZN: {
    investingSlug: "zinc",
    yahoo: ["ZNC=F"],
    stooq: ["znc.f", "zn.f"],
    convertFromInvesting: (p) => p,
    convertFromYahoo: (p) => p,
    convertFromStooq: (p) => p,
    min: 1500, max: 6000,
  },
  PB: {
    investingSlug: "lead",
    yahoo: ["LED=F","PB=F"],
    stooq: ["lead.f","pb.f"],
    convertFromInvesting: (p) => p,
    convertFromYahoo: (p) => p,
    convertFromStooq: (p) => p,
    min: 1500, max: 3500,
  },
  NI: {
    investingSlug: "nickel",
    yahoo: ["NICKEL=F","NI=F","NIC=F"],
    stooq: ["nickel.f","ni.f"],
    convertFromInvesting: (p) => p,
    convertFromYahoo: (p) => p,
    convertFromStooq: (p) => p,
    min: 10000, max: 60000,
  },
  SN: {
    investingSlug: "tin",
    yahoo: ["TIN=F"],
    stooq: ["tin.f","sn.f"],
    convertFromInvesting: (p) => p,
    convertFromYahoo: (p) => p,
    convertFromStooq: (p) => p,
    min: 10000, max: 60000,
  },
};

function log(...a){ console.log("[alloys]", ...a); }
function plausible(v,min,max){ return Number.isFinite(v) && v>=min && v<=max; }
function parseNum(s){ return Number(String(s).replace(/[, ]/g,"")); }

function loadCurrent(){
  try {
    if (existsSync(TARGET)) {
      const js = JSON.parse(readFileSync(TARGET, "utf8") || "{}");
      if (js && typeof js === "object") return js;
    }
  } catch {}
  return {};
}

// -------- Investing.com via r.jina.ai --------
async function fetchInvestingPage(slug){
  const url = `https://r.jina.ai/http://www.investing.com/commodities/${slug}`;
  const r = await fetch(url, { headers:{ "User-Agent": UA, "Accept":"text/plain" }, cache:"no-store" });
  if (!r.ok) throw new Error(`Investing ${slug} HTTP ${r.status}`);
  return await r.text();
}
function scrapeInvestingPrice(pageText){
  // Try a few common patterns found in their preloaded JSON / markup
  // 1) "last" : "9,605.50"
  let m = pageText.match(/"last"\s*:\s*"([0-9.,]+)"/);
  if (m) return parseNum(m[1]);
  // 2) "last_price":{"value":"9605.5"
  m = pageText.match(/"last_price"\s*:\s*\{\s*"value"\s*:\s*"([0-9.,]+)"/i);
  if (m) return parseNum(m[1]);
  // 3) data-test="instrument-price-last">9,605.50<
  m = pageText.match(/data-test="instrument-price-last"[^>]*>\s*([0-9.,]+)\s*</i);
  if (m) return parseNum(m[1]);
  // 4) Fallback: first big-looking number
  m = pageText.match(/([0-9]{3,3}[0-9.,]+)/);
  if (m) return parseNum(m[1]);
  throw new Error("no price in Investing page");
}

// -------- Yahoo page via r.jina.ai --------
async function fetchYahooPage(symbol){
  const url = `https://r.jina.ai/http://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`;
  const r = await fetch(url, { headers:{ "User-Agent": UA, "Accept":"text/plain" }, cache:"no-store" });
  if (!r.ok) throw new Error(`Yahoo page ${symbol} HTTP ${r.status}`);
  return await r.text();
}
function scrapeYahooPagePrice(text){
  const m = text.match(/"regularMarketPrice"\s*:\s*\{\s*"raw"\s*:\s*([0-9.]+)/);
  if (!m) throw new Error("no regularMarketPrice");
  return Number(m[1]);
}

// -------- Stooq CSV --------
function parseCSV(text){
  const rows = text.trim().split(/\r?\n/).filter(Boolean);
  if (rows.length<2) return [];
  const split = (s)=>{ const out=[]; let buf="",q=false;
    for(const ch of s){ if(ch==='"') q=!q; else if(ch===',' && !q){ out.push(buf); buf=""; } else buf+=ch; }
    out.push(buf); return out.map(x=>x.replace(/^"|"$/g,""));
  };
  const headers = split(rows[0]).map(h=>h.toLowerCase());
  return rows.slice(1).map(line=>{ const cols=split(line); const o={}; headers.forEach((h,i)=>o[h]=cols[i]??""); return o; });
}
async function fetchStooqPrice(symbol){
  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(symbol)}&i=d`;
  const r = await fetch(url, { headers:{ "User-Agent": UA, "Accept":"text/csv" }, cache:"no-store" });
  if (!r.ok) throw new Error(`Stooq ${symbol} HTTP ${r.status}`);
  const rows = parseCSV(await r.text());
  if (!rows.length) throw new Error(`Stooq ${symbol} empty CSV`);
  const close = Number(rows[0]["close"]);
  if (!Number.isFinite(close)) throw new Error(`Stooq ${symbol} close NaN`);
  return close;
}

// -------- Resolve one metal --------
async function resolveMetal(code, current){
  const cfg = METALS[code];

  // A) Investing page
  try {
    const page = await fetchInvestingPage(cfg.investingSlug);
    const p = scrapeInvestingPrice(page);
    const v = cfg.convertFromInvesting(p, page);
    if (plausible(v, cfg.min, cfg.max)) return v;
    log(code, "Investing out-of-range", v);
  } catch(e){ log(code, "Investing fail", String(e)); }

  // B) Yahoo page
  for (const sym of cfg.yahoo) {
    try {
      const page = await fetchYahooPage(sym);
      const p = scrapeYahooPagePrice(page);
      const v = cfg.convertFromYahoo(p);
      if (plausible(v, cfg.min, cfg.max)) return v;
      log(code, sym, "Yahoo out-of-range", v);
    } catch(e){ log(code, "Yahoo fail", String(e)); }
  }

  // C) Stooq CSV
  for (const sym of cfg.stooq) {
    try {
      const p = await fetchStooqPrice(sym);
      const v = cfg.convertFromStooq(p);
      if (plausible(v, cfg.min, cfg.max)) return v;
      log(code, sym, "Stooq out-of-range", v);
    } catch(e){ log(code, "Stooq fail", String(e)); }
  }

  // D) Keep previous
  const prev = current?.metals?.[code]?.usd_per_tonne;
  if (Number.isFinite(prev)) { log(code, "kept previous", prev); return prev; }

  log(code, "no data");
  return null;
}

// -------- Main --------
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
