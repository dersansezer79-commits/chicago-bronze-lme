// Node 20+ (global fetch)
// Writes: lme_automation/lme.json
// Source: Metals.Dev (latest). Robust parser + Tin (Kalay).

import { writeFile, readFile } from "node:fs/promises";

const API_KEY  = process.env.METALS_DEV_API_KEY || "";
const BASE_URL = "https://api.metals.dev/v1/latest";

const LB_PER_KG = 2.20462262185;

const num = (x) => {
  if (x == null) return null;
  const n = Number(String(x).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

const lower = (s) => (typeof s === "string" ? s.toLowerCase() : s);

// Convert a numeric price with a known unit to USD/kg
function toUSDkg(value, unit) {
  const v = num(value);
  if (!Number.isFinite(v)) return null;
  const u = lower(unit || "");

  if (!u || u.includes("/kg")) return v;
  if (u.includes("/lb")) return v * LB_PER_KG;
  if (u.includes("/ton") || u.includes("/tonne") || u.includes("/t") || u.includes("/mt")) return v / 1000;

  // Unknown unit → assume already per kg (best effort)
  return v;
}

// Try to extract "price + unit" from various object shapes
function pickPriceAndUnit(obj, fallbackUnit) {
  if (obj == null) return { value: null, unit: null };
  if (typeof obj === "number") return { value: obj, unit: fallbackUnit || null };

  const pairs = [
    ["usd_per_kg", "/kg"],
    ["price_per_kg", "/kg"],
    ["priceKg", "/kg"],
    ["usd_per_lb", "/lb"],
    ["price_per_lb", "/lb"],
    ["priceLb", "/lb"],
    ["usd_per_tonne", "/tonne"],
    ["price_per_tonne", "/tonne"],
    ["priceTonne", "/tonne"],
    ["usd", null],
    ["value", null],
    ["price", null], // rely on obj.unit if present
  ];

  for (const [k, implied] of pairs) {
    const val = num(obj?.[k]);
    if (Number.isFinite(val)) {
      const unit = obj?.unit || implied || fallbackUnit || null;
      return { value: val, unit };
    }
  }

  // Plain number in nested shapes (rare)
  if (typeof obj?.value === "number") return { value: obj.value, unit: obj.unit || fallbackUnit || null };

  return { value: null, unit: null };
}

// Try common locations for a metal: prices[key], metals[key], data[key], latest[key], key, plus alt spellings
function pickMetalNode(root, key) {
  const k1 = key;
  const k2 = key === "aluminum" ? "aluminium" : key; // handle UK spelling
  const K1 = key.toUpperCase();

  const tries = [
    root?.prices?.[k1],   root?.prices?.[k2],   root?.prices?.[K1],
    root?.metals?.[k1],   root?.metals?.[k2],   root?.metals?.[K1],
    root?.data?.[k1],     root?.data?.[k2],     root?.data?.[K1],
    root?.latest?.[k1],   root?.latest?.[k2],   root?.latest?.[K1],
    root?.[k1],           root?.[k2],           root?.[K1],
  ];

  for (const t of tries) {
    if (t != null) return t;
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

  // If top-level provides a unit, remember it as a fallback
  const topUnit =
    j?.unit ||
    j?.units?.default ||
    j?.units?.price ||
    j?.units?.usd ||
    null;

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

(async () => {
  const usd_per_kg = await fetchMetals();
  const usdtry = await tryReadUSDTRY();

  const wsj_lb = Number.isFinite(usd_per_kg.copper)
    ? usd_per_kg.copper / LB_PER_KG
    : null;

  const out = {
    timestamp: new Date().toISOString(),
    currency: "USD",
    unit: "kg",
    basis: "latest",
    meta: {
      usdtry: usdtry,
      units: { usd_per_kg: "USD/kg", wsj_usa_copper_lb: "USD/lb" },
      sources_used: {
        aluminum: "lme_aluminum",
        copper: "lme_copper",
        lead: "lme_lead",
        nickel: "lme_nickel",
        zinc: "lme_zinc",
        tin: "lme_tin",
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
