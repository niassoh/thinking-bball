# Tracking source investigation: site_Data vs NBA.com (2024-25, 2025-26)

Date: 2026-10-01 (PDT). This was read-only: nothing was written except this file and the scratch folder.
Scratch data (CSV downloads, comparison tables, scraper copies) is in
`/private/tmp/claude-501/-Users-pzh-thinking-bball/2e2b5c80-04a6-4e1e-845b-04ada3ca8219/scratchpad/source-investigation/`.

## Conclusion

**The scraper didn't change. NBA.com changed the data it serves for 2024-25 and 2025-26, and it did so
after site_Data's last pulls (drives and touches after 2026-06-14; closest-defender after 2026-08-15).**
site_Data's files hold what NBA.com published at the end of each season, on the same scale as 2013-14…2023-24.
NBA.com now returns different numbers for the identical request URL. The new numbers are on a new scale and,
for 2024-25, are visibly broken.

| Stat family | 2024-25: trust | 2025-26: trust | Confidence |
|---|---|---|---|
| Drives (count, FGA, FTA, PTS) | **site_Data** | **site_Data** if comparing across seasons. NBA.com's new numbers are internally consistent but on a new scale | High that NBA.com changed; high that NBA.com 2024-25 is broken; medium on which 2025-26 definition is "right" |
| Touches, front-court touches, time of possession | **site_Data** | **site_Data** | High. NBA.com 2024-25 TOP is physically impossible; NBA.com 2025-26 TOP is implausible |
| Catch & shoot, pull-up | Either (within ~1–5 %). site_Data for consistency | Either. site_Data for consistency | High |
| Wide open (closest defender 6+ ft) | **site_Data** for history-consistent values | **site_Data** for history-consistent values | Medium-high. Both sources partition the same shots, but NBA.com re-bucketed defender distances |

What "correct" means here: site_Data equals NBA.com's own end-of-season publication, under the definitions used
for every season since 2013-14. NBA.com's current 2024-25 drive table has almost no free throws (520 drive FTA
league-wide, against 16-17k in every other season), and its time of possession exceeds the available game time.
That is a defective reprocessing, not a better measurement. For 2025-26, NBA.com's new numbers pass the internal
checks except time of possession. They may come from a new, looser drive definition or detector, but they can't
be compared with any earlier season. Nothing on NBA.com announces or documents the change. The glossary's drive
definition is the old one, and the drives page still shows a "Second Spectrum" provider logo.

### Verified vs inferred

**Verified (by direct reads):**
- All site_Data scrapers request exactly `PerMode=Totals`, `SeasonType=Regular Season`, `LastNGames=0`, empty
  `DateFrom/DateTo`, `Month=0`, `OpponentTeamID=0`, empty `Location`/`Outcome`/`SeasonSegment`. There is no filter.
- The same URL, sent from an NBA.com tab today, returns NBA.com's new numbers (163,285 league drives in 2025-26 against
  118,046 in site_Data). Player count (582) and minutes (593,509 vs 593,511) are the same.
- 2013-14…2023-24: league totals for drives (count, FGA, PTS), touches, front-court touches and TOP are identical in
  both sources. In 2023-24, all 75 player × stat values checked are identical.
- The site_Data 2024-25 drives and touches values have not changed since 2025-04-20. Four commit versions were compared
  (2025-04-20, 2025-11-24, 2026-02-09, 2026-02-10).
- site_Data's playoff tracking file (`tracking_ps/drives.csv`, last committed 2026-06-14) has 8,104 drives for the
  2025-26 playoffs. NBA.com today shows 10,975 drives for the same playoffs, with identical minutes (41,099).
- site_Data's `fix_shooting.py` refetched every closest-defender season, and the 2026-08-15 commit "cap update"
  (`070a59ba`) wrote it. In that commit 2024-25 wide-open came back identical to April 2025 (54,260 FGA; only the
  row order changed), and 2025-26 came back at 54,716 FGA. NBA.com today returns 54,774 and 52,942.
- NBA.com's current 2024-25 data has internal defects: league drive FTA is 520 and drive FTM 407 (other seasons have
  16–18k). Playoff 2024-25 drive FTA is 0. Rudy Gobert's 2024-25 C&S 3PA is null. League TOP is 86,136 min, which is
  35.0 min per team-game in a 48-minute game (historically ~20.8).
- The changes are not a uniform scale: Jokić's drives ×2.02, Brunson's ×1.37 in 2025-26. Box-score-like fields that
  don't depend on tracking match exactly (Possessions-endpoint `POINTS`: 280,010 / 284,395 in both sources).
- The closest-defender buckets still sum to the same shots in both sources (2024-25 3PA 92,299 vs 92,298; 2025-26
  90,680 vs 90,676). The shots are the same; only the defender-distance classification moved. NBA.com's very-tight
  bucket went 14,748 → 26,745 FGA in 2024-25.

**Inferred (not directly proven):**
- That one NBA.com reprocessing event caused all of these changes, and that it happened between 2026-08-15 and
  2026-10-01. The closest-defender window is proven. For drives and touches it is only bounded to after 2026-06-14.
- That the cause is a tracking-pipeline rerun. Hawk-Eye has been the provider since 2023-24 per the NBA/Sony
  announcement, and 2023-24 still matches, so a provider switch alone doesn't explain it. A backfill with a new
  Hawk-Eye-based model or event detector is the likely cause. No NBA.com page says so.

## League totals per season (regular season, sum over all players)

| Season | Drives site_Data | Drives NBA.com | Drive FTA site / NBA | Touches site_Data | Touches NBA.com | TOP (min) site / NBA | C&S FGA site / NBA | PU FGA site / NBA |
|---|---|---|---|---|---|---|---|---|
| 2013-14 | 82,855 | 82,855 | – | 1,015,587 | 1,015,587 | 51,352 / 51,351 | 60,793 / 61,319 | 47,274 / 48,220 |
| 2014-15 | 87,444 | 87,444 | – | 1,025,547 | 1,025,547 | 51,592 / 51,592 | 61,379 / 61,847 | 48,167 / 49,149 |
| 2015-16 | 92,586 | 92,586 | – | 1,034,868 | 1,034,868 | 51,468 / 51,468 | 61,562 / 62,005 | 50,712 / 51,799 |
| 2016-17 | 95,090 | 95,090 | – | 1,021,052 | 1,021,052 | 51,028 / 51,028 | 62,939 / 63,408 | 51,888 / 52,944 |
| 2017-18 | 101,418 | 101,418 | – | 1,028,769 | 1,028,769 | 51,035 / 51,035 | 61,602 / 62,052 | 53,147 / 54,270 |
| 2018-19 | 108,074 | 108,074 | – | 1,029,965 | 1,029,965 | 51,439 / 51,439 | 62,940 / 62,940 | 56,547 / 56,547 |
| 2019-20 | 96,979 | 96,979 | – | 868,748 | 868,748 | 44,209 / 44,209 | 54,954 / 54,954 | 48,949 / 48,948 |
| 2020-21 | 100,602 | 100,602 | – | 876,449 | 876,449 | 44,853 / 44,853 | 57,382 / 57,382 | 49,927 / 49,927 |
| 2021-22 | 110,472 | 110,472 | – | 994,659 | 994,659 | 51,057 / 51,057 | 66,001 / 66,001 | 57,190 / 57,190 |
| 2022-23 | 115,462 | 115,462 | 17,598 / 17,598 | 988,549 | 988,549 | 51,721 / 51,721 | 64,386 / 64,386 | 55,441 / 55,441 |
| 2023-24 | 118,659 | 118,659 | 16,460 / 16,460 | 981,594 | 981,594 | 50,423 / 50,423 | 65,466 / 65,466 | 53,966 / 53,966 |
| **2024-25** | 115,736 | **157,755** | 16,534 / **520** | 1,005,395 | **929,928** | 51,189 / **86,136** | 68,989 / 68,872 | 55,543 / 52,609 |
| **2025-26** | 118,046 | **163,285** | 17,532 / **21,785** | 1,015,126 | **924,260** | 51,260 / **59,274** | 69,259 / 69,080 | 54,927 / 51,527 |

The site_Data series is smooth: drives rise gradually from 83k to 119k and are flat for three years. NBA.com
has a +36–38 % step in exactly the two seasons in question. The step is on NBA.com's side.
(The small 2013-14…2017-18 C&S/pull-up gaps are an older, separate issue, already noted in
`tracking-data-audit.md` §5.)

Other 2024-25 / 2025-26 drive aggregates (NBA.com, site_Data in parentheses): drive FGM 31,623 (25,426) /
33,482 (26,438); drive passes 81,355 (44,237) / 71,634 (44,647); drive PTS 64,436 (65,834) / 84,958 (68,885).
NBA.com 2024-25 has 23 % more drive FGM but fewer drive points, because the free throws are missing.

Closest-defender, all four buckets (FGA / 3PA):

| Season | Source | Very tight | Tight | Open | Wide open | Sum |
|---|---|---|---|---|---|---|
| 2023-24 | both (identical) | 21,692 / 399 | 82,011 / 8,891 | 60,118 / 31,418 | 52,231 / 44,615 | 216,052 / 85,323 |
| 2024-25 | site_Data | 14,748 / 392 | 84,603 / 9,131 | 65,508 / 35,828 | 54,260 / 46,948 | 219,119 / 92,299 |
| 2024-25 | NBA.com | 26,745 / 1,035 | 73,978 / 11,456 | 62,123 / 35,234 | 54,774 / 44,573 | 217,620 / 92,298 |
| 2025-26 | site_Data | 14,468 / 296 | 83,893 / 8,133 | 65,275 / 34,836 | 54,716 / 47,415 | 218,352 / 90,680 |
| 2025-26 | NBA.com | 26,784 / 1,020 | 75,696 / 11,224 | 61,750 / 35,238 | 52,942 / 43,194 | 217,172 / 90,676 |

Box-score 3PA (NBA.com `leaguedashplayerstats`): 86,355 / 92,454 / 90,970. Both partitions cover the same 3PA.

## Evidence tables (players)

**Control, 2023-24:** all 75 checks are identical in both sources (5 players × MIN, drives, drive FGA/FTA/PTS,
touches, front-court touches, TOP, C&S FGA/3PA, PU FGA/3PA, WO FGA/3PA/FGM). For example, Jokić has 417 drives,
7,782 touches and 367.0 TOP in both. **Minutes match exactly in every season** (e.g. Jokić 2,571 / 2,265; SGA
2,598 / 2,259).

#### Drives

| Player | Season | Stat | site_Data | NBA.com | ratio |
|---|---|---|---|---|---|
| Nikola Jokić | 2024-25 | DRIVES | 345 | 602 | 1.74 |
| Nikola Jokić | 2024-25 | DRIVE_FGA | 164 | 224 | 1.37 |
| Nikola Jokić | 2024-25 | DRIVE_FTA | 54 | 0 | 0 |
| Nikola Jokić | 2024-25 | DRIVE_PTS | 222 | 255 | 1.15 |
| Shai Gilgeous-Alexander | 2024-25 | DRIVES | 1567 | 1983 | 1.27 |
| Shai Gilgeous-Alexander | 2024-25 | DRIVE_FGA | 774 | 896 | 1.16 |
| Shai Gilgeous-Alexander | 2024-25 | DRIVE_FTA | 294 | 10 | 0.03 |
| Shai Gilgeous-Alexander | 2024-25 | DRIVE_PTS | 1180 | 1039 | 0.88 |
| Jalen Brunson | 2024-25 | DRIVES | 1157 | 1500 | 1.3 |
| Jalen Brunson | 2024-25 | DRIVE_FGA | 519 | 652 | 1.26 |
| Jalen Brunson | 2024-25 | DRIVE_FTA | 184 | 4 | 0.02 |
| Jalen Brunson | 2024-25 | DRIVE_PTS | 747 | 702 | 0.94 |
| Rudy Gobert | 2024-25 | DRIVES | 45 | 82 | 1.82 |
| Rudy Gobert | 2024-25 | DRIVE_FGA | 27 | 31 | 1.15 |
| Rudy Gobert | 2024-25 | DRIVE_FTA | 4 | 0 | 0 |
| Rudy Gobert | 2024-25 | DRIVE_PTS | 26 | 28 | 1.08 |
| Stephen Curry | 2024-25 | DRIVES | 610 | 842 | 1.38 |
| Stephen Curry | 2024-25 | DRIVE_FGA | 249 | 306 | 1.23 |
| Stephen Curry | 2024-25 | DRIVE_FTA | 68 | 0 | 0 |
| Stephen Curry | 2024-25 | DRIVE_PTS | 311 | 297 | 0.95 |
| Nikola Jokić | 2025-26 | DRIVES | 283 | 573 | 2.02 |
| Nikola Jokić | 2025-26 | DRIVE_FGA | 147 | 226 | 1.54 |
| Nikola Jokić | 2025-26 | DRIVE_FTA | 46 | 83 | 1.8 |
| Nikola Jokić | 2025-26 | DRIVE_PTS | 230 | 350 | 1.52 |
| Shai Gilgeous-Alexander | 2025-26 | DRIVES | 1276 | 1752 | 1.37 |
| Shai Gilgeous-Alexander | 2025-26 | DRIVE_FGA | 590 | 747 | 1.27 |
| Shai Gilgeous-Alexander | 2025-26 | DRIVE_FTA | 250 | 306 | 1.22 |
| Shai Gilgeous-Alexander | 2025-26 | DRIVE_PTS | 954 | 1180 | 1.24 |
| Jalen Brunson | 2025-26 | DRIVES | 1093 | 1493 | 1.37 |
| Jalen Brunson | 2025-26 | DRIVE_FGA | 613 | 767 | 1.25 |
| Jalen Brunson | 2025-26 | DRIVE_FTA | 150 | 196 | 1.31 |
| Jalen Brunson | 2025-26 | DRIVE_PTS | 790 | 965 | 1.22 |
| Rudy Gobert | 2025-26 | DRIVES | 51 | 78 | 1.53 |
| Rudy Gobert | 2025-26 | DRIVE_FGA | 28 | 33 | 1.18 |
| Rudy Gobert | 2025-26 | DRIVE_FTA | 8 | 22 | 2.75 |
| Rudy Gobert | 2025-26 | DRIVE_PTS | 24 | 35 | 1.46 |
| Stephen Curry | 2025-26 | DRIVES | 337 | 480 | 1.42 |
| Stephen Curry | 2025-26 | DRIVE_FGA | 152 | 186 | 1.22 |
| Stephen Curry | 2025-26 | DRIVE_FTA | 50 | 68 | 1.36 |
| Stephen Curry | 2025-26 | DRIVE_PTS | 213 | 278 | 1.31 |

#### Touches / possession

| Player | Season | Stat | site_Data | NBA.com | ratio |
|---|---|---|---|---|---|
| Nikola Jokić | 2024-25 | TOUCHES | 7327 | 6919 | 0.94 |
| Nikola Jokić | 2024-25 | FRONT_CT | 3933 | 4101 | 1.04 |
| Nikola Jokić | 2024-25 | TOP | 319.2 | 548.7 | 1.72 |
| Shai Gilgeous-Alexander | 2024-25 | TOUCHES | 5451 | 5375 | 0.99 |
| Shai Gilgeous-Alexander | 2024-25 | FRONT_CT | 2028 | 2087 | 1.03 |
| Shai Gilgeous-Alexander | 2024-25 | TOP | 504.5 | 969.4 | 1.92 |
| Jalen Brunson | 2024-25 | TOUCHES | 5551 | 5237 | 0.94 |
| Jalen Brunson | 2024-25 | FRONT_CT | 2084 | 1935 | 0.93 |
| Jalen Brunson | 2024-25 | TOP | 560.6 | 1003.4 | 1.79 |
| Rudy Gobert | 2024-25 | TOUCHES | 3117 | 2931 | 0.94 |
| Rudy Gobert | 2024-25 | FRONT_CT | 1695 | 1759 | 1.04 |
| Rudy Gobert | 2024-25 | TOP | 72.8 | 177.4 | 2.44 |
| Stephen Curry | 2024-25 | TOUCHES | 4764 | 4637 | 0.97 |
| Stephen Curry | 2024-25 | FRONT_CT | 2135 | 2127 | 1 |
| Stephen Curry | 2024-25 | TOP | 333.7 | 609.7 | 1.83 |
| Nikola Jokić | 2025-26 | TOUCHES | 6513 | 6134 | 0.94 |
| Nikola Jokić | 2025-26 | FRONT_CT | 3625 | 3685 | 1.02 |
| Nikola Jokić | 2025-26 | TOP | 297.3 | 321.8 | 1.08 |
| Shai Gilgeous-Alexander | 2025-26 | TOUCHES | 4531 | 4418 | 0.98 |
| Shai Gilgeous-Alexander | 2025-26 | FRONT_CT | 1593 | 1671 | 1.05 |
| Shai Gilgeous-Alexander | 2025-26 | TOP | 428.5 | 514.5 | 1.2 |
| Jalen Brunson | 2025-26 | TOUCHES | 6755 | 6096 | 0.9 |
| Jalen Brunson | 2025-26 | FRONT_CT | 2568 | 2185 | 0.85 |
| Jalen Brunson | 2025-26 | TOP | 592.3 | 696.3 | 1.18 |
| Rudy Gobert | 2025-26 | TOUCHES | 3390 | 3132 | 0.92 |
| Rudy Gobert | 2025-26 | FRONT_CT | 1793 | 1834 | 1.02 |
| Rudy Gobert | 2025-26 | TOP | 77.6 | 111.3 | 1.43 |
| Stephen Curry | 2025-26 | TOUCHES | 2812 | 2701 | 0.96 |
| Stephen Curry | 2025-26 | FRONT_CT | 1265 | 1260 | 1 |
| Stephen Curry | 2025-26 | TOP | 187.5 | 223.6 | 1.19 |

#### Catch & shoot / pull-up

| Player | Season | Stat | site_Data | NBA.com | ratio |
|---|---|---|---|---|---|
| Nikola Jokić | 2024-25 | CS_FGA | 289 | 289 | 1 |
| Nikola Jokić | 2024-25 | CS_3PA | 234 | 237 | 1.01 |
| Nikola Jokić | 2024-25 | PU_FGA | 142 | 123 | 0.87 |
| Nikola Jokić | 2024-25 | PU_3PA | 66 | 63 | 0.95 |
| Shai Gilgeous-Alexander | 2024-25 | CS_FGA | 101 | 97 | 0.96 |
| Shai Gilgeous-Alexander | 2024-25 | CS_3PA | 73 | 73 | 1 |
| Shai Gilgeous-Alexander | 2024-25 | PU_FGA | 904 | 862 | 0.95 |
| Shai Gilgeous-Alexander | 2024-25 | PU_3PA | 359 | 357 | 0.99 |
| Jalen Brunson | 2024-25 | CS_FGA | 124 | 131 | 1.06 |
| Jalen Brunson | 2024-25 | CS_3PA | 121 | 125 | 1.03 |
| Jalen Brunson | 2024-25 | PU_FGA | 602 | 576 | 0.96 |
| Jalen Brunson | 2024-25 | PU_3PA | 264 | 260 | 0.98 |
| Rudy Gobert | 2024-25 | CS_FGA | 14 | 14 | 1 |
| Rudy Gobert | 2024-25 | CS_3PA | null | null | – |
| Rudy Gobert | 2024-25 | PU_FGA | 2 | 3 | 1.5 |
| Rudy Gobert | 2024-25 | PU_3PA | null | null | – |
| Stephen Curry | 2024-25 | CS_FGA | 369 | 368 | 1 |
| Stephen Curry | 2024-25 | CS_3PA | 356 | 355 | 1 |
| Stephen Curry | 2024-25 | PU_FGA | 568 | 560 | 0.99 |
| Stephen Curry | 2024-25 | PU_3PA | 424 | 415 | 0.98 |
| Nikola Jokić | 2025-26 | CS_FGA | 253 | 237 | 0.94 |
| Nikola Jokić | 2025-26 | CS_3PA | 200 | 195 | 0.98 |
| Nikola Jokić | 2025-26 | PU_FGA | 156 | 132 | 0.85 |
| Nikola Jokić | 2025-26 | PU_3PA | 61 | 66 | 1.08 |
| Shai Gilgeous-Alexander | 2025-26 | CS_FGA | 74 | 72 | 0.97 |
| Shai Gilgeous-Alexander | 2025-26 | CS_3PA | 56 | 50 | 0.89 |
| Shai Gilgeous-Alexander | 2025-26 | PU_FGA | 756 | 719 | 0.95 |
| Shai Gilgeous-Alexander | 2025-26 | PU_3PA | 242 | 240 | 0.99 |
| Jalen Brunson | 2025-26 | CS_FGA | 229 | 232 | 1.01 |
| Jalen Brunson | 2025-26 | CS_3PA | 221 | 216 | 0.98 |
| Jalen Brunson | 2025-26 | PU_FGA | 807 | 734 | 0.91 |
| Jalen Brunson | 2025-26 | PU_3PA | 306 | 303 | 0.99 |
| Rudy Gobert | 2025-26 | CS_FGA | 15 | 14 | 0.93 |
| Rudy Gobert | 2025-26 | CS_3PA | 5 | 5 | 1 |
| Rudy Gobert | 2025-26 | PU_FGA | 1 | 3 | 3 |
| Rudy Gobert | 2025-26 | PU_3PA | 0 | 0 | – |
| Stephen Curry | 2025-26 | CS_FGA | 261 | 267 | 1.02 |
| Stephen Curry | 2025-26 | CS_3PA | 247 | 249 | 1.01 |
| Stephen Curry | 2025-26 | PU_FGA | 323 | 312 | 0.97 |
| Stephen Curry | 2025-26 | PU_3PA | 236 | 232 | 0.98 |

#### Wide open (6+ ft)

| Player | Season | Stat | site_Data | NBA.com | ratio |
|---|---|---|---|---|---|
| Nikola Jokić | 2024-25 | WO_FGA | 187 | 183 | 0.98 |
| Nikola Jokić | 2024-25 | WO_3PA | 154 | 140 | 0.91 |
| Nikola Jokić | 2024-25 | WO_FGM | 98 | 100 | 1.02 |
| Shai Gilgeous-Alexander | 2024-25 | WO_FGA | 238 | 240 | 1.01 |
| Shai Gilgeous-Alexander | 2024-25 | WO_3PA | 148 | 144 | 0.97 |
| Shai Gilgeous-Alexander | 2024-25 | WO_FGM | 120 | 124 | 1.03 |
| Jalen Brunson | 2024-25 | WO_FGA | 150 | 197 | 1.31 |
| Jalen Brunson | 2024-25 | WO_3PA | 117 | 138 | 1.18 |
| Jalen Brunson | 2024-25 | WO_FGM | 76 | 101 | 1.33 |
| Rudy Gobert | 2024-25 | WO_FGA | 22 | 26 | 1.18 |
| Rudy Gobert | 2024-25 | WO_3PA | 0 | 0 | – |
| Rudy Gobert | 2024-25 | WO_FGM | 18 | 20 | 1.11 |
| Stephen Curry | 2024-25 | WO_FGA | 229 | 329 | 1.44 |
| Stephen Curry | 2024-25 | WO_3PA | 205 | 282 | 1.38 |
| Stephen Curry | 2024-25 | WO_FGM | 104 | 155 | 1.49 |
| Nikola Jokić | 2025-26 | WO_FGA | 121 | 96 | 0.79 |
| Nikola Jokić | 2025-26 | WO_3PA | 93 | 75 | 0.81 |
| Nikola Jokić | 2025-26 | WO_FGM | 63 | 50 | 0.79 |
| Shai Gilgeous-Alexander | 2025-26 | WO_FGA | 167 | 177 | 1.06 |
| Shai Gilgeous-Alexander | 2025-26 | WO_3PA | 90 | 98 | 1.09 |
| Shai Gilgeous-Alexander | 2025-26 | WO_FGM | 80 | 87 | 1.09 |
| Jalen Brunson | 2025-26 | WO_FGA | 159 | 193 | 1.21 |
| Jalen Brunson | 2025-26 | WO_3PA | 127 | 146 | 1.15 |
| Jalen Brunson | 2025-26 | WO_FGM | 73 | 80 | 1.1 |
| Rudy Gobert | 2025-26 | WO_FGA | 28 | 31 | 1.11 |
| Rudy Gobert | 2025-26 | WO_3PA | 5 | 5 | 1 |
| Rudy Gobert | 2025-26 | WO_FGM | 20 | 23 | 1.15 |
| Stephen Curry | 2025-26 | WO_FGA | 145 | 187 | 1.29 |
| Stephen Curry | 2025-26 | WO_3PA | 131 | 160 | 1.22 |
| Stephen Curry | 2025-26 | WO_FGM | 75 | 89 | 1.19 |

Notes: TOP is in minutes. NBA.com's 2024-25 TOP is about 1.7–2.4× site_Data for every player, and Brunson's 1,003
TOP minutes in 2,301 minutes played is implausible. The NBA.com rendered drives page (2025-26) shows A.J. Lawson with
26 drives / 16 FGA; site_Data has 14 / 7 for the same 24 GP and 226 MIN. The page matches the JSON.

## Scraper parameters found

Links are pinned to master HEAD `782ec8b` (2026-08-15).

| File | Lines | What it does | Key parameters |
|---|---|---|---|
| [player_level.py](https://github.com/gabriel1200/site_Data/blob/782ec8b4c09fdfb023f06dbcd3e601123cf6d698/player_level.py#L127-L161) | 127–161 | `get_tracking`: `leaguedashptstats` for Drives, CatchShoot, Passing, Possessions, ElbowTouch, PostTouch, PaintTouch, PullUpShot | `PerMode=Totals`, `LastNGames=0`, `DateFrom=&DateTo=`, `Month=0`, `OpponentTeamID=0`, `Location=`, `SeasonSegment=`, `SeasonType=Regular%20Season` (or `Playoffs`), `PlayerOrTeam=Player` |
| [player_level.py](https://github.com/gabriel1200/site_Data/blob/782ec8b4c09fdfb023f06dbcd3e601123cf6d698/player_level.py#L162-L189) | 162–189 | `tracking_save`: **writes `{year}/player_tracking/{drives,cs,touches,pullup,…}.csv`** (drives→`format_drives`, touches→`prep_touches`, etc.) | season = year−1 |
| [player_level.py](https://github.com/gabriel1200/site_Data/blob/782ec8b4c09fdfb023f06dbcd3e601123cf6d698/player_level.py#L13) | 13, 226 | `end_year=2026`; `tracking_save(range(end_year-1, end_year+1))`: re-pulls 2024-25 and 2025-26 on every run | — |
| [script.sh](https://github.com/gabriel1200/site_Data/blob/782ec8b4c09fdfb023f06dbcd3e601123cf6d698/script.sh#L5-L6) | 5–6 | Daily local job: `python stat_scrape2.py`, `python player_level.py`, then a "Daily Update" commit | — |
| [new_tracking.py](https://github.com/gabriel1200/site_Data/blob/782ec8b4c09fdfb023f06dbcd3e601123cf6d698/new_tracking.py#L24-L26) | 24–26 | Same `leaguedashptstats` URL; writes master `tracking/*.csv` (not the per-year files) | identical params |
| [stat_scrape2.py](https://github.com/gabriel1200/site_Data/blob/782ec8b4c09fdfb023f06dbcd3e601123cf6d698/stat_scrape2.py#L423-L456) / [stat_scrape.py](https://github.com/gabriel1200/site_Data/blob/782ec8b4c09fdfb023f06dbcd3e601123cf6d698/stat_scrape.py#L534-L589) | 423–456 / 534–589 | `get_tracking`, used by `run_tracking_updates` → `tracking/` and `tracking_ps/` masters | identical params; `YEAR_TO_SCRAPE = 2025` (stat_scrape2 L41) |
| [stat_scrape2.py](https://github.com/gabriel1200/site_Data/blob/782ec8b4c09fdfb023f06dbcd3e601123cf6d698/stat_scrape2.py#L293-L341) / [stat_scrape.py](https://github.com/gabriel1200/site_Data/blob/782ec8b4c09fdfb023f06dbcd3e601123cf6d698/stat_scrape.py#L375-L432) | 293–341 / 375–432 | `get_playershots`: **writes `{year}/player_shooting/{very_tight,tight,open,wide_open}.csv`** from `leaguedashplayerptshot` | `CloseDefDistRange=6%2B%20Feet%20-%20Wide%20Open` (etc.), `PerMode=Totals`, `LastNGames=0`, no date filters, `GeneralRange=`, `DribbleRange=` empty |
| [fix_shooting.py](https://github.com/gabriel1200/site_Data/blob/782ec8b4c09fdfb023f06dbcd3e601123cf6d698/fix_shooting.py#L28-L51) | 28–51 | Added 2026-08-15: refetches every closest-defender season 2013-14…2025-26 (RS + playoffs) | same as above |
| [.github/daily_scrape.yaml](https://github.com/gabriel1200/site_Data/blob/782ec8b4c09fdfb023f06dbcd3e601123cf6d698/.github/daily_scrape.yaml) | — | The only workflow. It isn't under `.github/workflows/`, so it is inert, and it doesn't run any tracking script anyway | — |
| [in_season.py](https://github.com/gabriel1200/site_Data/blob/782ec8b4c09fdfb023f06dbcd3e601123cf6d698/in_season.py#L22) / update_classic.py | — | Unrelated (NBA Cup traditional stats via Selenium; Basketball-Reference) | — |

New_tracking.py was last changed 2025-06-01, player_level.py 2025-11-24, stat_scrape.py 2025-11-24. Around 2024 nothing
changed in the endpoint or parameters. Every version requests full-season totals with no filters.

**Hypothesis tests:** PerMode, SeasonType, LastNGames, date range and opponent/location can all be ruled out, because
the scraper's exact URL, unmodified, now returns NBA.com's new numbers, and minutes, GP and player counts are
identical. Playoffs-included/excluded is ruled out because the regular-season minutes match exactly, and the playoff
tables changed as well. I didn't run date-window permutations; they couldn't turn an identical request into the old numbers.

**File history (GitHub API):**
- `2026/player_tracking/{drives,touches}.csv`: last commit 2026-04-19 (`8dd487dc`), after the regular season ended.
- `2025/player_tracking/{drives,touches}.csv`: last commit 2026-02-10. Values are unchanged since 2025-04-20 (`f470f7d0`).
- `tracking_ps/drives.csv`: last commit 2026-06-14.
- `{2025,2026}/player_shooting/wide_open.csv`: last commit 2026-08-15 (`070a59ba`, a full refetch via fix_shooting.py).

## Recommended fix

1. **Keep using site_Data for 2024-25 and 2025-26 tracking (drives, touches/TOP, wide open), and don't re-scrape
   from NBA.com.** A re-scrape now would import NBA.com's new data: broken 2024-25 drive FTs and TOP, a new scale for
   2025-26, and a discontinuity with 2013-14…2023-24.
   - Risk: site_Data's daily `script.sh` re-runs `player_level.py`, and `tracking_save` overwrites 2025 and 2026 with
     whatever NBA.com serves.
   - **Snapshot or pin the current files**, e.g. read them at commit `8dd487dc` (tracking) / `070a59ba`
     (shooting) or copy them into this repo, so an upstream run can't silently swap in the new numbers.
2. If the pipeline ever reads tracking from NBA.com directly, add a guard: flag a season whose league drives per
   minute or TOP per team-game jumps by more than ~10 % from the prior season.
   - TOP per team-game > 24 min is impossible.
   - League drive FTA < 5,000 means the drive FTs are missing.
3. **For 2026-27 onward, NBA.com's new definitions will presumably be the only source**, so drives, touches and wide-open
   will need a season-level break flag or re-normalisation. Possible bridge: compute per-season scale factors from
   2025-26, where both versions exist (e.g. league drives ×1.38, touches ×0.91, wide-open FGA ×0.97), knowing that
   the per-player ratios vary widely (drives ×1.22–2.02).
4. Optional: ask the site_Data maintainer and/or NBA stats whether the 2024-25/2025-26 backfill is intentional. The
   2024-25 drive FT and TOP defects look like a bug on NBA.com's side.

## Audit log

All times PDT, 2026-10-01. Read-only throughout.

| # | Time | Source | What |
|---|---|---|---|
| 1 | 21:06 | Local: `docs/tracking-data-audit.md` | Prior findings (§3, §5–9) |
| 2 | 21:06 | `api.github.com/repos/gabriel1200/site_Data/contents/`, `contents/.github` | Repo inventory; the workflow lives at `.github/daily_scrape.yaml` |
| 3 | 21:06 | `raw.githubusercontent.com/gabriel1200/site_Data/master/` for new_tracking.py, stat_scrape.py, stat_scrape2.py, selenium_scrape.py, selenium_scrape2.py, in_season.py, update_classic.py, player_level.py, player_shooting.py, scrape_shooting.py, script.sh, copy.sh, copy2.sh, .github/daily_scrape.yaml | Scraper code and parameters |
| 4 | 21:07 | `api.github.com/.../commits?path=` for `{2024,2025,2026}/player_tracking/drives.csv`, `{2025,2026}/player_tracking/touches.csv`, `{2025,2026}/player_shooting/wide_open.csv`, player_level.py, stat_scrape.py, new_tracking.py | Update dates; scraper change history |
| 5 | 21:07 | `raw.githubusercontent.com/.../{f470f7d0,04f7fa43,297e81b2,c6d47303}/2025/player_tracking/{drives,touches}.csv` | 2024-25 values over time (unchanged) |
| 6 | 21:08 | `raw.githubusercontent.com/.../master/{2014..2026}/player_tracking/{drives,touches,cs,pullup}.csv`, `player_shooting/wide_open.csv` | League totals per season |
| 7 | 21:08 | Chrome, own tab (`572330269`): `www.nba.com/stats/players/drives?Season=2025-26&PerMode=Totals` | Rendered page and provider logo |
| 8 | 21:08–21:11 | Same tab, in-page GETs to `stats.nba.com/stats/leaguedashptstats` (Drives, Possessions, CatchShoot, PullUpShot; 2013-14…2025-26 RS; Drives playoffs 2023-24…2025-26) | NBA.com league totals and player values |
| 9 | 21:09 | GitHub API commits for `2026/playoffs/...`, `2025/playoffs/...`, `tracking_ps/drives.csv`, `tracking/drives.csv`; raw `tracking_ps/drives.csv`, `tracking/drives.csv` | Playoff-file timing (last 2026-06-14) |
| 10 | 21:10–21:11 | Same tab: `stats.nba.com/stats/leaguedashplayerptshot` (4 CloseDefDistRange buckets × 2023-24…2025-26), `leaguedashplayerstats` (Base totals) | Wide-open and closest-defender partition check |
| 11 | 21:10 | WebSearch: Hawk-Eye / tracking reprocessing (results incl. pr.nba.com/nba-sony-hawk-eye-innovations-partnership) | Hawk-Eye is the provider since 2023-24; no announcement of a 2024-26 reprocessing found |
| 12 | 21:11 | Same tab: `www.nba.com/stats/help/glossary` | Drive, Touches and TOP definitions; no mention of a provider change or a revision |
| 13 | 21:12 | raw `{2014,2016,2018,2020,2022,2023,2024,2025,2026}/player_shooting/{very_tight,tight,open}.csv`; `{2025,2026}/player_shooting/wide_open.csv` at `8dd487dc` and `070a59ba`; `api.github.com/.../commits/070a59ba`; raw `fix_shooting.py` | The 2026-08-15 full refetch and its values |
| 14 | 21:13 | Chrome: closed own tab `572330269` | No other tabs touched. No logins, forms or dialogs |
| 15 | 21:13 | `api.github.com/.../commits/master` | HEAD sha for pinned links |
