// Node 20+ (global fetch)
// Writes: lme_automation/lme.json
// Tin chain: Metals.Dev → override → TradingEconomics → Alumeco → Investing.com → (optional) BloombergHT → previous commit.

import { writeFile, readFile } from "node:fs/promises";

/* ==============================
   Config
   ============================== */

const API_KEY  = process.env.METALS_DEV_API_KEY || "";
const BASE_URL = "https://api.metals.dev/v1/latest";

// TradingEconomics (demo works: guest:guest)
const TE_KEY   = process.env.TRADINGECONOMICS_API_KEY || "guest:guest";
const TE_TIN   = `https://api.tradingeconomics.com/commodities/tin?c=${encodeURIComponent(TE_KEY)}&format=json`;

// Manual override for tin. Accepts USD/kg or USD/tonne (if >200 it's treated as /tonne automatically).
const TIN_OVERRIDE = process.env.TIN_USD_PER_KG_OVERRIDE || process.env.TIN_OVERRIDE || "";

// Optional: enable the heavyweight Playwright fallback for BloombergHT
const ENABLE_PLAYWRIGHT_TIN = /^1|true$/i.test(process.env.ENABLE_PLAYWRIGHT_TIN || "");

// Treat any value above this as a tonne quote and convert to /kg.
const KG_THRESHOLD = Number(process.env.USD_PER_KG_THRESHOLD || 200);

const LB_PER_KG = 2.20462262185;

/* ==============================
   Helpers
   ============================== */

const num = (x) => {
  if (x == null) return null;
  const n = Number(String(x).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const lower = (s) => (typeof s === "string" ? s.toLowerCase() : s);

const SYN = {
  aluminum: ["aluminum", "aluminium", "al"],
  copper:   ["copper", "cu"],
  lead:     ["lead", "pb"],
  nickel:   ["nickel", "ni"],
  zinc:     ["zinc", "zn"],
  tin:      ["tin", "sn"],
};

// Normalize any numeric to USD/kg. If unit unknown and value > KG_THRESHOLD → assume /tonne.
function ensureUSDkg(value, unit) {
  const v0 = num(value);
  if (!Number.isFinite(v0)) return null;
  const u = lower(unit || "");
  let v = v0;

  if (u.includes("/kg")) {
    // OK
  } else if (u.includes("/lb")) {
    v = v0 * LB_PER_KG;
  } else if (u.includes("/ton") || u.includes("/tonne") || u.includes("/mt") || u === "/t") {
    v = v0 / 1000;
  } else {
    // Unknown unit; guess based on magnitude
    if (v0 > KG_THRESHOLD) v = v0 / 1000;
  }
  return v;
}

function pickPriceAndUnit(obj, fallbackUnit) {
  if (obj == null) return { value: null, unit: null };
  if (typeof obj === "number") return { value: obj, unit: fallbackUnit || null };
  const pairs = [
    ["usd_per_kg", "/kg"], ["price_per_kg", "/kg"], ["priceKg", "/kg"],
    ["usd_per_lb", "/lb"], ["price_per_lb", "/lb"], ["priceLb", "/lb"],
    ["usd_per_tonne", "/tonne"], ["price_per_tonne", "/tonne"], ["priceTonne", "/tonne"],
    ["usd", null], ["value", null], ["price", null],
  ];
  for (const [k, implied] of pairs) {
    const val = num(obj?.[k]);
    if (Number.isFinite(val)) {
      const unit = obj?.unit || implied || fallbackUnit || null;
      return { value: val, unit };
    }
  }
  if (typeof obj?.value === "number")
    return { value: obj.value, unit: obj.unit || fallbackUnit || null };
  return { value: null, unit: null };
}

function pickMetalNode(root, metalKey) {
  const names = SYN[metalKey] || [metalKey];
  const buckets = ["prices", "metals", "data", "latest", null];
  for (const b of buckets) {
    for (const n of names) {
      const variants = [n, n.toUpperCase(), n[0].toUpperCase() + n.slice(1)];
      for (const k of variants) {
        const node = b ? root?.[b]?.[k] : root?.[k];
        if (node != null) return node;
      }
    }
  }
  return null;
}

/* ==============================
   Sources
   ============================== */

async function fetchMetalsDev() {
  const url = `${BASE_URL}?currency=USD${API_KEY ? `&api_key=${encodeURIComponent(API_KEY)}` : ""}`;
  const headers = API_KEY ? { "X-API-KEY": API_KEY } : {};
  const r = await fetch(url, { cache: "no-store", headers });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Metals.Dev ${r.status}: ${t.slice(0, 300)}`);
  }
  const j = await r.json();
  const topUnit = j?.unit || j?.units?.default || j?.units?.price || j?.units?.usd || null;

  const metals = ["aluminum", "copper", "lead", "nickel", "zinc", "tin"];
  const usd_per_kg = {};
  for (const m of metals) {
    const node = pickMetalNode(j, m);
    const { value, unit } = pickPriceAndUnit(node, topUnit);
    usd_per_kg[m] = ensureUSDkg(value, unit);
  }
  return usd_per_kg;
}

async function tryReadUSDTRY_EURTRY() {
  try {
    const txt = await readFile("lme_automation/tcmb.json", "utf8");
    const j = JSON.parse(txt);
    const USDTRY = num(j?.USDTRY ?? j?.usdtry);
    const EURTRY = num(j?.EURTRY ?? j?.eurtry);
    return {
      USDTRY: Number.isFinite(USDTRY) ? USDTRY : null,
      EURTRY: Number.isFinite(EURTRY) ? EURTRY : null
    };
  } catch {
    return { USDTRY: null, EURTRY: null };
  }
}

/* ---------- Tin fallbacks ---------- */

// TradingEconomics (returns USD/MT typically)
async function fetchTradingEconomicsTinUSDkg() {
  try {
    const r = await fetch(TE_TIN, { cache: "no-store", headers: { "User-Agent": "github-actions" }});
    if (!r.ok) return null;
    const arr = await r.json();
    const row = Array.isArray(arr) ? arr[0] : null;
    if (!row) return null;

    const v = num(row?.Price ?? row?.price ?? row?.Close ?? row?.close ?? row?.Last ?? row?.last);
    const unit = row?.Unit ?? row?.unit ?? null;
    return ensureUSDkg(v, unit);
  } catch {
    return null;
  }
}

// Alumeco (EUR/t or USD/t or /kg). Needs FX for EUR→USD.
function parseFlexibleNumber(s) {
  if (!s) return null;
  let t = String(s).replace(/\s/g, "");
  if (t.includes(".") && t.includes(",")) {
    const last = Math.max(t.lastIndexOf("."), t.lastIndexOf(","));
    t = t
      .split("")
      .map((ch, i) => (i === last ? "." : ch))
      .filter((ch, i) => i === last || (ch !== "." && ch !== ","))
      .join("");
    return num(t);
  }
  if (t.includes(",") && !t.includes(".")) t = t.replace(",", ".");
  else t = t.replace(/,/g, "");
  return num(t);
}

async function fetchAlumecoTinUSDkg(USDTRY, EURTRY) {
  try {
    const url = "https://www.alumeco.com/metal-prices/tin/";
    const r = await fetch(url, {
      cache: "no-store",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; GitHubActions; +https://github.com)",
        "Accept-Language": "en-US,en;q=0.8",
      },
    });
    if (!r.ok) return null;
    const html = await r.text();

    const patterns = [
      /([\d][\d\s.,]*)\s*(USD|EUR)\s*\/\s*(?:t|ton|tonne|mt)\b/i,
      /(USD|EUR)\s*\/\s*(?:t|ton|tonne|mt)\s*[:\-]?\s*([\d][\d\s.,]*)/i,
      /([\d][\d\s.,]*)\s*(USD|EUR)\s*\/\s*kg\b/i,
      /(USD|EUR)\s*\/\s*kg\s*[:\-]?\s*([\d][\d\s.,]*)/i,
    ];

    let value = null, currency = null, per = "kg";

    for (const rx of patterns) {
      const m = html.match(rx);
      if (m) {
        if (rx === patterns[0]) { value = parseFlexibleNumber(m[1]); currency = m[2].toUpperCase(); per="t"; }
        else if (rx === patterns[1]) { currency = m[1].toUpperCase(); value = parseFlexibleNumber(m[2]); per="t"; }
        else if (rx === patterns[2]) { value = parseFlexibleNumber(m[1]); currency = m[2].toUpperCase(); per="kg"; }
        else if (rx === patterns[3]) { currency = m[1].toUpperCase(); value = parseFlexibleNumber(m[2]); per="kg"; }
        if (Number.isFinite(value) && (currency === "USD" || currency === "EUR")) break;
        value = null; currency = null;
      }
    }

    if (!Number.isFinite(value) || !currency) return null;

    let quoted = value;
    if (per === "t") quoted = value / 1000; // to per kg

    if (currency === "USD") {
      return ensureUSDkg(quoted, "/kg");
    } else { // EUR
      if (!Number.isFinite(USDTRY) || !Number.isFinite(EURTRY)) return null;
      const EURUSD = USDTRY / EURTRY;
      return ensureUSDkg(quoted * EURUSD, "/kg");
    }
  } catch {
    return null;
  }
}

// Investing.com (TR/EN). Typically USD/MT visible → convert to /kg.
async function fetchInvestingTinUSDkg() {
  const urls = [
    "https://tr.investing.com/commodities/tin",
    "https://www.investing.com/commodities/tin",
  ];
  for (const url of urls) {
    try {
      const r = await fetch(url, {
        cache: "no-store",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
          "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
          "Referer": "https://tr.investing.com/commodities/",
        },
      });
      if (!r.ok) continue;
      const html = await r.text();

      let m = html.match(/data-test="instrument-price-last"[^>]*>([\s\S]*?)<\/span>/i);
      let value = null;
      if (m) {
        const inner = m[1].replace(/<[^>]*>/g, "").trim();
        value = parseFlexibleNumber(inner);
      }
      if (!Number.isFinite(value)) {
        const m2 = html.match(/id="last_last"[^>]*>([\s\S]*?)<\/span>/i);
        if (m2) {
          const inner = m2[1].replace(/<[^>]*>/g, "").trim();
          value = parseFlexibleNumber(inner);
        }
      }
      if (Number.isFinite(value)) {
        return ensureUSDkg(value, value > KG_THRESHOLD ? "/t" : "/kg");
      }
    } catch { /* try next URL */ }
  }
  return null;
}

// BloombergHT (TR) — optional; requires Playwright (heavy). Disabled by default.
async function fetchBloombergHTTinUSDkg() {
  if (!ENABLE_PLAYWRIGHT_TIN) return null;
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    return null;
  }
  const url = 'https://www.bloomberght.com/emtia/kalay';
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36';

  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({ userAgent: ua, locale: 'tr-TR', viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(2000);

    const selectors = [
      '.last-price', '.price', '.instrument-price', '[data-type="last"]',
      '[data-field="last"]', '[data-test="instrument-price-last"]',
      '#last_last', '.piyasaData .value', 'span.value',
    ];

    const parseNum = (s) => {
      if (!s) return null;
      let t = String(s).replace(/\s/g, '');
      if (t.includes('.') && t.includes(',')) {
        const last = Math.max(t.lastIndexOf('.'), t.lastIndexOf(','));
        t = t.split('').map((ch,i)=> i===last?'.':ch).filter((ch,i)=> i===last || (ch!=='.' && ch!==',')).join('');
      } else if (t.includes(',') && !t.includes('.')) t = t.replace(',', '.');
      else t = t.replace(/,/g,'');
      const n = Number(t);
      return Number.isFinite(n) ? n : null;
    };

    let val = null;
    for (const sel of selectors) {
      const el = await page.$(sel);
      if (!el) continue;
      const raw = (await el.innerText())?.trim();
      const v = parseNum(raw);
      if (Number.isFinite(v)) { val = v; break; }
    }

    if (!Number.isFinite(val)) {
      const bodyText = await page.evaluate(() => document.body.innerText);
      const cand = [...bodyText.matchAll(/(\d{1,3}(?:\.\d{3})+,\d+|\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:[.,]\d+)?)/g)]
        .map(m => parseNum(m[1]))
        .filter(n => Number.isFinite(n));
      val = cand.find(n => n >= 7_000 && n <= 80_000) ?? cand[0] ?? null;
    }

    if (!Number.isFinite(val)) return null;
    return ensureUSDkg(val, val > KG_THRESHOLD ? "/t" : "/kg");
  } catch {
    return null;
  } finally {
    await browser.close().catch(() => {});
  }
}

async function fetchPrevTin() {
  try {
    const repo = process.env.GITHUB_REPOSITORY; // "owner/name"
    if (!repo) return null;
    const api = `https://api.github.com/repos/${repo}/commits?path=lme_automation/lme.json&per_page=2`;
    const r = await fetch(api, { headers: { "User-Agent": "github-actions" } });
    if (!r.ok) return null;
    const commits = await r.json();
    const prevSha = commits?.[1]?.sha;
    if (!prevSha) return null;

    const raw = `https://raw.githubusercontent.com/${repo}/${prevSha}/lme_automation/lme.json`;
    const rr = await fetch(raw, { headers: { "User-Agent": "github-actions" } });
    if (!rr.ok) return null;
    const j = await rr.json();
    const val = num(j?.usd_per_kg?.tin);
    return Number.isFinite(val) ? val : null;
  } catch {
    return null;
  }
}

/* ==============================
   Main
   ============================== */

(async () => {
  const usd_per_kg = await fetchMetalsDev();                    // normalized to USD/kg
  const { USDTRY, EURTRY } = await tryReadUSDTRY_EURTRY();

  let tinSource = "lme_tin";

  // 1) manual override (accepts /kg or /t — threshold-based)
  if (!Number.isFinite(usd_per_kg.tin)) {
    const ovRaw = num(TIN_OVERRIDE);
    const ov = Number.isFinite(ovRaw) ? ensureUSDkg(ovRaw, ovRaw > KG_THRESHOLD ? "/t" : "/kg") : null;
    if (Number.isFinite(ov)) { usd_per_kg.tin = ov; tinSource = "override_tin"; console.log("ℹ️ Tin override:", ov); }
  }
  // 2) TradingEconomics
  if (!Number.isFinite(usd_per_kg.tin)) {
    const te = await fetchTradingEconomicsTinUSDkg();
    if (Number.isFinite(te)) { usd_per_kg.tin = te; tinSource = "tradingeconomics_tin"; console.log("ℹ️ Tin from TE:", te); }
  }
  // 3) Alumeco
  if (!Number.isFinite(usd_per_kg.tin)) {
    const al = await fetchAlumecoTinUSDkg(USDTRY, EURTRY);
    if (Number.isFinite(al)) { usd_per_kg.tin = al; tinSource = "alumeco_tin"; console.log("ℹ️ Tin from Alumeco:", al); }
  }
  // 4) Investing.com
  if (!Number.isFinite(usd_per_kg.tin)) {
    const inv = await fetchInvestingTinUSDkg();
    if (Number.isFinite(inv)) { usd_per_kg.tin = inv; tinSource = "investing_tin"; console.log("ℹ️ Tin from Investing:", inv); }
  }
  // 5) BloombergHT (optional / disabled by default)
  if (!Number.isFinite(usd_per_kg.tin)) {
    const bh = await fetchBloombergHTTinUSDkg();
    if (Number.isFinite(bh)) { usd_per_kg.tin = bh; tinSource = "bloomberght_tin"; console.log("ℹ️ Tin from BloombergHT:", bh); }
  }
  // 6) previous commit
  if (!Number.isFinite(usd_per_kg.tin)) {
    const prev = await fetchPrevTin();
    if (Number.isFinite(prev)) { usd_per_kg.tin = prev; tinSource = "previous_commit_tin"; console.log("ℹ️ Tin from previous commit:", prev); }
  }
  if (!Number.isFinite(usd_per_kg.tin)) {
    usd_per_kg.tin = null;
    console.warn("⚠️ Tin not available from API, override, TE, Alumeco, Investing, BloombergHT, or previous commit.");
  }

  // Final sanity: if any metal still looks like /t (v > KG_THRESHOLD), downscale.
  for (const k of Object.keys(usd_per_kg)) {
    const v = usd_per_kg[k];
    if (Number.isFinite(v) && v > KG_THRESHOLD) usd_per_kg[k] = v / 1000;
  }

  const wsj_lb = Number.isFinite(usd_per_kg.copper) ? usd_per_kg.copper / LB_PER_KG : null;

  const out = {
    timestamp: new Date().toISOString(),
    currency: "USD",
    unit: "kg",
    basis: "latest",
    meta: {
      usdtry: USDTRY,
      units: { usd_per_kg: "USD/kg", wsj_usa_copper_lb: "USD/lb" },
      sources_used: {
        aluminum: "lme_aluminum",
        copper:   "lme_copper",
        lead:     "lme_lead",
        nickel:   "lme_nickel",
        zinc:     "lme_zinc",
        tin:      tinSource,   // which source actually supplied tin
        wsj_usa_copper: "lme_copper",
      },
    },
    usd_per_kg,
    benchmarks: {
      wsj_usa_copper_lb: wsj_lb,
      wsj_usa_copper_kg: Number.isFinite(usd_per_kg.copper) ? usd_per_kg.copper : null,
    },
    aliases: {
      PB:      { path: "usd_per_kg.lead", unit: "USD/kg", usd: usd_per_kg.lead ?? null, source: "lme_lead" },
      WSJ_USA:{ path: "benchmarks.wsj_usa_copper_lb", unit: "USD/lb", usd: wsj_lb ?? null, source: "lme_copper" },
    },
  };

  await writeFile("lme_automation/lme.json", JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log("✅ Wrote lme_automation/lme.json");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
