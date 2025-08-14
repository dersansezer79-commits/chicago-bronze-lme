name: Update LME

on:
  schedule:
    - cron: '5 16 * * *'   # every day 19:05 Türkiye time (16:05 UTC)
  workflow_dispatch:

permissions:
  contents: write

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Update lme.json
        run: node scripts/update-lme.js
      - name: Commit if changed
        uses: stefanzweifel/git-auto-commit-action@v5
        with:
          commit_message: "chore: auto-update lme.json"
          file_pattern: lme.json
