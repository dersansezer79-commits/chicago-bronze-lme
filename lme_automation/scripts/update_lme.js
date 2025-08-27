// Node 20+ (global fetch)
// Writes: lme_automation/lme.json
// Source: Metals.Dev (latest). Adds Tin (Kalay).
// Tries to read USD/TRY from lme_automation/tcmb.json for meta.usdtry.

import { writeFile, readFile } from "node:fs/promises";

const METALS_URL =
  `https://api.metals.dev/v1/latest?api_key=${process.env.METALS_DEV_API_KEY ?? ""}&currency=USD`;

const LB_PER_KG = 2.20462262185;

const num = (x) => {
  if (x == null) return null;
  const n = Number(String(x).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

// Try multiple shapes and normalize to USD/kg
function extractUSDperKG(j, key) {
  // 1) prices.aluminum etc (already USD/kg in your previous runs)
  let v =
    num(j?.prices?.[key]) ??
    num(j?.[key]) ??
    num(j?.metals?.[key]?.price_per_kg) ??
    num(j?.metals?.[key]?.price);

  // if we only find a per-tonne field, convert to kg
  if (!Number.isFinite(v)) {
    const t =
      num(j?.prices?.[key + "_per_tonne"]) ??
      num(j?.metals?.[key]?.price_per_tonne);
    if (Number.isFinite(t)) v = t / 1000;
  }
  return Number.isFinite(v) ? v : null;
}

async function fetchMetals() {
  const r = await fetch(METALS_URL, { cache: "no-store" });
  if (!r.ok) throw new Error(`Metals.Dev ${r.status}`);
  const j = await r.json();

  // normalize keys
  const keys = ["aluminum", "copper", "lead", "nickel", "zinc", "tin"];
  const usd_per_kg = {};
  for (const k of keys) usd_per_kg[k] = extractUSDperKG(j, k);

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

  // Benchmarks: WSJ/USA copper — keep in sync with copper (USD/lb)
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
      units: {
        usd_per_kg: "USD/kg",
        wsj_usa_copper_lb: "USD/lb",
      },
      sources_used: {
        aluminum: "lme_aluminum",
        copper: "lme_copper",
        lead: "lme_lead",
        nickel: "lme_nickel",
        zinc: "lme_zinc",
        tin: "lme_tin", // ← NEW
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

  await writeFile(
    "lme_automation/lme.json",
    JSON.stringify(out, null, 2) + "\n",
    "utf8"
  );
  console.log("Wrote lme_automation/lme.json (with tin).");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
