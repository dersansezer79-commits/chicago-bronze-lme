// Mirrors a canonical lme.json from your repo (or ENV) — writes lme.json
import { writeFileSync } from "node:fs";

const SRC =
  process.env.LME_SOURCE_URL ||
  "https://raw.githubusercontent.com/dersansezer79-commits/chicago-bronze-lme/main/lme.json";

try {
  const r = await fetch(SRC, { cache: "no-store" });
  if (!r.ok) throw new Error("LME source HTTP " + r.status);
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("Invalid JSON at source"); }
  writeFileSync("lme.json", JSON.stringify(data, null, 2));
  console.log("Wrote lme.json (mirrored from source).");
} catch (e) {
  console.error(e);
  process.exit(1);
}
