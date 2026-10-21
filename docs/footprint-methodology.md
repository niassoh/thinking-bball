# Footprint: methodology

The Footprint tab shows how a player's team plays with him on the floor against with him
off it, raw on/off, from every five-man lineup his teams used in a regular season or a
span of them. Each stat is his team's (or, in the teammates row, his teammates' alone),
tested against its own noise and against how big that swing usually is across the
league, then checked against the teammates who could explain it.

It is computed on request by `lib/footprint.js` from lineup totals built offline by
`analysis/footprint/footprint_pbp.py` into `data/footprint/<season>/` (1996-97 on).
The earlier v2, a ridge-regression model of adjusted effects (`analysis/footprint/model.py`,
`export.py`, `data/footprint/footprint.json`), was retired for raw on/off (audit #101);
its scripts remain but nothing on the site reads them.

## Data

- **Source.** Raw event-level play-by-play, one CSV per season, regular-season games
  only, rebuilt into a possession cache (`analysis/footprint/build.py`,
  `data/cache/pbp/<season>/`, gitignored): every possession with the ten players on the
  floor, every shot (shooter, x/y, zone), free throw trip (shooter, kind, attempts),
  turnover, rebound and foul.
- **Older seasons (1996-97 to 2012-13)** come from the same archive, in the same format.
  Team-level rows (team rebounds and turnovers) name the team by id, so they take the code
  the game's players carry (NJN, SEA, VAN, CHH, NOH, NOK; `pbp.py` `era_codes`). The league
  had 29 teams through 2003-04. Before 2010-11 layups, dunks and tips are logged at the
  rim's own point (0, 0), so their zone comes from where the shot was taken, the rim, as
  the shot type says; a few hundred jump and hook shots a season are logged there too and
  count as rim shots.
- **Game dates** (to order a team's games and cut them at trades) come from pbpstats from
  2000-01 (`scripts/footprint-games.js`) and, before it, from ESPN's team schedules matched
  to the archive's games by teams and final score (`analysis/footprint/espn_games.py`).
- **Lineup files.** `footprint_pbp.py` sums them per five-man lineup and team-season, in
  chunks of dates cut where a traded player came or went: seconds, possessions,
  plus-minus, and counts for the team (`t`) and its opponent (`o`): pbpstats' 22 box-score
  fields plus the Footprint's own zones (`RimFGM/A`, `PaintFGM/A`, `RimFTM`, `PaintFTM`);
  and each player's own counts in that lineup (`p`: points, twos and threes made and taken,
  free throws, rim makes, rim free throws).

### Rebuilding the floor

The files have no lineup column. A substitution row names the outgoing player by id and
the incoming player by surname. The rebuild works like this:

- **Period starters** are the players whose first appearance in a period comes before any
  sub-in. If fewer than five are found, the period is filled from the previous period's
  floor.
- **Incoming names** are resolved against the game's roster, then the season's, then full
  names. The resolver handles accents ("Doncic"), written-out umlauts ("Pöltl"), suffixes
  and first-name prefixes ("Jay. Williams").

**Validation against pbpstats** (2024-25 and 2025-26):

| Check | Result |
|---|---|
| Player floor minutes | 99.99% of pbpstats player-minutes matched; median player error 0.00% |
| Possessions per team | within −0.29% … +0.43% of pbpstats |
| Possession points vs final score | equal in every game |
| Player actions by someone off the rebuilt floor | at most 1 per season |
| Lineup counts (2024-25 league totals) | within 1%, except FTA −2% (technical free throws aren't kept) and OREB +1.9% |

### Possessions and counts

A possession ends on a made field goal (after any and-one), a defensive rebound, a
turnover, the last free throw of a trip when it goes in, or the end of a period. As in
pbpstats, a possession counts when it has a shot, a free throw or a turnover, garbage time
included; events go to the five on the floor at its first live action.

- **Rebounds** as pbpstats counts them: a team rebound on a possession that ends the period
  (the placeholder after a last-second miss) is dropped; other team rebounds count.
- **Zones.** The Footprint's rim is a two under 5 ft; paint extended, a two from 5 to
  14 ft (straight-line distance). pbpstats' own fields (at the rim within 4 ft, short
  mid-range to 14) are kept as they are for the cross-check.
- **Their free throws** (`RimFTM`, `PaintFTM`): an and-one goes with its make's zone. A
  two-shot shooting-foul trip fouled a missed two, which the data doesn't place: its made
  free throws are split between the zones by where that shooter's and-ones were that
  season (fouled twos that can be placed), blended with the league's split as if he had
  10 more. The league's fouled twos ran 68–79% under 5 ft and 17–28% at 5–14 ft (the
  floater range growing since 2020-21), 3–6% longer. Bonus, flagrant, clear-path and
  three-shot trips count with neither.
- **Runouts** (`RunoutPoss`, and their rim and paint makes and free throws): possessions
  begun by a steal whose first shot or shooting foul came within 6 seconds, mostly
  undefended breaks. Rim protection and paint extended leave them out, points and
  possessions alike; a dead-ball turnover is inbounded, so it hardly ever gives one.
- **Own counts** add up to the team's in 98.5% of lineups; about 0.1% of points belong to a
  shooter subbed in after the possession's five was set and stay with the team only.

## The stats

| Row | Stat | Measure, with him on vs. off | Better |
|---|---|---|---|
| Offense | Offensive rating | points per 100 possessions | higher |
| | Corner share | corner share of 3PA | higher |
| | Ball security | TOV% | lower |
| | Offensive glass | OREB% | higher |
| | Pace | possessions per 48 | style |
| Teammates | Shooting efficiency | teammates' TS% | higher |
| | Rim scoring | teammates' points under 5 ft, with their free throws, per 100 of their true-shot attempts | higher |
| | Three-point share | teammates' 3PA share of FGA | higher |
| | Three-point accuracy | teammates' 3P% | higher |
| Defense | Rim protection | opponents' points under 5 ft, with their free throws, per 100 possessions, runouts left out | lower |
| | Paint extended | opponents' points under 14 ft (rim and floater range), with their free throws, per 100 possessions, runouts left out | lower |
| | Floater range | opponents' points from 5 to 14 ft, with their free throws, per 100 possessions, runouts left out | lower |
| | Corner denial | opponents' corner 3PA share of FGA | lower |
| | Turnover pressure | forced TOV% | higher |
| | Defensive glass | DREB% | higher |
| | Foul discipline | opponents' FTA per FGA | lower |

- **Teammates only.** With him on, a teammate stat counts only his teammates' shots (the
  team less his own); with him off, everyone's. A player who takes his team's twos himself
  no longer reads as changing its shot mix: Giannis Antetokounmpo's teammates take 57% of
  their shots from three with him on (2023-24 and 2024-25), while Milwaukee's whole-team
  share dips, his own shots being 7% threes.
- **Per 100 shots, not possessions,** for teammates' rim scoring: beside a high-usage
  player his teammates shoot less, which per possession would read as less rim scoring.
- **Pace** is a style stat, neither good nor bad, and shows grey.

## Noise, and what lights up

Each team-season's on−off is its own slice; slices are averaged weighted by
1/(1/n_on + 1/n_off), so a player traded mid-season is measured against each team over his
time there only, and a span against each season's team.

Each swing gets a z from its sampling noise:
- shares: binomial;
- points per 100: Poisson in scoring plays (a free throw trip counts as two shots' worth);
- offensive rating: per-possession variance 1.4;
- TS%: delta method over attempts (a field goal weighs 1, a free throw 0.44);
- free throw rate: Poisson trips of two; tempo: v/√possessions.

A tile lights when |z| ≥ 2.5 and the swing is bigger than 75% of qualified players'
swings in that stat over the same seasons (500+ minutes on, 300+ off; over a span of
seasons, also the top half of those by minutes on the floor across it, at or above their
median).

## Checks against teammates

- **Who moves with him.** A lit swing is checked against the teammates whose share of the
  floor moves 15 points or more with his: the one who takes his minutes (replacement) and
  the one he plays with most (partner), if they stand out (top or bottom 30th percentile)
  in the skill behind the stat. If the gap without them is under half the swing, they
  explain it (the document's `context`; the tab no longer shows it).
- **LONE** (offense and teammate stats, REMOVE BEST's green box). Its options are the
  stretches the Lonestar tab offers him over the same seasons (`lib/lonestar.js offered`):
  without each star (a ball-handler's ball competitors too), each top two, and all of them
  combined, each team-season without its own, each needing 200 minutes with its stars and
  200 without (Harden's 2025-26: Leonard with the Clippers, Mitchell with the Cavaliers,
  and both combined). Every offense and teammate stat is measured again over only the
  minutes the picked option's teammates sit (off the floor on both sides, a pair both),
  pooled over the team-seasons it covers, exactly as the tile is: lit by the same bar, its
  on value against the league, its percentiles, and his minutes on and off there (thin
  when a side is under half the stat's sample).
- **LONE** (defense stats, the lavender box). Their anchor is a defensive monster: of the teammates on the
  floor for a quarter of a team-season's minutes or more, the one with the best defensive
  EPM (Dunks & Threes, `data/epm.json` from the user-supplied export, 2001-02 on) among
  those in the league's top 10% that season, the top 10% of its rotation players (EPM's
  estimate of 15+ minutes per 48): +1.478 and up in 2005-06, +1.228 in 2015-16. Duncan
  (+2.311) beside Parker in 2005-06; Bogut (+2.823) beside Green in 2015-16, where Curry
  (+1.225, 32nd of 318) misses the line. A player who is a monster himself goes without
  his next-best defender by defensive EPM, monster or not (Duncan's 2005-06: Ginóbili,
  +2.1; Gobert's 2016-17: Ingles, +0.9). The defense stats are measured again without
  him as the offense stats are without theirs, an option per monster over the seasons he
  anchors and, with several, all combined; a season with no monster, or before 2001-02,
  has none, and with none the row stays on all his minutes.
- **Teammate effect.** A lit swing that keeps under half of itself in LONE's first pick
  (all combined where there is one, else the first single), or turns round, against his
  whole on/off over the same team-seasons, is marked as a teammate effect: most of it is
  those teammates' minutes. It can also be an accident of a small sample when they rarely
  sit. In LONE, a tile lit on all his minutes stays lit while the picked option keeps at
  least half its swing the same way.

## Against the league

**VS LG** is the on value against the league's that season (slice by slice, so a span
across eras compares each season with its own league), ranked among every qualified
player's the way the stat helps (fewest points allowed is the 100th percentile).

A lit tile's swing is placed among every qualified player's swing, from its nearer end
(`rank`: place, of, best or worst); an unlit one has none, so a badge never sits on a swing
the tab calls noise. One among the league's 10 best gets a badge with its place, gold for
#1 and silver for #2 to #10; otherwise one in the top 3% gets a medal: gold for the top 1%,
silver the top 2%, bronze the top 3%. One among the 10 worst gets an orange badge with its
place from the bottom. In 2025-26, 19 of the 60 most-played players hold a badge or medal
and 12 a bottom-10 badge.

## The season being played

Until a season is built from play-by-play, its lineups come from the daily pbpstats pull
(`scripts/lineups.js`), which has the 22 base fields and no own counts. Its rim and
teammate stats show as not available; everything else works.

## Reproducing

```
cd analysis/footprint && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements.txt
.venv/bin/python build.py 1996-97 ... 2025-26                 # the possession cache, from the play-by-play archive
node scripts/footprint-games.js <season>                       # game dates from 2000-01, 1 pbpstats call a season
.venv/bin/python espn_games.py 1996-97 1997-98 1998-99 1999-00 # game dates before, ESPN's team schedules (cached)
.venv/bin/python footprint_pbp.py --check 2024-25              # against the pbpstats files on disk
.venv/bin/python footprint_pbp.py 1996-97 ... 2025-26          # data/footprint/<season>/, about 2 min
.venv/bin/python -m unittest discover .
```
