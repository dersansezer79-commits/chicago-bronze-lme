
Chicago Bronze — Alloy CSV Kit (Option B)

What this does
- Edit `alloy-premiums.csv` (two columns: key,premium_usd_per_kg).
- Push the CSV; GitHub Action runs `scripts/update-alloys-from-csv.js`.
- It rewrites `alloys.json` (merging optional overrides).
- Your site reads `alloys.json` via ALLOYS_ENDPOINT and prices update automatically.

Install
1) Copy everything to the **root** of your GitHub Pages repo.
2) Commit & push.
3) Edit `alloy-premiums.csv`; commit & push. The workflow commits a fresh `alloys.json`.

Optional columns in CSV
density_kg_m3,lme_multiplier,ops_usd_per_kg,margin_pct,max_len_mm,max_od_mm,min_bore_wall_mm,flange_max_od_mm,flange_max_thk_mm

Example row with options:
C93200_SAE660,2.6,8800,0.83,0.5,12,1200,600,6,800,60
