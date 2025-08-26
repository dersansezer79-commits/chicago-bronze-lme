// Update LME metals into lme_automation/lme.json
// - No npm deps (Node >= 18)
// - Reads an "upstream" JSON (your existing daily metals file)
// - Normalizes into: { as_of, metals: { CU|SN|NI|AL|ZN|PB: { usd_per_tonne } } }
// - If the upstream only has copper (usd_per_tonne), we still write CU.
//
// Configure the source with env UPSTREAM_LME_JSON
// (defaults to your repo's root lme.json to keep things simple).

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const UPSTREAM =
  process.env.UPSTREAM_LME_JSON ||
  "https://raw.githubusercontent.com/dersansezer79-commits/chicago-bronze-lme/main/lme.json";

const TARGET_PATH = "lme_automation/lme.json";
const KEYS = ["CU", "SN", "NI", "AL", "ZN", "PB"]; // copper, tin, nickel, aluminium, zinc, lead

async function fetchJSON(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return await r.json();
}

function normalizeUpstream(js) {
  // Accept a few shapes and normalize them.
  // 1) { metals: { CU: { usd_per_tonne: 9605.5 }, ... } }
  if (js && typeof js === "object" && js.metals && typeof js.metals === "object") {
    const out = { metals: {}, as_of: js.as_of || new Date().toISOString() };
    for (const k of KEYS) {
      const v = js.metals[k];
      if (v && typeof v.usd_per_tonne === "number") {
        out.metals[k] = { usd_per_tonne: v.usd_per_tonne };
      }
    }
    return out;
  }

  // 2) { "CU": 9605.5, "SN": 32865, ... } (flat numbers in USD/tonne)
  if (js && typeof js === "object") {
    const out = { metals: {}, as_of: js.as_of || new Date().toISOString() };
    let any = false;
    for (const k of KEYS) {
      if (typeof js[k] === "number") {
        out.metals[k] = { usd_per_tonne: js[k] };
        any = true;
      }
    }
    if (any) return out;
  }

  // 3) { "usd_per_tonne": 10032 }  (copper only)
  if (js && typeof js.usd_per_tonne === "number") {
    return {
      metals: { CU: { usd_per_tonne: js.usd_per_tonne } },
      as_of: js.as_of || new Date().toISOString(),
    };
  }

  // 4) Unknown shape: keep as much as possible
  return {
    metals: {},
    as_of: new Date().toISOString(),
  };
}

function loadCurrent() {
  try {
    if (existsSync(TARGET_PATH)) {
      const s = readFileSync(TARGET_PATH, "utf8");
      const js = JSON.parse(s || "{}");
      if (js && typeof js === "object") return js;
    }
  } catch {}
  return {};
}

(async () => {
  try {
    const upstream = await fetchJSON(UPSTREAM);
    const normalized = normalizeUpstream(upstream);
    const current = loadCurrent();

    // merge: keep any metals already present if upstream didn’t provide them today
    const merged = {
      as_of: normalized.as_of,
      metals: { ...(current.metals || {}) },
    };
    for (const k of KEYS) {
      if (normalized.metals[k] && typeof normalized.metals[k].usd_per_tonne === "number") {
        merged.metals[k] = { usd_per_tonne: normalized.metals[k].usd_per_tonne };
      }
    }

    writeFileSync(TARGET_PATH, JSON.stringify(merged, null, 2));
    console.log(`Wrote ${TARGET_PATH} with keys:`, Object.keys(merged.metals));
  } catch (e) {
    console.error("LME update failed:", e);
    process.exit(1);
  }
})();
