# Player Profile — data pipeline runbook

Every artifact behind `/api/profile/:slug` is produced by a script in this repo
and can be regenerated at any time. Changes to these pulls are recorded in
`docs/data-pull-audit.md`.

## Setup

`.env` (gitignored) holds credentials; scripts load it with `--env-file-if-exists`.

| Variable | Used by | Required |
|---|---|---|
| `KAGGLE_USERNAME`, `KAGGLE_KEY` | `pull:bio` (height/position) | optional; without it, height/position for active players fall back to ESPN |
| `OPENAI_API_KEY` | portrait generation | only for portraits |

## Steps (run in this order)

| Step | Command | Reads | Writes |
|---|---|---|---|
| Season stats | `node scripts/backfill-seasons.js 2026-27` (the season being played), `node sheets-teamcat.js --season=2026-27`, `node playoffs.js`. Past team seasons (2015-16 on, audit #222): `node sheets-teamcat.js --season=<YYYY-YY> --sheet=<a copy of the team sheet> --settle`, one season at a time | stats Google Sheets | `data/cached-data.json` (`dailycat-<YY>`, `teamcat-<YY>`, `dailycat-playoffs-<YY>`) |
| Lineups (on/off, best five and trio, teammates with/apart; the shot map's possessions) | `npm run pull:lineups` | pbpstats lineup totals per team, split by date so no request hits pbpstats' 500-row cap, and kept in chunks split at traded players' stints and the Last 30 Days' start | `data/lineups/<TEAM>.json`, `data/lineup-players.json` (names of players without a bio) |
| Player ids, teams, height, position | `npm run pull:bio` | site_Data `index_master.csv` / `modern_index.csv`, Kaggle `common_player_info.csv`, ESPN (active players only); for a rookie site_Data doesn't list yet, the id from `data/lineup-players.json` | `data/bio.json`, `data/bio-review.json`, raw copies in `data/sources/` |
| Tracking stats (Drives, Time of Poss %, 3yr Pull-up/C&S/Wide Open, 2yr Def < 6 ft) | `npm run pull:tracking` | site_Data per-season NBA tracking files (GitHub) | `data/tracking.json` (replaces the sheet's tracking columns in profiles; see `docs/tracking-data-audit.md`) |
| Last 5 games + WOWY | `npm run pull:games` | pbpstats game logs and game list; WOWY summed from the lineup pull's files | `data/gamelog/<slug>.json`, `data/wowy/<slug>.json` |
| Static site export (after any pull) | `npm run export:static -- --out ../thinking-bball-profile/public` | everything above, through `lib/profile.js` | the site's API documents and 100/400px headshots as files, for GitHub Pages (see `docs/daily-pipeline-requirements.md`) |
| Shot profile shift | `npm run pull:shots` | ESPN play-by-play (finished games cached in `data/cache/espn/`) | `data/shotshift/<slug>.json`, `data/shotshift-review.json`; each window's possessions are summed from the lineup files at export (`lib/profile.js` `possIn`) |
| Core-stat shift (last 30 days vs rest), and the last 30 days' rows for the Leaderboard | `npm run pull:recent` | live stats sheet with a date window (`Instructions!E13:F13`) | `data/recent-shift.json`, `data/recent-window.json` |
| Playoffs mode (per-player playoff pulls) | the game log, lineup and shot pulls with `--playoffs` | the same sources, playoffs only | `data/playoffs/{gamelog,wowy,lineups,shots}/`; profiles for playoffs mode come from the playoff sheet's `dailycat-playoffs-<YY>` (`buildProfile(slug, { type: 'playoffs' })`, `/api/playoffs/...`) |
| Depth chart + injuries | `npm run pull:depth` | ESPN depth charts, rosters, injury report | `data/depth/<TEAM>.json`, `data/depth/_index.json`, `data/depth/_review.json` |

All per-game pulls use the latest season that has games (the previous season
during the offseason) and cover every player in the latest season pull.
Files are only rewritten when their content changes.

The API assembles profiles on request (`lib/profile.js`) from `data/`, so no
build step is needed after a pull.

### The date window on the stats sheet

`scripts/recent-shift.js` adds a date window to the live stats sheet: `Instructions!E13:F13`
(blank = normal season behaviour), a `FromDate/ToDate` clause in `'RS PBP'!A2`, and a
window-scaled minutes floor in `'League data'!E1`. It fills the window, waits for
`Format` to settle, reads it, and **always clears E13:F13** afterwards. Original
formulas are in `data/sheet-formula-backup.json`; `node scripts/recent-shift.js --restore`
puts them back. Don't run it at the same time as the season pull or the nightly run
(`.github/workflows/nightly.yml`), since they drive the same sheet.

## Review files

- `data/bio-review.json`: players that couldn't be matched or are missing
  fields. Fix name changes by adding to `NAME_ALIASES` in `scripts/build-bio.js`.
- `data/shotshift-review.json`: ESPN shooters not matched to a profile; mostly
  players below the season pull's minutes floor.
- `data/depth/_review.json`: injured players not on any depth chart.

## Definitions

- **League average:** minutes-weighted mean over the season's pool; 0 for relative stats (`lib/stats.js` `RELATIVE`).
- **Seasons:** profiles and the Leaderboard start at 1996-97 (`lib/profile.js` `FIRST_SEASON`, the play-by-play archive's first season): the sheet's season tabs (`dailycat-01`…) from 2000-01, its historical tab (`1historical-24`: 9 stats, about 175 players a season) for 1996-97 to 1999-00. The 318 player-seasons over 800 minutes the tab leaves out get its BPM, rTS%, Load, Box Creation, Passer Rating, ScoreVal and PlayVal worked out from Basketball-Reference's lines (`data/history/box-stats.json`, `scripts/box-stats.js`; `lib/historical.js`, the daily sheet's formulas), not OBPM or AuPM/g, which don't reproduce the tab's, nor 1998-99's ScoreVal and PlayVal (audit #209); the season lists them in `derived` and `unsourced`. Playoff runs start at 2000-01 (`FIRST_PLAYOFF_SEASON`): the playoff sheet's pulls (`dailycat-playoffs-01`…`-26`, `scripts/backfill-seasons.js --playoffs`). Its pulls of 1996-97 to 1999-00 (pbpstats has them, short some games) come back with rTS% as raw TS% and are held back (`data/sources/cache-review/playoffs-97-13.json`, audit #146).
- **Percentiles:** the sheet's `perc*` columns for the season tabs. Historical-tab seasons are ranked within the season among players with ≥ 800 MP.
- **Age:** the sheet's `Age` column ("age today" at pull time), shifted to the latest pull date. Season age counts back one year per season.
- **Rise score:** playoff BPM minus regular-season BPM over the seasons that have both.
- **Shift window:** the last 30 days of the season (ending on its last game) vs. everything before (`lib/window.js`).
- **Shot zones:** the 14 regions of the half-court map (`lib/zones.js`, matching the UI geometry in thinking-bball-profile `src/lib/court.js`); ESPN coordinates are whole feet, converted with `x = (espnX − 25) × 10`, `y = espnY × 10`.
