// Node 20+ (global fetch)
// Writes: lme_automation/lme.json
// Source: Metals.Dev (latest). Includes Tin.
// Tries to read USD/TRY from lme_automation/tcmb.json for meta.usdtry.

import { writeFile, readFile } from "node:fs/promises";

const API_KEY = process.env.METALS_DEV_API_KEY || "";
const BASE_URL = "https://api.metals.dev/v1/latest";
const LB_PER_KG = 2.20462262185;

const num = (x) => {
  if (x == null) return null;
  const n = Number(String(x).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

// Normalize to USD/kg from various response shapes
function asUSDperKG(j, key) {
  let v =
    num(j?.prices?.[key]) ??
    num(j?.[key]) ??
    num(j?.metals?.[key]?.price_per_kg) ??
    num(j?.metals?.[key]?.price);
  if (!Number.isFinite(v)) {
    const t =
      num(j?.prices?.[key + "_per_tonne"]) ??
      num(j?.metals?.[key]?.price_per_tonne);
    if (Number.isFinite(t)) v = t / 1000;
  }
  return Number.isFinite(v) ? v : null;
}

async function fetchMetals() {
  const url = `${BASE_URL}?currency=USD${API_KEY ? `&api_key=${encodeURIComponent(API_KEY)}` : ""}`;
  const headers = API_KEY ? { "X-API-KEY": API_KEY } : {};
  const r = await fetch(url, { cache: "no-store", headers });

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Metals.Dev ${r.status}: ${t.slice(0, 200)}`);
  }
  const j = await r.json();

  const keys = ["aluminum", "copper", "lead", "nickel", "zinc", "tin"];
  const usd_per_kg = {};
  for (const k of keys) usd_per_kg[k] = asUSDperKG(j, k);

  return { raw: j, usd_per_kg };
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
  const { usd_per_kg } = await fetchMetals();
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
        tin: "lme_tin",          // ← Tin
        wsj_usa_copper: "lme_copper",
      },
    },
    usd_per_kg,
    benchmarks: {
      wsj_usa_copper_lb: wsj_lb,
      wsj_usa_copper_kg: usd_per_kg.copper ?? null,
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
  console.log("Wrote lme_automation/lme.json (with tin).");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
