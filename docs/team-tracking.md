# Team tracking CSVs for the Teams sheet

NBA.com's team-level tracking tables, one CSV per measure per season, in the
`thinkingbball` bucket, for the Teams sheet (`1_MOhMxiijKUt31qscH08z2aCMnb0uE18pJLEp6NWJIg`)
to IMPORTDATA by season. Written by `scripts/team-tracking.js` (measures in
`lib/team-tracking.js`), audit rows #212 onward in `docs/data-pull-audit.md`. Team play
types go to the bucket's older `<end year>/playtype/` folder instead (below).

## Pattern

```
https://storage.googleapis.com/thinkingbball/<end year>/team_tracking/<measure>.csv
https://storage.googleapis.com/thinkingbball/<end year>/playoffs/team_tracking/<measure>.csv
https://storage.googleapis.com/thinkingbball/<end year>/playtype/<play type>.csv
https://storage.googleapis.com/thinkingbball/<end year>/playoffs/playtype/<play type>.csv
```

`<end year>` is the season's second year (2013-14 is `2014`), the same season folder
the player files use (`<end year>/player_tracking/`, `<end year>/playoffs/player_tracking/`).
The Teams sheet already has it as `Instructions!B13` (`=LEFT(A13, 4)+1`).

Why a new `team_tracking/` folder rather than the bucket's older team folders: those
(`<yr>/team_shooting/`, `<yr>/opp_shooting/`) are site_Data layouts with gaps
(`opp_shooting` only 2025 and 2026), full team names in some years and abbreviations in
others, and they were left as they are. Every file here comes from one pull with the
same layout in every season.

`<yr>/playtype/` is the exception: the Teams sheet's play type tabs are built on that
path, so the play types are written there, in that folder's layout, rather than into
`team_tracking/`. Before 2026-10-25 it didn't follow the season: 2014–2020 each held the
same copy of 2022-23, 2021–2023 and 2027 had no folder, 2024–2026 were part-season
snapshots (44, 78 and 4 games) and `2025/playoffs/playtype/` was the regular season's
files. All of it was rebuilt from NBA.com (audit #217–#219; the old objects are backed
up in `data/sources/bucket-backup/playtype-20261025-200846/`). The bucket root's
`playtype/` folder (2022-23 too) and `teamplay.csv` were left as they are.

Each CSV has NBA.com's resultSet headers and values exactly as served: season totals
(`PerMode=Totals`), percentages as 0–1 (the player CSVs are 0–100), one row per team,
`TEAM_ID`, `TEAM_NAME` and `TEAM_ABBREVIATION` columns. A measure NBA.com returns empty
(such as the playoffs of a season still being played) has no file.

## Measures

| File | NBA.com endpoint and filter | Starts |
|---|---|---|
| `speed_distance` | `leaguedashptstats` Team, `SpeedDistance` | 2014 |
| `rebounding` | `leaguedashptstats` Team, `Rebounding` (contested, chances, adjusted) | 2014 |
| `possessions` | `leaguedashptstats` Team, `Possessions` (touches, time of possession) | 2014 |
| `catch_shoot` | `leaguedashptstats` Team, `CatchShoot` | 2014 |
| `pullup` | `leaguedashptstats` Team, `PullUpShot` | 2014 |
| `defense` | `leaguedashptstats` Team, `Defense` (rim protection: `DEF_RIM_FGA`, `DEF_RIM_FG_PCT`) | 2014 |
| `drives` | `leaguedashptstats` Team, `Drives` | 2014 |
| `passing` | `leaguedashptstats` Team, `Passing` | 2014 |
| `elbow_touch`, `post_touch`, `paint_touch` | `leaguedashptstats` Team, `ElbowTouch` / `PostTouch` / `PaintTouch` | 2014 |
| `efficiency` | `leaguedashptstats` Team, `Efficiency` | 2014 |
| `shooting_very_tight`, `shooting_tight`, `shooting_open`, `shooting_wide_open` | `leaguedashteamptshot`, closest defender 0–2 / 2–4 / 4–6 / 6+ ft: the team's own shots | 2014 |
| `opp_shooting_very_tight`, `opp_shooting_tight`, `opp_shooting_open`, `opp_shooting_wide_open` | `leaguedashoppptshot`, the same ranges: its opponents' shots | 2014 |
| `defend_overall`, `defend_3pt`, `defend_2pt`, `defend_lt6`, `defend_lt10`, `defend_gt15` | `leaguedashptteamdefend`, `DefenseCategory` Overall / 3 Pointers / 2 Pointers / Less Than 6Ft / Less Than 10Ft / Greater Than 15Ft | 2014 |
| `../playtype/<play type>` (next section) | `synergyplaytypes`, team, offensive (Synergy, not tracking; the sheet's Playtype columns use it) | 2014 |

`drives` is also written to `playtype/drives.csv`, as that folder had it.

## Play types: `<end year>/playtype/`

Each play type is written twice, the same file under two names: `teamplay.csv`'s
`playtype` key, which the sheet's tabs are keyed by, and the folder's old name.

| NBA.com `PlayType` | File (teamplay.csv key) | Also as (old name) |
|---|---|---|
| `Isolation` | `iso` | |
| `Transition` | `tran` | `trans` |
| `PRBallHandler` | `pr_ball` | `bh` |
| `PRRollman` | `pr_roll` | `rollman` |
| `Postup` | `post` | `postup` |
| `Spotup` | `spot` | `spotup` |
| `Handoff` | `hand_off` | `handoff` |
| `Cut` | `cut` | |
| `OffScreen` | `off_screen` | `offscreen` |
| `OffRebound` (putbacks) | `oreb` | `putback` |
| `Misc` | `misc` | |

Layout (the folder's, not NBA.com's): one row per team in NBA.com's order, header
`TEAM,GP,POSS,FREQ%,PPP,PTS,FGM,FGA,FG%,EFG%,FTFREQ%,TOVFREQ%,SFFREQ%,AND ONEFREQ%,SCOREFREQ%,PERCENTILE`,
full team names as NBA.com gives them (`LA Clippers`; `Los Angeles Clippers` in 2014 and
2015), percentages 0–100 to one decimal, PPP to two (`0.9`, `1.0`, `0.95`). `drives.csv`:
`Team,GP,W,L,MIN,DRIVES,FGM,FGA,FG%,FTM,FTA,FT%,PTS,PTS%,PASS,PASS%,AST,AST%,TO,TOV%,PF,PF%`,
the same way. `teamplay.csv` at the bucket root is a different layout (`Team` as
abbreviations, `Points` for `PTS`, `full_name`, `year`, `playtype` and NBA.com columns
after).

Rebuilt from NBA.com, 2022-23 came out byte for byte as the copy that sat in 2014–2020
(but for line endings), 2014–2020's `drives.csv` the same, and every team row of
2014–2025 matches `teamplay.csv` to its rounding (3,960 rows). NBA.com's Synergy has
2025-26 at 77–80 games a team, not 82 (`teamplay.csv` too).

## What the Teams sheet uses, and how it gets it today

The sheet calls neither NBA.com nor these files directly (read 2026-10-25, audit #212):

| Sheet columns | Comes from today | NBA.com source | File here |
|---|---|---|---|
| `Format` I `LA Bayes Win-pace`, AG `Adj rDRTG` (through `Local import` BD `3pt luck`), AM `Opp Wide Open 3s/g` (`Local import` BE) | `Luck Import!A1`: IMPORTRANGE of `Format!A1:G33` in the luck sheet `1kS_bi91…` (`6 ft luck`, `6 ft 3pa`, `4-6 luck`, `4-6 3pa`, `4+ 3pt luck`). Its formulas weren't readable (no access). | Opponents' 3s by closest defender, 6+ ft and 4–6 ft | `opp_shooting_wide_open`, `opp_shooting_open` |
| `Format` J–Q (Half-Court, Off-Ball, PnR, Iso-Post PPP and shares) | `Off Playtype!B35`/`R35`: IMPORTRANGE of `PlayType!A2:P1000`/`R2:R1000` in `1dJa8…` (long table: one block of 30 teams per play type, keyed in R); `Old Off Playtype` IMPORTDATAs `<yr>/playtype/<kind>.csv` | Team offensive Synergy play types | `../playtype/<play type>` |

Everything else in the sheet is pbpstats, Basketball-Reference or site_Data.

## Formulas

Any file, the season from `Instructions!A13`:

```
=IMPORTDATA(CONCATENATE("https://storage.googleapis.com/thinkingbball/", Instructions!$B$13, "/team_tracking/drives.csv"))
```

A fixed season, e.g. 2013-14:

```
=IMPORTDATA("https://storage.googleapis.com/thinkingbball/2014/team_tracking/drives.csv")
```

Playoffs: `/playoffs/team_tracking/` in place of `/team_tracking/`. IMPORTDATA keeps a
URL's result for about an hour; the stats sheet adds `?v=<date>` to its URLs and bumps
it after a re-upload, which works here too (`.../drives.csv?v=20261025`).

**Opponents' open and wide-open 3s** (the luck inputs), team abbreviation, 3PA a game,
3P%; the wide-open block's second column is `Opp Wide Open 3s /g`:

```
=LET(raw, IMPORTDATA(CONCATENATE("https://storage.googleapis.com/thinkingbball/", Instructions!$B$13, "/team_tracking/opp_shooting_wide_open.csv")), d, CHOOSEROWS(raw, SEQUENCE(ROWS(raw) - 1, 1, 2)), HSTACK(CHOOSECOLS(d, 3), CHOOSECOLS(d, 17) / CHOOSECOLS(d, 4), CHOOSECOLS(d, 18)))
```

(`opp_shooting_open.csv` the same for 4–6 ft.) Columns: 3 `TEAM_ABBREVIATION`, 4 `GP`,
17 `FG3A`, 18 `FG3_PCT`. The luck figures themselves are worked out in the luck sheet,
whose formulas need to be pointed at these (or copied in) by someone with access to it.

**A play type**, the season from `Instructions!A13` (the file name is the key):

```
=IMPORTDATA(CONCATENATE("https://storage.googleapis.com/thinkingbball/", Instructions!$B$13, "/playtype/iso.csv"))
```

Playoffs: `/playoffs/playtype/`. **Off Playtype**, in place of the IMPORTRANGE at `B35`
(and `R35`): one block of 30 rows per play type, at B35, B65, B95, … B335. The file's
16 columns are the tab's B–Q in order (B team, C GP, D POSS, E FREQ%, F PPP, G Points,
… Q PERCENTILE), R the key:

```
=LET(raw, IMPORTDATA(CONCATENATE("https://storage.googleapis.com/thinkingbball/", Instructions!$B$13, "/playtype/iso.csv")), d, CHOOSEROWS(raw, SEQUENCE(ROWS(raw) - 1, 1, 2)), HSTACK(d, IF(SEQUENCE(ROWS(d)), "iso")))
```

with `iso`, `tran`, `pr_ball`, `pr_roll`, `post`, `spot`, `hand_off`, `cut` (the tab's
key is `CUT`), `off_screen`, `oreb`, `misc` (`MISC`). The tab's formulas read only B
(team), D (POSS), G (Points) and R. B is a full team name here, where the tab's
IMPORTRANGE gives abbreviations; percentages are 0–100, as the tab has them.

These formulas follow the stats sheet's working tracking imports
(`scripts/sheet-tracking-imports.js`) but haven't been entered in the Teams sheet.

## Keeping it current

`scripts/mac-nightly.sh` re-pulls the season being played each morning and uploads it
(`node scripts/team-tracking.js --from=$end --to=$end --refresh --upload`), next to the
player tracking upload: its `team_tracking/` files and its `playtype/` files, both
names. Regular season only, like the player step; a playoff run is `--playoffs`.

Backfill or re-pull by hand:

```
node scripts/team-tracking.js --from=2014 --to=2027 [--playoffs] [--refresh] --upload
```

Raw responses are cached in `data/cache/nba-team-tracking/` (a stopped run picks up
where it was), CSVs written to `data/sources/team-tracking/` (both gitignored). The upload
uses `~/.gcp/thinking-basketball.json`, skips a file the bucket already has byte for
byte and one with fewer teams than the bucket's copy (`--force` overwrites that one: for
a copy known to be wrong, backed up first), and reads each one back over its public URL.
