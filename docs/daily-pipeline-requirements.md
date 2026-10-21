# Daily pipeline

How the public site (https://niassoh.github.io/tbball/) stays current in season: a
nightly run in this repo pulls every source into `data/` and commits it, and the
frontend's deploy builds the site from that. Changes to the pulls are recorded in
`docs/data-pull-audit.md`; each pull's own notes are in `docs/player-profile-pipeline.md`.

## Where things stand (2026-10-21)

- **Built, not yet on GitHub:** the nightly workflow (`.github/workflows/nightly.yml`), its
  probe and check scripts, every pull made safe to run unattended, and our own
  play-by-play for the season being played, feeding its Footprint and Lonestar (audit
  #162–#175), on branch `nightly-pipeline`. The backend has no GitHub repo yet (its only
  remote is a stale Heroku app). The frontend's deploy building the data itself (below) is
  on the frontend's branch `ci-export`, also not pushed.
- **To do before the first run:** the setup below, the 2026-27 rollover in the sheets, and
  seeding the bucket's 2027 tracking files.
- **Next:** the schedule, once a dispatched run is green.

## The nightly run

`.github/workflows/nightly.yml`, on GitHub Actions' free tier. Dispatched by hand until
its first green run; then every night at 10:17 UTC (about 6 am ET), after the last game.
Steps run one after another; each pull has a timeout and `continue-on-error`, so a source
that fails keeps yesterday's files and the rest still run.

| # | Step | Command | Writes |
|---|---|---|---|
| 1 | Reachability | `node scripts/reachability.js` | the job summary: whether stats.nba.com, pbpstats, ESPN and Google answer from the runner |
| 2 | Depth charts, injuries | `npm run pull:depth` | `data/depth/` |
| 3 | Season sheet | `node scripts/backfill-seasons.js $SEASON` | `dailycat-<YY>`; drives the **production sheet**: loads the season before into `Instructions!A13` (unsaved) and then the season, so its imports refetch |
| 4 | Team sheet | `node sheets-teamcat.js --season=$SEASON` | `teamcat-<YY>` |
| 5 | Recent shift (only if 3 succeeded) | `npm run pull:recent` | `data/recent-shift.json`, `data/recent-window.json`; sets and then clears the sheet's date window (`E13:F13`); skips itself until the season has 30 days of games |
| 6 | Lineups | `npm run pull:lineups` | `data/lineups/`, `data/lineup-players.json`, `data/stints.json` |
| 7 | Bio | `npm run pull:bio` | `data/bio.json`; a rookie site_Data doesn't list yet takes the NBA id from 6's player list |
| 8 | Player totals | `npm run pull:player-totals` | `data/player-totals.json` |
| 9 | Game logs, WOWY | `npm run pull:games` | `data/gamelog/`, `data/wowy/` (WOWY summed from 6's files) |
| 10 | Shots | `npm run pull:shots` | `data/shotshift/`; ESPN's finished games are cached between runs |
| 11 | Tracking seasons | `node scripts/tracking-seasons.js` | `data/tracking-seasons.json`, from the bucket's season files |
| 12 | Play-by-play | `node scripts/pbp-fetch.js` | `data/pbp/<season>/<gameId>.json.gz`: each new game's NBA.com v3 play-by-play and starters, checked against pbpstats' final score (kept in git, about 10 KB a game) |
| 13 | Game dates | `node scripts/footprint-games.js $SEASON` | `data/footprint/<season>/games.json` |
| 14 | Possessions | `python analysis/footprint/build.py $SEASON` | the season's possession cache (not kept), rebuilt from 12's files |
| 15 | Footprint (if 13 and 14 succeeded) | `python analysis/footprint/footprint_pbp.py $SEASON` | `data/footprint/<season>/`: profiles take the season's Footprint from here (with rim free throws and teammate counts) instead of 6's files |
| 16 | Lonestar (if 3 and 14 succeeded) | `node scripts/lonestar.js --source=pbp --season=$SEASON --refresh` | `data/lonestar/<season>/`, `league.json`; stars need 500 minutes, so until about Nov 20 the files name none and profiles show no view |
| 17 | Checks (fatal) | `node scripts/nightly-check.js`, every test file except the export's, and `analysis/footprint`'s Python tests | nothing; if they fail, nothing is committed and the site keeps yesterday's data |
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

## Not in the nightly yet

- **Tracking files → the bucket** (`gs://thinkingbball/<end year>/`, read by the sheet's
  `IMPORTDATA`): `python3 scripts/playoff-tracking-pull.py <site_Data> <out> 2027 2027
  --regular`, then upload the six files, from the laptop, about weekly. stats.nba.com is
  known to drop requests from cloud machines; if the probe shows it answering from the
  runner, this can move into the nightly. Before uploading, check the league's time of
  possession is at most 24 minutes per team-game and drive free throws are there
  (`docs/tracking-source-investigation.md`).
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
- **The play-by-play fetch failing every night** (the probe's stats.nba.com rows say no
  answer: NBA.com is dropping the runner): run `node scripts/pbp-fetch.js` from the laptop
  and push (its files only ever get added), or skip steps 12–16 and delete
  `data/footprint/<season>/`, which otherwise goes stale while still taking precedence
  over the lineup pull's. Its source is stats.nba.com's `playbyplayv3` and
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
- **The bucket:** seed the new `<end year>/` tracking files from the laptop before the
  first season pull, which won't settle without them.
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
