// Stat metadata for the player profile, keyed by the labels used in
// design_handoff_player_profile/Player Profile v3.dc.html.

// [tabId, tabName, [[label, dailycat column | null, isNew]]]. The columns Ben's sheet shows
// (his Format tab, set by its 'Format checklist': 2026-11 DEV build), in his categories.
const TABS = [
  ['impact', 'Impact', [
    ['BPM', 'BPM'],
    ['AuPM', 'AuPM'],
    ['AuPM / g', 'AuPM/g'],
    ['Net On', 'Net On'],
    ['Net On/Off', 'Net On/Off']
  ]],
  ['creation', 'Load & Creation', [
    ['Load', 'Load'],
    ['Box Creation', 'Box Creation'],
    ['Passer Rating', 'Passer Rating'],
    ['Time of Poss %', 'Time of Poss %'],
    ['cTOV%', 'cTOV%'],
    ['Layup Ast%', 'Layup Ast%'],
    ['% of 2s Assisted', '% of 2s assisted'],
    ['% of 3s Assisted', '% of 3s assisted']
  ]],
  ['offense', 'Offense', [
    ['Pts / 75', 'Pts 75'],
    ['rTS%', 'rTS%'],
    ['OBPM', 'OBPM'],
    ['ScoreVal', 'ScoreVal'],
    ['PlayVal', 'PlayVal'],
    ['ORTG On', 'ORTG On'],
    ['rOS%', 'rOS%'],
    ['Good:Bad Pass', 'Good:Bad Pass ratio'],
    ['Handle TOV%', 'Handle TOV%'],
    ['Non-Pass TOV%', 'Non-Pass TOV%'],
    ['ORTG Off', 'ORTG Off'],
    ['ORTG On/Off', 'ORTG On/Off']
  ]],
  ['rim', 'Rim', [
    ['Drives / 36', 'Drives/36'],
    ['Drives TS%', 'Drives TS%'],
    ['Rim FGA', 'Rim FGA'],
    ['Rim FG%', 'Rim FG%'],
    ['Rim+FT TSA%', 'Rim+FT TSA%'],
    ['Fouls Drawn', 'FD'],
    ['FTA / 75', 'FTA 75'],
    ['FTA : Rim FGA', 'FTA:RimFGA'],
    ['Rim Assisted%', 'AtRimPctAssisted']
  ]],
  ['shooting', 'Shooting', [
    ['Midrange FGA', 'Midrange FGA'],
    ['Midrange FG%', 'Midrange FG%'],
    ['rMidrange FG%', 'rMidrange FG%'],
    ['Wide Open 3s/36', '3yr Wide Open 3s/36'],
    ['Wide Open 3%', '3yr Wide Open 3%'],
    ['Pullup 3s/36', '3yr Pullup 3s/36'],
    ['Pullup 3%', '3yr Pullup 3%'],
    ['C&S 3s/36', '3yr C&S 3s/36'],
    ['C&S 3%', '3yr C&S 3%'],
    ['FT%', 'FT%'],
    ['Corner 3 Share', 'Corner 3 Share%'],
    ['Off-Ball Scoring%', 'Off-Ball Scoring%'],
    ['Movement Scoring%', 'Movement Scoring%']
  ]],
  ['defense', 'Defense', [
    ['Def FGA <6ft /36', '2yr Def FGA < 6 per36'],
    ['Def FGA Diff%', '2yr Def FGA Diff%'],
    ['Forced TOV', 'FTOV'],
    ['DRTG On', 'DRTG On'],
    ['DRTG Off', 'DRTG Off'],
    ['DRTG On/Off', 'DRTG On/Off'],
    ['Positions Guarded', 'Positions Guarded'],
    ['Primary Matchup', 'Primary Matchup'],
    ['Opp Load', 'Opp Load'],
    ['Matchup Scoring', 'Matchup Scoring'],
    ['Matchup Scoring rPos', 'Matchup Scoring rPos'],
    ['Adj Matchup Scoring', 'Adjusted Matchup Scoring'],
    ['Def FGA <6ft rPos', '2yr DFGA / 36 rPos'],
    ['Def FGA Diff rPos', '2yr Diff rPos'],
    ['Goaltend%', 'Goaltend%'],
    ['Pass Steals', 'Pass steals'],
    ['Strip Steals', 'Strip steals'],
    // Written in from the lineups (lib/profile.js rimDefense), not the sheet's.
    ['rRim2FT', 'rRim2FT'],
    ['Rim2FT', 'Rim2FT']
  ]],
  ['team', 'Team', [
    ['Team Net', 'Team Net'],
    ['Team Off', 'Team Off'],
    ['Team Def', 'Team Def'],
    ['Mates Spacing', 'Mates Spacing 100']
  ]]
]

// 1historical-24 only covers a subset of stats; it fills seasons before the
// first dailycat key (2000-01, backfilled by scripts/backfill-seasons.js).
// "IA Pts/75" is inflation-adjusted, so it is deliberately not mapped to Pts / 75.
const HISTORICAL_COLUMNS = {
  'BPM': 'BPM',
  'OBPM': 'OBPM',
  'AuPM / g': 'AuPM/g',
  'ScoreVal': 'ScoreVal',
  'PlayVal': 'PlayVal',
  'Load': 'Load',
  'rTS%': 'rTS%',
  'Box Creation': 'Box Creation',
  'Passer Rating': 'Passer rating'
}

// League average is 0 by definition for relative stats.
const RELATIVE = new Set([
  'BPM', 'AuPM', 'AuPM / g', 'Net On', 'Net On/Off', 'rTS%', 'rOS%', 'ScoreVal',
  'PlayVal', 'Team Net', 'Team Off', 'Team Def', 'OBPM', 'Def FGA Diff%', 'rRim2FT',
  'ORTG On/Off', 'DRTG On/Off', 'rMidrange FG%', 'Layup Ast%', 'Matchup Scoring', 'Matchup Scoring rPos',
  'Adj Matchup Scoring', 'Def FGA <6ft rPos', 'Def FGA Diff rPos'
])

// With the sheet's: its Sort row's ASC, by which the pull ranks percentiles (and any DRTG).
const LOWER_BETTER = new Set([
  'DRTG On', 'cTOV%', 'Handle TOV%', 'Non-Pass TOV%', 'Def FGA Diff%', 'Team Def', 'rRim2FT',
  'Rim2FT', 'DRTG Off', 'DRTG On/Off', 'Matchup Scoring', 'Matchup Scoring rPos',
  'Adj Matchup Scoring', 'Def FGA Diff rPos', 'Goaltend%', 'FTA / 75', 'Mates Spacing'
])

const ALL_STATS = TABS.flatMap(([tab, , rows]) =>
  rows.map(([label, column, isNew]) => ({ tab, label, column, isNew: !!isNew }))
)

// A stat label as a file name for the static site ('Pts / 75' -> 'pts-75'). The site's
// copy is in thinking-bball-profile src/lib/static.js; the two must agree.
const statKey = label => label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

// The sheet's tracking stats over a rolling window name it in their column
// ("3yr Pullup 3%", "2yr Def FGA < 6 per36"): the number of seasons, else null. The
// playoff sheet's same columns cover that playoff run only.
const yearsOf = column => Number((/^(\d)yr /.exec(column || '') || [])[1]) || null

// The stats compared on the Last 30 Days card (scripts/recent-shift.js), its playoffs
// counterpart (playoffs vs regular season) and the career view, as [label, column].
const SHIFT_STATS = [['BPM', 'BPM'], ['AuPM / g', 'AuPM/g'], ['Load', 'Load'], ['rTS%', 'rTS%'], ['Net On', 'Net On'], ['Time of Poss %', 'Time of Poss %']]

module.exports = { TABS, HISTORICAL_COLUMNS, RELATIVE, LOWER_BETTER, ALL_STATS, statKey, yearsOf, SHIFT_STATS }
