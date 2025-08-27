// Node 20+ (global fetch)
// Writes: lme_automation/lme.json
// Source: Metals.Dev (latest). Robust Tin handling: API → override → previous commit.

import { writeFile, readFile } from "node:fs/promises";

const API_KEY  = process.env.METALS_DEV_API_KEY || "";
const BASE_URL = "https://api.metals.dev/v1/latest";
const LB_PER_KG = 2.20462262185;

// Optional manual override via repo Variables (Settings → Secrets and variables → Variables)
const TIN_OVERRIDE = process.env.TIN_USD_PER_KG_OVERRIDE || process.env.TIN_OVERRIDE || "";

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
  tin:      ["tin", "sn"],   // ← try both Tin & Sn
};

function toUSDkg(value, unit) {
  const v = num(value);
  if (!Number.isFinite(v)) return null;
  const u = lower(unit || "");
  if (!u || u.includes("/kg")) return v;
  if (u.includes("/lb")) return v * LB_PER_KG;
  if (u.includes("/ton") || u.includes("/tonne") || u.includes("/mt") || u === "/t") return v / 1000;
  return v; // assume /kg if unknown
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

async function fetchMetals() {
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
    usd_per_kg[m] = toUSDkg(value, unit);
  }
  return usd_per_kg;
}

async function tryReadUSDTRY() {
  try {
    const txt = await readFile("lme_automation/tcmb.json", "utf8");
    const j = JSON.parse(txt);
    const val = num(j?.USDTRY ?? j?.usdtry);
    return Number.isFinite(val) ? val : null;
  } catch {
    return null;
  }
}

// Fallback #2: pull previous lme.json from GitHub and reuse tin if present
async function fetchPrevTin() {
  try {
    const repo = process.env.GITHUB_REPOSITORY; // e.g. "owner/name"
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

(async () => {
  const usd_per_kg = await fetchMetals();
  const usdtry = await tryReadUSDTRY();

  // Tin fallbacks: override → previous commit
  if (!Number.isFinite(usd_per_kg.tin)) {
    const ov = num(TIN_OVERRIDE);
    if (Number.isFinite(ov)) {
      usd_per_kg.tin = ov;
      console.log("ℹ️ Using TIN_USD_PER_KG_OVERRIDE:", ov);
    } else {
      const prevTin = await fetchPrevTin();
      if (Number.isFinite(prevTin)) {
        usd_per_kg.tin = prevTin;
        console.log("ℹ️ Using previous commit Tin:", prevTin);
      } else {
        console.warn("⚠️ Tin not available from API, override, or previous commit. Leaving null.");
      }
    }
  }

  const wsj_lb = Number.isFinite(usd_per_kg.copper)
    ? usd_per_kg.copper / LB_PER_KG
    : null;

  const out = {
    timestamp: new Date().toISOString(),
    currency: "USD",
    unit: "kg",
    basis: "latest",
    meta: {
      usdtry,
      units: { usd_per_kg: "USD/kg", wsj_usa_copper_lb: "USD/lb" },
      sources_used: {
        aluminum: "lme_aluminum",
        copper:   "lme_copper",
        lead:     "lme_lead",
        nickel:   "lme_nickel",
        zinc:     "lme_zinc",
        tin:      "lme_tin",
        wsj_usa_copper: "lme_copper",
      },
    },
    usd_per_kg,
    benchmarks: {
      wsj_usa_copper_lb: wsj_lb,
      wsj_usa_copper_kg: Number.isFinite(usd_per_kg.copper) ? usd_per_kg.copper : null,
    },
    aliases: {
      PB: {
        path: "usd_per_kg.lead",
        unit: "USD/kg",
        usd: usd_per_kg.lead ?? null,
        source: "lme_lead",
      },
      WSJ_USA: {
        path: "benchmarks.wsj_usa_copper_lb",
        unit: "USD/lb",
        usd: wsj_lb ?? null,
        source: "lme_copper",
      },
    },
  };

  await writeFile("lme_automation/lme.json", JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log("✅ Wrote lme_automation/lme.json");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
