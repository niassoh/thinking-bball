# Daily pipeline

How the public site (https://niassoh.github.io/tbball/) stays current in season: a
nightly run in this repo pulls every source into `data/` and commits it, and the
frontend's deploy builds the site from that. Changes to the pulls are recorded in
`docs/data-pull-audit.md`; each pull's own notes are in `docs/player-profile-pipeline.md`.

## Where things stand (2026-10-21)

- **Every night:** the nightly workflow (`.github/workflows/nightly.yml`) in the private
  repo `niassoh/thinking-bball`, first green (but for the deploy's dispatch) 2026-10-21;
  the frontend's deploy builds the data from this repo (below). Setup is done except the
  key rotation and `TBBALL_DISPATCH` (steps 1, 3): until that token exists, deploy by hand
  (`gh workflow run pages.yml -R niassoh/tbball`).
- **On the Mac:** the NBA.com pulls, play-by-play and tracking (below).

## The nightly run

`.github/workflows/nightly.yml`, on GitHub Actions' free tier: every night at 10:17 UTC
(about 6 am ET), after the last game and the Mac's job.
Steps run one after another; each pull has a timeout and `continue-on-error`, so a source
that fails keeps yesterday's files and the rest still run.

| # | Step | Command | Writes |
|---|---|---|---|
| 1 | Reachability | `node scripts/reachability.js` | the job summary: whether stats.nba.com, pbpstats, ESPN and Google answer from the runner |
| 2 | Depth charts, injuries | `npm run pull:depth` | `data/depth/` |
| 3 | Season sheet | `node scripts/backfill-seasons.js $SEASON` | `dailycat-<YY>`; drives the **production sheet**: loads the season before into `Instructions!A13` (unsaved) and then the season, so its imports refetch |
| 4 | Team sheet | `node sheets-teamcat.js --season=$SEASON` | `teamcat-<YY>` |
| 5 | Recent shift (only if 3 succeeded) | `npm run pull:recent` | `data/recent-shift.json`, `data/recent-window.json`; sets and then clears the sheet's date window (`E13:F13`); until the season has 30 days of games its window is the season so far and no player has a shift (audit #190) |
| 6 | Lineups | `npm run pull:lineups` | `data/lineups/`, `data/lineup-players.json`, `data/stints.json` |
| 7 | Bio | `npm run pull:bio` | `data/bio.json`; a rookie site_Data doesn't list yet takes the NBA id from 6's player list |
| 8 | Player totals | `npm run pull:player-totals` | `data/player-totals.json` |
| 9 | Game logs, WOWY | `npm run pull:games` | `data/gamelog/`, `data/wowy/` (WOWY summed from 6's files) |
| 10 | Shots | `npm run pull:shots` | `data/shotshift/`; ESPN's finished games are cached between runs |
| 11 | Tracking seasons | `node scripts/tracking-seasons.js` | `data/tracking-seasons.json`, from the bucket's season files |
| 12 | Play-by-play | on the Mac, at 1:30 am (below) | `data/pbp/<season>/<gameId>.json.gz`: each new game's NBA.com v3 play-by-play and starters, checked against pbpstats' final score (kept in git, about 10 KB a game) |
| 13 | Game dates | `node scripts/footprint-games.js $SEASON` | `data/footprint/<season>/games.json` |
| 14 | Possessions | `python analysis/footprint/build.py $SEASON` | the season's possession cache (not kept), rebuilt from 12's files |
| 15 | Footprint (if 13 and 14 succeeded) | `python analysis/footprint/footprint_pbp.py $SEASON` | `data/footprint/<season>/`: profiles take the season's Footprint from here (with rim free throws and teammate counts) instead of 6's files |
| 16 | Lonestar (if 3 and 14 succeeded) | `node scripts/lonestar.js --source=pbp --season=$SEASON --refresh` | `data/lonestar/<season>/`, `league.json`; the season being played picks its stars with no minutes floor (audit #189) |
| 17 | Checks (fatal) | `node scripts/nightly-check.js` and `analysis/footprint`'s Python tests (not the node tests: they assume a full latest season, and footprint's runs out of the runner's 7 GB) | nothing; if they fail, nothing is committed and the site keeps yesterday's data |
| 18 | Commit | `git add data` (never `git add .`) | `Data: nightly <date>`, pushed |
| 19 | Deploy | `gh workflow run pages.yml -R niassoh/tbball` | the site, a few minutes later |

The three steps that drive the production sheet (3–5) run first, so the job's own
150-minute limit can't cut one off; each step's timeout is above its script's own, which
gives up and restores the sheet first. If any pull failed, the last step fails the run,
which emails the repo's owner.

`nightly-check.js` fails the run if, against the last commit, the season pull lost more
than 10% of its players or `bio.json` more than 2%, or fewer than 400 players are on depth
charts: a sheet that hadn't finished loading or an outage, caught before it replaces
good data.

## On the Mac

stats.nba.com doesn't answer GitHub's runners (the probe's first run, 2026-10-21: both its
rows timed out), so `scripts/mac-nightly.sh` runs on the Mac at 1:30 am local, before the
cloud run (10:17 UTC is 2:17 am Pacific in winter):

1. `node scripts/pbp-fetch.js`, then commits and pushes the new games
   (`Data: play-by-play <date>`).
2. `python3 scripts/playoff-tracking-pull.py "$SITE_DATA" … --regular` for the season, then
   `node scripts/tracking-upload.js`, which replaces the six files in
   `gs://thinkingbball/<end year>/` (read by the sheet's `IMPORTDATA`) with
   `~/.gcp/thinking-basketball.json`. It uploads nothing if a file lost players, drives have
   no free throws, or the league's time of possession tops 30 min a team-game (NBA.com's
   has run about 28 since its 2025-26 reprocessing; `docs/tracking-source-investigation.md`).

Setup: a clone at `~/thinking-bball-nightly` (`npm ci`; this repo's two
`credential.https://github.com.helper` lines, so it pushes as `niassoh`); the launchd agent
`~/Library/LaunchAgents/com.thinkingbball.nightly.plist` (1:30 am, `PATH` with node and gh,
`SITE_DATA` a site_Data clone that has `player_level.py`); and
`sudo pmset repeat wakeorpoweron MTWRFSU 01:25:00`, so the Mac wakes for it (when plugged
in). A night it misses, the cloud run keeps the last play-by-play and tracking, and the
next job catches up. Log: `~/Library/Logs/thinking-bball-nightly.log`; run it now with
`launchctl kickstart gui/$(id -u)/com.thinkingbball.nightly`.

## Not in the nightly yet

- **Playoffs** (April): `playoffs.js` has the same hardcoded key and retry problems
  `sheets-teamcat.js` had, and the `--playoffs` pulls aren't steps yet.
- **By hand, as before:** portraits (`docs/portrait-audit.md`), NBA.com headshots for new
  players (`node scripts/portraits/nba-fallback.js`, weekly), the draft
  (`scripts/build-draft.js`).

## Setup (once)

1. **Rotate the Sheets service-account key.** `privatekey.json` was committed (it's
   untracked from this branch on) and pushed to Heroku. Create a new key in the Google
   Cloud project that owns the account ("Ben's Google API Account", per `misc.js`), delete
   the old one, and use the new one locally and as the secret below. The Heroku app loses
   sheet access. Also revoke the dead Slack webhook and the Redis URL hardcoded in the
   root scripts.
2. **Create the private repo** `niassoh/thinking-bball` and push `master` with this work
   as its default branch (schedules only run on the default branch).
3. **Secrets:** `GOOGLE_SA_JSON` (the new key's JSON; the run writes it to
   `privatekey.json`), `KAGGLE_USERNAME` and `KAGGLE_KEY` (bio's heights and positions;
   without them active players fall back to ESPN), `TBBALL_DISPATCH` (a fine-grained
   token with Actions: write on `niassoh/tbball` only; note when it expires).
4. **Variable:** `SEASON` = `2026-27`. A run stops before touching the sheet unless it's
   `YYYY-YY`.
5. **Deploy key:** `ssh-keygen -t ed25519 -N '' -f tbball-deploy`; add
   `tbball-deploy.pub` to this repo's deploy keys (read-only), and the private key as the
   secret `BACKEND_DEPLOY_KEY` in `niassoh/tbball`. Then merge the frontend's `ci-export`
   into its `main` (below); that push deploys the site from this repo's data.
6. **Dispatch** `nightly` from the Actions tab and read the summary. Once it's green, add
   `schedule: - cron: '17 10 * * *'` to its `on:`.

## The frontend's deploy

The frontend's `pages.yml` (branch `ci-export`) runs its tests, checks out this repo into
`backend/` with the deploy key, runs `node backend/scripts/export-static.js --out public`,
builds with the run's id as the data version (so browsers fetch the night's data), refuses
a `dist` of 950 MB or more (GitHub Pages publishes up to 1 GB; it's about 800–900 MB with
the images), and deploys. The export takes about 15 minutes, on the public repo's free
minutes. The branch's second commit stops tracking `public/api` and
`public/assets/players`; the old exports stay in its history. Until it's merged, the
nightly's dispatch redeploys the committed data, and refreshing the site means exporting
and pushing the frontend by hand.

## Runbook

- **A red run:** open it; the red steps failed and the ones after still ran. If the checks
  passed, everything else was committed and deployed. "Re-run all jobs" runs every pull
  again, which is safe.
- **Skip a step for a while:** add `if: false` to it.
- **The Mac job failing** (its log): the cloud run builds from the last play-by-play it
  pushed. If it can't run for a while, skip steps 13–16 and delete
  `data/footprint/<season>/`, which otherwise goes stale while still taking precedence
  over the lineup pull's. Its sources are stats.nba.com's `playbyplayv3` and
  `boxscoretraditionalv3`; cdn.nba.com's liveData files refuse any non-browser client.
- **The sheet:** don't run sheet scripts by hand between 10:00 and 11:30 UTC. Each run shows
  the season before in the sheet for a minute, and the recent shift's window while
  it runs. Don't cancel a run during steps 3–5: a killed step can't put the sheet back. If
  one was killed, set `Instructions!A13` to the season, clear `E13:F13`, and put back the
  `'PBP Team'!II52`, `IL52` and `IH60` formulas (originals in `scripts/backfill-seasons.js`
  `TEAM_AVERAGES`).
- **Local work:** pull before changing `data/`; the run commits it every night.
- **Minutes:** 2,000 a month on the free tier, shared by all private repos; when they run
  out, runs stop until the month resets. Expect about 20–35 minutes a night until January
  and 35–70 after. If it gets tight: fetch game logs only for players whose team played,
  or run the recent shift every other day.

## Season rollover (each October)

- **Sheets, by hand:** the production sheet's `Instructions!A13` → the new season; the
  minutes-floor start date behind `'League data'!D1` → opening night; rookies into
  `Pos & Height` (missing ones get a wrong BPM); the team sheet's season.
- **The repo variable** `SEASON` → the new season.
- **The bucket:** the Mac job's first run after opening night writes the new
  `<end year>/` tracking files; the season pull won't settle without them.
- **One-token bumps,** once the new keys exist: `lib/teamboard.js` `SEASONS`,
  `scripts/tracking-seasons.js` `LAST_END_YEAR`, and the frontend's `src/TeamBoard.jsx`
  `SEASON`.
- **Before the first lineup pull of the new season:** the finished season's lineups go into
  `data/history/[playoffs/]lineups/<season>/` (copy `data/lineups/` and
  `data/playoffs/lineups/`), then `node scripts/history-players.js`.
- **New players:** `nba-fallback.js` for their headshots. Their NBA ids come from the lineup
  pull until site_Data lists them; `data/bio-review.json` names anyone still unmatched.
- **Lineups and WOWY** are empty for the first days: the site shows dashes until units clear
  the minutes floors (`lib/lineups.js` `FLOOR_RULES`). The recent shift starts on day 30.

## Limits and risks

- **pbpstats** is a free community API (it has returned 503s and HTML error pages): keep
  its 1 s pause, and its steps one after another.
- **ESPN and NBA.com** are unofficial endpoints; they can change or block without notice.
  The probe's table shows which answer each night.
- **One production sheet** drives everything, other people use it, and the run writes
  `A13` and `E13:F13` every night.
- **Image rights:** the illustrated portraits are AI edits of NBA.com/Getty photos whose
  licence is unknown, and the fallbacks are NBA.com headshots. They are published on the
  public site by choice (2026-10-07); revisit before anything commercial. Team logos are
  ESPN's.
