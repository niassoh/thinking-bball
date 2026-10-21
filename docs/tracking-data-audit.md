# Tracking Data Audit (non-pbpstats stats)

Audit date: 2026-10-01 (PDT). Branch: `feature/player-profile`. Scope: the per-season tracking columns in
`data/cached-data.json` keys `dailycat-14` … `dailycat-26` (2013-14 … 2025-26).

This was a **read-only** audit. No sheet, no file under `data/` and no existing script was changed. The Google
Sheet was read with the service account and the `spreadsheets.readonly` scope only. Scratch scripts and
downloads are in
`/private/tmp/claude-501/-Users-pzh-thinking-bball/2e2b5c80-04a6-4e1e-845b-04ada3ca8219/scratchpad/tracking-audit/`.

Labels used below:
- **Verified**: reproduced numerically, from the sheet, the raw CSVs, git history or NBA.com.
- **Inferred**: the explanation fits every piece of evidence, but the mechanism can't be observed directly
  (for example, a sheet formula that has since been replaced).

---

## 1. Summary verdict per column

| Column | Source type | Verdict | One-line reason |
|---|---|---|---|
| Time of Poss % | tracking | **minor issues** | Matches site_Data exactly for 2013-14…2022-23 and 2025-26. **2023-24 is wrong**: it was built from a 12-game snapshot. 2024-25 used a snapshot taken before the season ended. |
| Drives/36 | tracking | **missing seasons** | Blank for 2013-14…2023-24 even though site_Data has complete drives files that match NBA.com exactly. 2025-26 matches site_Data exactly. |
| Drives TS% | tracking | **missing seasons + minor** | Same gap. The formula `(2·FGM+FTM)/(2·(FGA+0.44·FTA))` leaves out drive 3s, so it runs a median **1.5 pts** below points-based TS%. |
| Touches per drive | tracking | **missing seasons** | Same gap. It is really *front-court touches ÷ drives*. |
| 3yr Pullup 3s/36, 3yr Pullup 3% | tracking | **wrong** (every season except 2024-25) | 2025-26 adds **catch-and-shoot FGM/FGA** to pull-up 3PM/3PA: the "Pullup" IMPORTRANGE actually holds C&S data. 2013-14…2023-24 are corrupted by shifted columns and fixed prior seasons; examples reach **1020 %**. |
| 3yr C&S 3s/36, 3yr C&S 3% | tracking | **wrong** (≤2023-24), **minor** (2025-26) | 2025-26 counts all C&S FG instead of 3P for the current season. Older seasons have the same corruption as pull-up. |
| 3yr Wide Open 3s/36, 3% | tracking | **wrong** (≤2023-24), **minor** (2024-25, 2025-26) | Older seasons use a fixed 2022-23 season plus a 23-game slice of 2023-24. The 2025-26 cache was built from a stale current-season file. Players with diacritics lose their prior seasons. |
| 2yr Def FGA < 6 per36, Diff% | tracking | **wrong** (all seasons) | The prior season for ≤2023-24 is a 24-game slice of 2023-24. In 2025-26 the current season comes from a **12–15 game file (Nov 2025)** divided by full-season minutes. 2024-25 can't be verified because its source no longer exists. |
| Rim+FT TSA%, FTA:RimFGA | pbp | out of scope | `'RS PBP'` (pbpstats) columns `Rim & FT TSA Share` and `FTA:RimFGA`. |
| FT%, Corner 3 Share% | pbp | out of scope | `'RS PBP'` (`ftpoints/fta`, `Corner3fga/Fg3a`). |
| Good:Bad Pass ratio, Handle TOV%, Non-Pass TOV% | pbp-derived | **minor issues** (inferred) | These are pbp counts divided by Load. Load includes Box Creation, which uses **Height** from the static `'Pos & Height'` tab. 26 players in 2025-26 have no height. |
| Passer Rating | pbp + static Height | **wrong for 26 players (8 %) in 2025-26** | A blank Height is treated as 0. Neemias Queta gets 0.05; the same formula with any plausible height gives about 2.5. |
| Mates Spacing | pbp + static Position | **minor** | A blank Position (41 players in 2025-26) is treated as 0, which gives a position multiplier of 1.06. That shifts teammates' values. |
| Age | static DOB | **note** | `YEARFRAC(TODAY(), DOB)` from `'Pos & Height'!AL:AM`. This is the age when the sheet was pulled, not age in that season. Blank for 15 % of 2025-26. |
| Position | static | **note** | `'Pos & Height'!C`, the first match by name in a table that stops at 2023-24. Blank for 13 % of 2025-26. |

The **sheet → cache step is faithful**. For 2025-26 every tracking column in `dailycat-26` equals the live sheet
value (313/313 rows), except Wide Open, whose source file changed after the last pull. The errors come from
the sheet's formulas and import sources, not from `sheets-catmulti.js`.

---

## 2. Lineage

The `Format` row 6 formulas map to `Sort`. `Sort!A2 = SORT(FILTER('All RS'!B:DX, …, 'All RS'!J:J > 'League data'!E1))`,
so `Sort` column *X* is `'All RS'` column *X+1*. The filter is MP > 800, prorated during the season.

| Format column | Sort | All RS (formula) | Source tab → cells | Import |
|---|---|---|---|---|
| Time of Poss % | DD | DE `VLOOKUP(name, Touches!B:BG, MATCH("TOP%"))` | `Touches!Y = X/(H·60)·2`, `X = M·J` (avg sec/touch × touches ÷ MIN, ×2) | `Touches!B2 = IMPORTRANGE(1dJa8…, "Touches!B2:M1000")`, **current season only** |
| Drives/36 | DE | DF `VLOOKUP(name, Drives!B:AC, "Drives/36")` | `Drives!AA = I/(H/36)` (DRIVES ÷ MIN×36) | `Drives!B2 = IMPORTRANGE(1dJa8…, "Drives!B2:Y1000")`, current only |
| Touches per drive | DF | DG `"FCT:Drives"` | `Drives!AB = Touches.FRONT_CT_TOUCHES / I` | as above |
| Drives TS% | DG | DH | `Drives!AC = (2·J + M)/(K + 0.44·N)/2` | as above |
| 3yr Pullup 3s/36 / 3% | CX / CY | CY / CZ (`'PU3'!B:AB`) | `AA = Z/(X/36)`, `AB = Y/Z`. X/Y/Z = current `H/I/J` + `R,S,T` (`AE` block, col 6/11/12) + `U,V,W` (`AU` block, col 6/10/11) | `PU3!B2 = IMPORTRANGE(1dJa8…, "Pullup!B2:L1000")`. **Columns are CATCH_SHOOT_FGM/FGA (verified).** `AE` (labelled 2025) is static 2024-25 pull-up data; `AU` (2024) is static 2023-24. Static lookups use the accent-stripped name in `AC`. |
| 3yr C&S 3s/36 / 3% | CZ / DA | DA / DB (`CS3`, MATCH "3yr Att/36", "3yr %") | `X = W/(U/36)`, `Y = V/W`. U/V/W = current `H/I/J` + `S/O/P` (`AB` block) + `T/Q/R` (`AO` block) | `CS3!B2 = IMPORTRANGE(…, "CS!B2:L1000")`. Current season uses **CATCH_SHOOT_FGM/FGA, not FG3M/FG3A**. `AB` = static 2024-25, `AO` = static 2023-24. Lookups use the raw name. |
| 3yr Wide Open 3s/36 / 3% | DB / DC | DC / DD (`WO3` col 31/32 of B:AG) | `AF = AE/(AC/36)`, `AG = AD/AE`. `AD/AE = IF(R>0, Q/R + Y/Z + AA/AB, "#VALUE!")`, `AC` = `CS3!U` (3yr MP) | `WO3!A2 = IMPORTDATA("https://storage.googleapis.com/thinkingbball/" & (LEFT(A13,4)+1) & "/player_shooting/wide_open.csv")`. `AK` = static 2024-25, `BD` = static 2023-24. Lookups use the accent-stripped name in `AH`. |
| 2yr Def FGA < 6 per36 / Diff% | DI / DJ | DJ / DK (`Inside6`) | `X = V/(P/36)`, `Y = U/V − W`, `W = DFGA-weighted FG%` (xFG). P = `Touches!AF` (static 2024-25 MIN) + current Touches MIN | `Inside6!C2 = IMPORTDATA(…thinkingbball/(LEFT(A13,4)+1)/player_tracking/close_6.csv)`. `AB` = static block labelled 2025 (source unknown, see §4). |
| Rim+FT TSA% | BX | BY = `'RS PBP'` col 13 (`Rim & FT TSA Share`) | pbpstats `get-totals` keyed on `Instructions!A13` | pbp |
| FTA:RimFGA | BW | BX = `'RS PBP'` col 12 | pbpstats | pbp |
| FT% | AD | AE = `'RS PBP'!KG` (`ftpoints/fta`) | pbpstats | pbp |
| Corner 3 Share% | BZ | CA = `'RS PBP'` col 15 (`Corner3fga/Fg3a`) | pbpstats | pbp |
| Good:Bad Pass ratio | DP | DQ = `AV/'RS PBP'.Turnovers`; `AV = (Load − TOV − 0.44·FTA − FGA)·MP/48` | pbp + Load (Load includes Box OC, which uses `AW` Height) | pbp + static Height |
| Handle TOV% | DR | DS = `'RS PBP'!KK (lost-ball TOV/100) / Load` | pbp | pbp + Load |
| Non-Pass TOV% | DN | DO = `KJ / Load` | pbp | pbp + Load |
| Passer Rating | BB | BC (blend of `CV`/`CW` logistic fit using `AX` Layup Ast%, `AM` Load, `AY` Ast/Load, `AW` Height, `X` TOV, `AI`) | pbp + static Height | pbp + static |
| Mates Spacing | AS·100 | AT = team MP-share-weighted `AS` Spacing excluding the player; `AS = (0.0214·Pos² − 0.0786·Pos + 1.06)·(FT% + 3P proficiency)` | pbp + `AU` Position | pbp + static |
| Age | DV | DW = `YEARFRAC(TODAY(), VLOOKUP(name,'Pos & Height'!A:G,6))`; col F = `VLOOKUP(name, AL:AM)` | static DOB list | static |
| Position | AT | AU = `VLOOKUP(name,'Pos & Height'!A:D,3)` | static table (seasons 2012-13…2023-24, mostly ≤2019-20) | static |

How names are joined: `'All RS'!B` is the pbpstats name passed through the `Names` translation tab. Every
tracking lookup is an exact-text `VLOOKUP` (case-insensitive). PU3 and WO3 strip accents only on their own
side before looking up the static prior-season blocks, and those blocks keep the accents. CS3 doesn't strip
accents.

The cell `A1` of each tracking tab holds the old `IMPORTDATA(...)` formula **as text**, without `=`. Those
formulas are disabled.

### When each cache key was produced (git history of `data/cached-data.json`)

| Key | Last changed | Sheet state at that time |
|---|---|---|
| dailycat-14 … 23 | 2025-04-12 / 13 | April 2025 configuration (season 2024-25 in progress) |
| dailycat-24 | 2025-04-12, rewritten byte-identical 2025-05-18 | April 2025 configuration |
| dailycat-25 | 2025-04-13 | April 2025 configuration, live season |
| dailycat-26 | 2026-05-03 | current configuration (read today) |

---

## 3. Coverage (share of rows with a non-empty value)

| Column | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Time of Poss % | 99 | 99 | 99 | 98 | 98 | 98 | 99 | 99 | 99 | 100 | 98 | 100 | 100 |
| Drives/36 | **0** | **0** | **0** | **0** | **0** | **0** | **0** | **0** | **0** | **0** | **0** | 100 | 100 |
| Drives TS% | **0** | **0** | **0** | **0** | **0** | **0** | **0** | **0** | **0** | **0** | **0** | 100 | 99 |
| Touches per drive | **0** | **0** | **0** | **0** | **0** | **0** | **0** | **0** | **0** | **0** | **0** | 100 | 100 |
| 3yr Wide Open 3s/36 | 86 | 88 | 91 | 94 | 94 | 95 | 97 | 97 | 97 | 97 | 90 | 97 | 96 |
| 3yr Wide Open 3% | 86 | 88 | 91 | 94 | 94 | 95 | 97 | 97 | 97 | 97 | 90 | 97 | 96 |
| 3yr Pullup 3s/36 | 92 | 91 | 95 | 95 | 94 | 95 | 97 | 98 | 97 | 98 | 93 | 100 | 100 |
| 3yr Pullup 3% | 71 | 71 | 77 | 81 | 82 | 87 | 91 | 91 | 93 | 95 | 86 | 96 | 100 |
| 3yr C&S 3s/36 | 92 | 91 | 95 | 95 | 94 | 95 | 97 | 98 | 97 | 98 | 93 | 100 | 100 |
| 3yr C&S 3% | 81 | 85 | 88 | 91 | 91 | 93 | 97 | 97 | 97 | 97 | 93 | 99 | 100 |
| 2yr Def FGA < 6 per36 | 98 | 98 | 97 | 97 | 96 | 96 | 95 | 96 | 96 | 98 | 97 | 96 | 96 |
| 2yr Def FGA Diff% | 98 | 98 | 97 | 97 | 96 | 96 | 95 | 96 | 96 | 98 | 97 | 96 | 96 |
| Rim+FT TSA%, FTA:RimFGA, FT%, Mates Spacing, Good:Bad, Handle TOV%, Non-Pass TOV%, Passer Rating | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 |
| Corner 3 Share% | 93 | 92 | 96 | 97 | 97 | 97 | 98 | 99 | 98 | 98 | 99 | 98 | 97 |
| Age | 73 | 74 | 82 | 85 | 88 | 92 | 94 | 95 | 97 | 96 | 97 | 92 | 85 |
| Position | 96 | 97 | 97 | 97 | 99 | 99 | 100 | 100 | 100 | 100 | 99 | 94 | 87 |
| rows | 296 | 312 | 303 | 307 | 305 | 306 | 292 | 298 | 313 | 313 | 302 | 300 | 313 |

### Why the gaps occur

**Drives, 2013-14…2023-24 (verified that the data exists; mechanism inferred).**
- site_Data has `drives.csv` for every year folder `2014`…`2026`, on both GitHub master and the GCS bucket.
  The GitHub files match NBA.com **exactly** for 2017-18, 2022-23 and 2023-24 (536/536, 536/536 and 567/567 players).
- In the GCS bucket the sheet read in April 2025, the drives files for 2014–2024 use an older layout with
  **no `PLAYER_ID` column**: `PLAYER,TEAM,GP,…`. The 2025 and 2026 files start with `PLAYER_ID,PLAYER,…`.
- The Drives lookups expect the name in column B, which matches the `PLAYER_ID`-first layout (the WO3 import
  in `A2` uses the same layout today). With the old layout the name lands in column A and B holds the team,
  so every lookup misses. That explains why only `dailycat-25` was filled in April 2025.
- Other files didn't break the same way because they start with the player name in every layout.

**3yr % blanks in older seasons.** These are a side effect of the corruption described in §5: a division by a
shifted "3PM" column that is 0 for non-shooters.

**Wide Open blanks in 2025-26 (12 players, verified).** These are bigs with 0 wide-open 3PA in the current
season. `IF(R3>0, …, "#VALUE!")` blanks the whole stat even when prior seasons have attempts (Ayton, Duren,
Poeltl, Kornet, Ighodaro). The 3s/36 value should be ~0 rather than blank.

**Def < 6 ft blanks in 2025-26 (11 players, verified).** Examples: LeBron James, Tyler Herro, Paul George,
Jalen Williams, De'Anthony Melton, Danny Wolf. They are absent from the stale `2026/player_tracking/close_6.csv`,
which runs to at most 15 GP and was last modified 2025-11-26. Most of them missed the start of the season.

**Drives TS% blanks in 2025-26 (2, verified).** Batum and Kalkbrenner have 0 drive FGA and FTA, so this is
correct.

**Position and Age decline in recent seasons.** The `'Pos & Height'` table and the DOB list haven't been
extended past 2023-24 rookies.

### What site_Data has per year (GitHub API listing and downloads)

| File | 2014–2023 | 2024 (2023-24) | 2025 (2024-25) | 2026 (2025-26) |
|---|---|---|---|---|
| GitHub `player_tracking/{drives,touches,cs,pullup}.csv` | complete | complete (84 GP max) | complete (82) | complete (82) |
| GitHub `player_shooting/wide_open.csv` | complete | complete (83) | complete (82) | complete (82) |
| GitHub `player_tracking/wide_open.csv` | complete | **23 GP** | – | – |
| GitHub `player_tracking/close_6.csv` | complete | **24 GP** | **missing** | **missing** |
| GCS `player_tracking/{drives,touches,cs,pullup}.csv` | complete, older layout | **12 GP** (last modified 2024-01-26) | 78–79 GP (2025-04-24) | complete (2026-10-02) |
| GCS `player_tracking/close_6.csv` | complete | **12 GP** | **2 GP** | **15 GP** (2025-11-26) |
| GCS `player_shooting/wide_open.csv` | complete, no `PLAYER_ID` | 45 GP | 78 GP | complete |

**Neither source has a complete < 6 ft defense file for 2023-24, 2024-25 or 2025-26.**

---

## 4. Transformation accuracy

### 4a. How old seasons were built: reverse-engineered and reproduced (verified)

I tested hypotheses against the whole player pool of each cached key. This model reproduces the cache:

- **3yr Pullup / C&S, `dailycat-14 … 25`.**
  `3yr = current-season row from GCS (columns read as make = FG%, att = 3PM in the old layout) + fixed 2022-23 + fixed 2023-24 (GitHub, 3PM/3PA/MIN)`.
  - Match rate is **98–100 % of players in every key** (for example `dailycat-14`: 271/271, 209/209, 271/271, 239/239).
  - The prior seasons are always 2022-23 and 2023-24, whatever the season.
  - In the old GCS layout `PTS` sits before `FGM`, so the column indices that fit the new layout read FG% as
    makes and 3PM as attempts. `dailycat-25` used the new-layout GCS 2025 file, so it is the only key that
    is correct (window 2022-23 to 2024-25), apart from being a 78-game snapshot.
- **3yr Wide Open, older keys.**
  `current = GCS player_tracking/wide_open (Y) + GitHub 2023 + GitHub 2024 player_tracking/wide_open (23-GP slice)`.
  Match rate is 254/254 (`dailycat-14`), 287/287 (`dailycat-18`) and 305/305 (`dailycat-22`). `dailycat-25`
  used `player_shooting` for the current season with the same fixed prior seasons (290/291).
- **2yr Def < 6 ft, `dailycat-14 … 24`.**
  `current GCS close_6 (Y) + GitHub 2024 close_6 (24-GP slice of 2023-24)`, with minutes from current touches
  plus **full** 2023-24 touches. Match rate is 289/289, 292/293, 300/301 and 293/294.
- **Time of Poss %.** It matches GitHub single-season data for `dailycat-14…23` (290/292 to 310/310) and
  `dailycat-26` (313/313). `dailycat-24` matches only the **12-GP GCS 2024 file** (297/297; 10/296 against the
  complete file). `dailycat-25` matches the 78-GP GCS 2025 snapshot (300/300; 115/300 against final data).

### 4b. Sample players: cached / recomputed from complete site_Data GitHub files (⚠ = differs beyond rounding)

Recomputed definitions:
- per-season stats exactly as the sheet defines them;
- 3yr = Σ3PM/Σ3PA and Σ3PA/(ΣMIN/36) over seasons Y, Y−1, Y−2 (attempt-weighted), with Wide Open per-36 on C&S minutes;
- 2yr Def = (ΣDFGA)/(Σtouches MIN/36) and ΣDFGM/ΣDFGA − DFGA-weighted FG%.

Def < 6 ft has no complete source after 2022-23, so it shows "–".

**2025-26 (`dailycat-26`)**

| Player | TOP% | Dr/36 | DrTS | T/Dr | PU/36 | PU% | CS/36 | CS% | WO/36 | WO% | D6/36 | D6diff |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Nikola Jokić (star C, diacritic) | 26.3 / 26.3 | 4.5 / 4.5 | 65.8 / 65.8 | 12.8 / 12.8 | 2.2 / 0.9 ⚠ | 42.3 / 30.9 ⚠ | 3.1 / 2.8 ⚠ | 43.3 / 41.2 ⚠ | 0.4 / 1.6 ⚠ | 48.3 / 45.5 ⚠ | 4.7 / – | 1.0 / – |
| Shai Gilgeous-Alexander | 37.9 / 37.9 | 20.3 / 20.3 | 65.6 / 65.6 | 1.2 / 1.2 | 3.0 / 3.9 ⚠ | 36.7 / 36.4 ⚠ | 1.1 / 1.0 ⚠ | 42.3 / 40.2 ⚠ | 2.1 / 2.1 | 37.5 / 37.6 ⚠ | 3.1 / – | -2.7 / – |
| Jalen Brunson | 45.7 / 45.7 | 15.2 / 15.2 | 56.1 / 56.1 | 2.3 / 2.3 | 3.9 / 4.2 ⚠ | 38.2 / 36.3 ⚠ | 2.6 / 2.5 ⚠ | 42.3 / 42.4 ⚠ | 1.8 / 1.9 ⚠ | 43.2 / 43.3 ⚠ | 2.5 / – | 4.4 / – |
| Victor Wembanyama | 15.7 / 15.7 | 7.3 / 7.3 | 60.1 / 60.1 | 6.0 / 6.0 | 3.8 / 2.6 ⚠ | 37.2 / 33.2 ⚠ | 5.1 / 4.7 ⚠ | 35.8 / 34.5 ⚠ | 3.0 / 3.0 | 36.2 / 36.2 | 4.7 / – | -12.3 / – |
| Stephen Curry | 28.2 / 28.2 | 9.1 / 9.1 | 58.9 / 58.9 | 3.8 / 3.8 | 6.8 / 6.6 ⚠ | 37.2 / 37.7 ⚠ | 6.1 / 6.0 ⚠ | 42.6 / 42.5 ⚠ | 3.5 / 3.5 | 46.0 / 46.0 | 2.5 / – | -4.5 / – |
| James Harden (traded LAC→CLE) | 40.9 / 40.9 | 14.1 / 14.1 | 57.2 / 57.2 | 2.2 / 2.2 | 4.8 / 6.0 ⚠ | 35.9 / 35.9 | 2.0 / 1.9 ⚠ | 39.5 / 39.9 ⚠ | 1.3 / 1.3 | 42.7 / 42.9 ⚠ | 3.2 / – | 2.6 / – |
| Nikola Vučević (traded CHI→BOS, diacritic) | 10.2 / 10.2 | 3.3 / 3.3 | 57.2 / 57.2 | 17.0 / 17.0 | 2.8 / 0.0 ⚠ | 41.4 / 25.0 ⚠ | 5.2 / 4.8 ⚠ | 37.1 / 35.4 ⚠ | 1.1 / 4.1 ⚠ | 39.7 / 36.8 ⚠ | 5.4 / – | -0.7 / – |
| Rudy Gobert (non-shooter C) | 6.5 / 6.5 | 0.8 / 0.8 | 38.1 / 38.1 | 35.2 / 35.2 | 0.1 / 0.0 ⚠ | 26.7 / – ⚠ | 0.1 / 0.0 ⚠ | 22.2 / 0.0 ⚠ | 0.0 / 0.0 | 0.0 / 0.0 | 4.2 / – | -11.3 / – |
| Nikola Jović (lowest MP, 808) | 13.8 / 13.8 | 7.4 / 7.4 | 43.5 / 43.5 | 5.2 / 5.2 | 3.9 / 0.7 ⚠ | 27.9 / 40.0 ⚠ | 6.1 / 6.0 ⚠ | 33.9 / 34.2 ⚠ | 1.3 / 4.0 ⚠ | 28.8 / 36.9 ⚠ | 4.5 / – | -1.2 / – |

Across the whole 2025-26 pool (cached vs recomputed):
- **3yr Pullup 3%**: 298/301 differ, median |diff| **4.6 pts**, p90 21.8; 263 players are off by ≥1 pt.
- **3yr Pullup 3s/36**: 303/313 differ, median 1.2, p90 2.8.
- 3yr C&S 3%: median 0.2, p90 2.1 (49 players ≥1 pt).
- Wide Open 3%: median 0.2, p90 1.1 (32 players ≥1 pt).
- TOP%, Drives/36, Drives TS% and Touches per drive: 100 % match.

**2024-25 (`dailycat-25`; the cache was pulled 2025-04-13, before the season ended)**

| Player | TOP% | Dr/36 | DrTS | T/Dr | PU/36 | PU% | CS/36 | CS% | WO/36 | WO% | D6/36 | D6diff |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Nikola Jokić | 25.1 / 24.8 | 4.8 / 4.8 | 58.7 / 57.5 | 11.6 / 11.4 | 0.7 / 0.7 | 31.4 / 31.7 | 2.4 / 2.4 | 41.1 / 41.2 | 1.2 / 1.4 ⚠ | 43.4 / 43.1 | 5.3 / – | -1.0 / – |
| Shai Gilgeous-Alexander | 38.8 / 38.8 | 21.8 / 21.7 | 63.7 / 63.3 | 1.3 / 1.3 | 3.2 / 3.2 | 35.1 / 35.5 | 0.9 / 0.9 | 39.3 / 38.4 | 1.4 / 2.1 ⚠ | 39.2 / 38.5 | 3.4 / – | -2.3 / – |
| Jalen Brunson | 48.7 / 48.7 | 18.3 / 18.1 | 59.7 / 59.8 | 1.8 / 1.8 | 3.8 / 3.8 | 37.4 / 37.5 | 2.1 / 2.1 | 44.9 / 44.7 | 1.3 / 1.8 ⚠ | 45.4 / 45.1 | 2.8 / – | 3.6 / – |
| Stephen Curry | 29.5 / 29.6 | 10.0 / 9.8 | 53.9 / 54.1 | 3.4 / 3.5 | 6.6 / 6.6 | 39.6 / 39.2 | 5.6 / 5.7 | 43.3 / 43.4 | 2.4 / 3.4 ⚠ | 45.5 / 45.8 | 2.3 / – | -2.1 / – |
| Dennis Schröder (traded BKN→GSW→DET) | 41.6 / 41.0 | 13.1 / 12.9 | 50.4 / 50.0 | 2.9 / 2.9 | 1.3 / 1.3 | 32.0 / 31.9 | 3.8 / 3.9 | 36.5 / 36.5 | 2.0 / 2.7 ⚠ | 36.8 / 37.2 | 3.1 / – | 0.9 / – |
| Rudy Gobert | 6.2 / 6.1 | 0.7 / 0.7 | 38.8 / 45.2 ⚠ | 37.9 / 37.7 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | blank / 0.0 | blank / 0.0 | 4.5 / – | -10.7 / – |

Most small 2024-25 gaps come from the 78-game snapshot, so they are expected staleness. The marked Wide Open
gap is structural: its window used a 23-game slice of 2023-24, which pulls WO/36 down by 0.5–1.0. Traded
players (Schröder, Harden) show no join problem, because both pbpstats and tracking report one season-total row.

**2017-18 (`dailycat-18`, an older season)**

| Player | TOP% | Dr/36 | DrTS | T/Dr | PU/36 | PU% | CS/36 | CS% | WO/36 | WO% | D6/36 | D6diff |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Stephen Curry | 31.8 / 31.8 | blank / 8.6 | blank / 64.4 | blank / 4.1 | 5.3 / 5.9 ⚠ | 41.7 / 40.9 ⚠ | 4.8 / 5.2 ⚠ | 42.8 / 46.0 ⚠ | 2.7 / 4.1 ⚠ | 46.7 / 47.2 ⚠ | 2.5 / 2.9 ⚠ | 7.8 / 8.9 ⚠ |
| LeBron James | 36.5 / 36.5 | blank / 11.4 | blank / 63.3 | blank / 3.6 | 1.9 / 2.6 ⚠ | 34.1 / 34.2 ⚠ | 2.0 / 1.3 ⚠ | 47.3 / 37.8 ⚠ | 1.3 / 1.6 ⚠ | 42.6 / 39.8 ⚠ | 2.8 / 3.9 ⚠ | -8.4 / -5.5 ⚠ |
| James Harden | 49.7 / 49.7 | blank / 17.4 | blank / 61.3 | blank / 1.5 | 4.2 / 6.1 ⚠ | 33.2 / 35.5 ⚠ | 1.5 / 2.4 ⚠ | 46.2 / 39.8 ⚠ | 1.2 / 1.3 ⚠ | 43.5 / 40.3 ⚠ | 3.2 / 4.5 ⚠ | 1.8 / 4.8 ⚠ |
| Nikola Jokic | 18.8 / 18.8 | blank / 3.0 | blank / 59.5 | blank / 19.0 | 0.4 / 0.3 ⚠ | **75.3** / 26.4 ⚠ | 1.7 / 2.4 ⚠ | 39.8 / 38.4 ⚠ | 1.0 / 1.4 ⚠ | 38.0 / 34.9 ⚠ | 5.8 / 8.8 ⚠ | 0.7 / 1.4 ⚠ |
| Rudy Gobert | 9.1 / 9.1 | blank / 1.1 | blank / 49.0 | blank / 33.1 | blank / 0.0 | blank / – | blank / 0.0 | blank / 0.0 | blank / 0.0 | blank / 0.0 | 4.6 / 8.4 ⚠ | -11.5 / -12.9 ⚠ |
| Dirk Nowitzki (retired before 2022-23) | 8.0 / 8.0 | blank / 0.1 | blank / 100.0 | blank / 530.8 | 0.1 / 0.2 ⚠ | **1020.0** / 20.5 ⚠ | 2.5 / 5.3 ⚠ | 34.5 / 39.4 ⚠ | 2.6 / 2.5 ⚠ | 43.7 / 41.5 ⚠ | 6.4 / 6.3 ⚠ | -1.9 / -2.5 ⚠ |

Pool-wide median |diff| on 3yr Pullup 3% is 228 pts (`dailycat-14`), 119 (`-18`), 44 (`-22`) and 31 (`-24`),
with maxima of about 5000 %. For players who retired before 2022-23 the value is literally `FG% / 3PM`.

### 4c. Mismatch table: 2yr Def < 6 ft in 2025-26 (cached vs NBA.com)

| Player | Cached D6/36 | Cached Diff% | Sheet's 2025-26 input: stale close_6 GP / DFGA | NBA.com 2025-26 DFGA (full) | Sheet 2024-25 DFGA (static) | NBA.com 2024-25 DFGA | 2yr D6/36 from NBA.com | 2yr Diff from NBA.com |
|---|---|---|---|---|---|---|---|---|
| Rudy Gobert | 4.2 | -11.3 | 13 / 78 | 498 | 475 | 463 | **7.3** | -11.1 |
| Nikola Jokić | 4.7 | 1.0 | 12 / 84 | 465 | 553 | 494 | **7.1** | 3.0 |
| Victor Wembanyama | 4.7 | -12.3 | 12 / 78 | 411 | 362 | 376 | **8.4** | **-18.7** |
| Nikola Vučević | 5.4 | -0.7 | 12 / 85 | 348 | 532 | 487 | 7.3 | -0.9 |
| Shai Gilgeous-Alexander | 3.1 | -2.7 | 14 / 59 | 200 | 355 | 276 | 3.5 | -2.8 |
| Jalen Brunson | 2.5 | 4.4 | 11 / 40 | 192 | 300 | 179 | 2.7 | **12.0** |
| James Harden | 3.2 | 2.6 | 12 / 63 | 182 | 399 | 268 | 3.1 | **13.0** |
| LeBron James | blank | blank | absent | 165 | 241 | 230 | 3.2 | 1.2 |
| Stephen Curry | 2.5 | -4.5 | 12 / 42 | 82 | 209 | 128 | 2.1 | 2.2 |

The cached per-36 understates rim-protection volume by about 35–45 % for bigs. That happens because about
12 games of DFGA are divided by 82 games of minutes. The static 2024-25 block **doesn't match NBA.com's current
2024-25 values**: for example Brunson 300 vs 179 and Harden 399 vs 268. I couldn't identify its source.

### 4d. Window checks

| Stat | Seasons the window should cover (2025-26) | What the sheet covers | Attempt-weighted? |
|---|---|---|---|
| 3yr Pullup | 25-26, 24-25, 23-24 | 25-26 **C&S FG (wrong data)** + 24-25 pull-up (dropped for accented names) + 23-24 pull-up | yes (Σmakes/Σatt) |
| 3yr C&S | same | 25-26 C&S **FG** + 24-25 + 23-24 C&S 3P | yes |
| 3yr Wide Open | same | correct seasons. The cache used a stale current file; accented names lose both prior seasons; 0 current attempts gives a blank | yes; per-36 on CS3 3yr MP |
| 2yr Def | 25-26, 24-25 | 25-26 = **15-GP snapshot**, 24-25 = static block of unknown origin | yes (DFGA-weighted xFG) |
| Older keys (≤2023-24) | Y, Y−1, Y−2 | Y (column-shifted) + **fixed 2022-23 + 2023-24**; Def: Y + **fixed partial 2023-24** | the sums are weighted, but over the wrong seasons |

The windows are never off by exactly one year. For every season before 2024-25 they are **fixed to 2022-23 and
2023-24**: the static blocks don't move when `Instructions!A13` changes.

---

## 5. Source vs NBA.com (2025-26, verified in Chrome via the stats.nba.com JSON behind the NBA.com pages)

| Player | Touches site_Data / NBA | TOP% cached / from NBA | Drives site_Data / NBA | Drives/36 cached / NBA | Drives TS% cached / NBA | C&S 3PA site_Data / NBA | PU 3PA site_Data / NBA | WO 3PA site_Data / NBA |
|---|---|---|---|---|---|---|---|---|
| Jalen Brunson | 6755 / 6096 | 45.7 / 53.7 | 1093 / 1493 | 15.2 / 20.8 | 56.1 / 56.1 | 221 / 216 | 306 / 303 | 127 / 146 |
| James Harden | 5366 / 5006 | 40.9 / 46.3 | 953 / 1204 | 14.1 / 17.8 | 57.2 / 58.6 | 147 / 137 | 421 / 422 | 90 / 91 |
| LeBron James | 4204 / 3935 | 23.2 / 25.0 | 413 / 700 | 7.5 / 12.7 | 56.4 / 57.4 | 122 / 126 | 112 / 100 | 84 / 69 |
| Nikola Jokić | 6513 / 6134 | 26.3 / 28.4 | 283 / 573 | 4.5 / 9.1 | 65.8 / 66.1 | 200 / 195 | 61 / 66 | 93 / 75 |
| Nikola Vučević | 3789 / 3720 | 10.2 / 12.8 | 167 / 259 | 3.3 / 5.1 | 57.2 / 52.1 | 266 / 263 | 2 / 3 | 222 / 234 |
| Rudy Gobert | 3390 / 3132 | 6.5 / 9.3 | 51 / 78 | 0.8 / 1.2 | 38.1 / 41.0 | 5 / 5 | 0 / 0 | 5 / 5 |
| Shai Gilgeous-Alexander | 4531 / 4418 | 37.9 / 45.6 | 1276 / 1752 | 20.3 / 27.9 | 65.6 / 66.6 | 56 / 50 | 242 / 240 | 90 / 98 |
| Stephen Curry | 2812 / 2701 | 28.2 / 33.7 | 337 / 480 | 9.1 / 13.0 | 58.9 / 63.9 | 247 / 249 | 236 / 232 | 131 / 160 |
| Victor Wembanyama | 3743 / 3570 | 15.7 / 16.3 | 376 / 484 | 7.3 / 9.3 | 60.1 / 58.9 | 238 / 241 | 96 / 99 | 139 / 103 |

Pool-wide agreement between site_Data on GitHub and NBA.com, as players matched exactly:

| Season | Drives | Touches | C&S 3PA | Pull-up 3PA | Wide-open 3PA | < 6 ft DFGA |
|---|---|---|---|---|---|---|
| 2017-18 | 536/536 | 536/536 | 317/485 (mean abs diff 0.6) | 367/485 (0.4) | 516/516 | 520/521 |
| 2022-23 | 536/536 | 536/536 | 520/520 | 520/520 | 532/532 | 385/524 (0.7) |
| 2023-24 | 567/567 | – | – | – | – | – |
| **2024-25** | **24/567** (mean 74 drives) | **13/567** (mean 134) | 180/539 (1.6) | 196/539 (1.8) | **98/548 (8.1)** | – |
| **2025-26** | **22/580** (mean 78 drives) | **2/580** (mean 156) | 186/546 (1.7) | 196/546 (1.6) | **93/560 (9.2)** | – |

Minutes match exactly (579/580), so the season and the games are the same. Through 2023-24 site_Data equals
NBA.com. **For 2024-25 and 2025-26, NBA.com's drives, touches and wide-open counts differ substantially from
site_Data**: NBA.com shows 30–100 % more drives and 5–10 % fewer touches.

Cause unknown: either NBA.com reprocessed these seasons' tracking, or the site_Data scraper changed for recent
seasons. Pull-up and C&S 3PA agree within a few attempts. This affects TOP%, Drives/36 and the Wide Open stats
for the two most recent seasons, and the pipeline can't catch it.

One NBA.com page was read directly to confirm the JSON equals the page: the closest-defender 2024-25 wide-open
page shows Curry 126/282.

---

## 6. Name matching

**2025-26, current-season join.** No player is blank because of a name mismatch. Every empty tracking value in
`dailycat-26` comes from 0 attempts or from absence in the stale close_6 file (§3). Every `dailycat-26` name is
found in every live tracking tab.

**Diacritics in the prior-season blocks (verified).**
- PU3 and WO3 strip accents from the current name (columns `AC` / `AH`) and look that up in static blocks that
  still have accents. The lookup fails, and the prior seasons silently drop out of the 3yr window.
- PU3 loses 2024-25 for 10 players in `dailycat-26`: Jokić, Dončić, Vučević, Jović, Nurkić, Matković, Krejčí,
  Schröder, Valančiūnas, Diabaté.
- WO3 loses both prior seasons for 9 players. Vučević's WO/36 shows 1.1 against 4.1, and Jović's WO% 28.8
  against 36.9.

**Older keys (verified against raw).** These players are blank in TOP% (and presumably the other tracking
columns) although the raw file has them under another spelling:
- PJ Tucker ↔ P.J. Tucker (2013-14…2018-19)
- TJ Warren ↔ T.J. Warren (2015-16, 2016-17)
- Marcus Morris (Morris Sr.), Enes Kanter (Enes Freedom), Juan Hernangomez (Juancho), Frank Mason (III),
  Kevin Knox (II): not present under the pbp spelling
- OG Anunoby, Zach LaVine and Ziaire Williams (2017-18…2021-22) were blank even though the exact spelling
  exists in today's GitHub files. That points to different spellings in the GCS files the sheet used then (inferred).

**Traded players.** Both pbpstats and the tracking files give one season-total row per player: pbpstats keeps
the first team, tracking the latest team. The join is by name, so traded players (Harden 2025-26, Vučević
2025-26, Schröder 2024-25) join correctly and their values match site_Data season totals.

---

## 7. Root causes

1. **The "Pullup" IMPORTRANGE returns catch-and-shoot data.** `PU3!B2` reads `Pullup!B2:L1000` from sheet
   `1dJa8…`, and that range has `CATCH_SHOOT_*` headers. The values are identical to `CS3!B:L` (Jokić 114/253 in
   both tabs; site_Data pull-up for him is 72/156, 3P 20/61). I couldn't read the source sheet itself: the
   service account was denied permission.
2. **The current-season columns are FG, not 3P.** Both PU3 and CS3 take `I/J` (`*_FGM/FGA`). The IMPORTRANGE
   range ends at column L, before `FG3M/FG3A`.
3. **The prior-season blocks are static pastes.** They don't follow `Instructions!A13`, so every historical
   pull mixes the requested season with fixed 2022-23 and 2023-24 data (2023-24 and 2024-25 in today's
   configuration).
4. **Lookups use fixed column indices across files with different layouts.** The GCS 2014–2024 files put `PTS`
   before `FGM` and have no `PLAYER_ID`; the 2025+ files have the newer layout. Fixed-index lookups therefore
   read FG% as makes and 3PM as attempts, and the Drives name column lands in the wrong place, which blanks
   Drives for 11 seasons (the Drives mechanism is inferred).
5. **Stale or partial source files.**
   - GCS `2024/*` is a 12-game snapshot, which ruins `dailycat-24` TOP% and Drives.
   - GCS `2025` and `2026/close_6.csv` stop at 2 and 15 games.
   - GitHub `2024/close_6.csv` stops at 24 games and GitHub `2024/player_tracking/wide_open.csv` at 23 games.
     Those last two are baked in as the "previous season" of every older key.
   - `dailycat-25` was pulled 2025-04-13, about 4 games before the season ended.
   - The 2025-26 Wide Open cache was built from a GCS file older than today's.
6. **Accent stripping on only one side** of the PU3 and WO3 static lookups.
7. **The guard `IF(R3>0, …, "#VALUE!")`** blanks Wide Open for players with 0 current-season attempts.
8. **Missing static Height and Position.** `'Pos & Height'` has nothing after 2023-24. Blank values become 0
   inside Box Creation, Load and Passer Rating; Passer Rating is about 0 for 26 players in 2025-26. Blank
   Position becomes 0 in Mates Spacing.
9. **Upstream divergence.** site_Data and NBA.com disagree for 2024-25 and 2025-26 on drives, touches and
   wide-open shots.
10. **No complete < 6 ft source** exists in site_Data after 2022-23.

---

## 8. Fix options (not implemented)

1. **Compute tracking stats in Node from site_Data and stop taking them from the sheet.** Recommended for the
   history. A small script would:
   - download the GitHub `master/<year>/player_tracking/{touches,drives,pullup,cs}.csv` and
     `player_shooting/wide_open.csv` files;
   - read columns **by header name** (`3PM`, `3PA`, `MIN`, `DRIVES`, …);
   - join on `PLAYER_ID`, mapped to the profile's NBA id via `data/bio.json` / `index_master.csv`, which
     removes the name and diacritic problems;
   - compute the windows over Y, Y−1 and Y−2 with Σmakes/Σatt and Σatt/(ΣMIN/36);
   - write the results to a separate cache key, or overlay the dailycat columns at read time in `lib/`.

   This restores Drives for 2013-14…2023-24 and fixes every 3yr window. Validation is easy: 2013-14…2023-24 in
   site_Data already match NBA.com exactly.
2. **Patch the sheet, for the live season only.** Each of these changes needs the user's approval before
   anything is written to the sheet:
   - point PU3 at real pull-up data (fix the `Pullup` tab in `1dJa8…`, or import `2026/player_tracking/pullup.csv`);
   - widen the IMPORTRANGE ranges to include `*_FG3M/*_FG3A` and use those columns;
   - look up the static blocks with the raw name (as CS3 does), or strip accents on both sides;
   - return 0 instead of `#VALUE!` for 0 Wide Open attempts;
   - find a current < 6 ft source.
3. **If historical seasons must stay sheet-driven**, replace the static prior-season blocks with
   `IMPORTDATA` keyed on `LEFT(A13,4)` and `LEFT(A13,4)-1`. Use the GitHub URLs, not GCS (the GCS 2024 files are
   stale and use the old layout), and `MATCH` on header names instead of fixed indices. Then re-pull
   `dailycat-14…25`. This is more fragile than option 1.
4. **Def < 6 ft for 2023-24 → 2025-26.** No complete file exists. Options: fetch from NBA.com through the
   browser or another machine (stats.nba.com is blocked here), ask the site_Data maintainer, or hide
   "2yr Def FGA < 6" for those seasons until a full source exists. Until then, the 2025-26 values understate
   volume by about 40 %.
5. **Treat the old tracking values as invalid now.** `lib/stats.js` / `lib/profile.js` could hide
   3yr PU/CS/WO and 2yr Def for `dailycat-14…24`, and TOP% for `dailycat-24`, so the profile doesn't show
   1020 % pull-up shooting. No historical value is trustworthy except TOP% for 2013-14…2022-23.
6. **Resolve the site_Data vs NBA.com divergence for 2024-25 and 2025-26** before relying on Drives/36 or TOP%
   for those seasons. Re-scrape, or ask the maintainer which definition the files use.
7. **Fill `'Pos & Height'` and the DOB list** for players who arrived after 2023-24. This fixes Passer Rating
   and Box Creation for 26 players and Mates Spacing for their teams. Another option is to source height and
   position from `data/bio.json`.
8. **Name aliases for older keys** (P.J./T.J., Morris Sr., Freedom, Juancho, Mason III, Knox II). These are
   unnecessary if option 1 joins on `PLAYER_ID`.

---

## 9. Audit log

All times are PDT on 2026-10-01. Every entry is READ-only. The service account used the
`spreadsheets.readonly` scope throughout, and nothing was written anywhere except this file and the scratch folder.

| # | Time (PDT) | Type | Target | What / why |
|---|---|---|---|---|
| 1 | 20:40 | READ | Sheet `10deal7…`: spreadsheet metadata | Listed tabs and their sizes |
| 2 | 20:40 | READ | `Format!A1:BK7`, `Instructions!A1:F40` (FORMULA) | Format → Sort mapping and the scoping cells (`A13` = 2025-26, `B29` = GCS base) |
| 3 | 20:41 | READ | `Sort!A1:DZ3`, `'All RS'!A1:DW3` (FORMULA) | Sort ↔ All RS offset; All RS lookups into the tracking tabs |
| 4 | 20:41 | READ | `PU3!A1:BJ4`, `CS3!A1:AZ4`, `WO3!A1:BU4`, `Touches!A1:BE4`, `Drives!A1:AF4`, `Inside6!A1:AM4` (FORMULA) | Import formulas and per-36 / TS% / window formulas |
| 5 | 20:42 | READ | `api.github.com/repos/gabriel1200/site_Data` (repo, `contents/`, `contents/{2014..2026}/player_tracking`) | Per-year file inventory (default branch `master`) |
| 6 | 20:42 | READ | `api.github.com` `contents/{2014,2020,2024,2025,2026}/{player_shooting,defense}` | Wide-open and defense file inventory |
| 7 | 20:42 | READ | `storage.googleapis.com/thinkingbball/2026/...`, `2018/player_tracking/drives.csv` | Checked that the GCS bucket the sheet imports from is readable |
| 8 | 20:43 | READ | GCS `thinkingbball/{2014..2026}/player_tracking/{cs,pullup,touches,drives,close_6,wide_open}.csv`, `player_shooting/wide_open.csv`, and the same paths on `raw.githubusercontent.com/gabriel1200/site_Data/master/` | Raw data for recomputation; compared layouts and completeness |
| 9 | 20:44 | READ | Rows 1–6 values of the six tracking tabs (UNFORMATTED_VALUE) | Current tab contents, including the C&S data under PU3 |
| 10 | 20:45 | READ | HEAD requests to GCS files for 2014/2018/2024/2025/2026 | `Last-Modified` dates to establish staleness |
| 11 | 20:46 | READ | `raw.githubusercontent.com/.../master/{2024,2025}/defense/dfg.csv`, `dfg.csv` | Looked for a complete < 6 ft source; these are overall-defense files, and 2024 duplicates 2025 |
| 12 | 20:46 | READ | Full values of `PU3!A2:BJ1000`, `CS3!A2:AZ1000`, `WO3!A2:BU1000`, `Touches!A2:BE1000`, `Drives!A2:AF1000`, `Inside6!A2:AM1000`, `Instructions!A13`, `'League data'!A1:H3` | Recomputed the sheet's 2025-26 values and identified the static blocks |
| 13 | ~20:48 | READ (denied) | Sheet `1dJa8DTXN3e4g7wjL8-nSd0aJ-LovPxze4sbm57ROgDg` metadata and `Pullup/CS/Touches/Drives` ranges | Wanted to confirm the IMPORTRANGE source; the service account has no access |
| 14 | 20:54 | READ | `'RS PBP'!A1:C3`, `'RS PBP'!IT1:KP3`, `'Pos & Height'!A1:H3`, `'League data'!A1:F2` (FORMULA) | Classified pbp vs non-pbp columns; Position, Height and DOB sources |
| 15 | 20:54 | READ | `'Pos & Height'!A1:D6805`, `'Pos & Height'!AJ1:AT8` | Seasons covered by the position and height table; DOB list |
| 16 | 20:56 | READ | `raw.githubusercontent.com/.../master/{2023,2025,2026}/player_shooting/{open,tight,very_tight,wide_open}.csv` | Checked the wide-open definition against NBA.com |
| 17 | ~20:50–20:57 | READ | Chrome, own tab: `nba.com/stats/players/drives?Season=2025-26…`; in-page GETs to `stats.nba.com/stats/leaguedashptstats` (Drives, CatchShoot, PullUpShot, Possessions) for 2025-26, 2024-25, 2023-24, 2022-23, 2017-18; `leaguedashptdefend` (< 6 ft: 2025-26, 2024-25, 2022-23, 2017-18; < 10 ft: 2024-25); `leaguedashplayerptshot` (wide open: 2025-26, 2024-25, 2022-23, 2017-18); GitHub CSVs fetched in-page for the comparison | Source vs NBA.com checks (§5, §4c). No forms, logins or dialogs. The tab was closed afterwards. |
| 18 | 20:57 | READ | Chrome, own tab: `nba.com/stats/players/shots-closest-defender?CloseDefDistRange=6%2B+Feet+-+Wide+Open&Season=2024-25` | Confirmed the JSON matches the rendered NBA.com table (Curry 126/282) |
| 19 | ~21:00 | READ | `'All RS'!A1:DW700` (UNFORMATTED_VALUE) | Checked how a blank Height affects Passer Rating and Box Creation |
| 20 | 20:40–21:05 | READ | Local only: `git log` / `git show` of `data/cached-data.json` (297 commits) | Dated each dailycat key's last pull |
