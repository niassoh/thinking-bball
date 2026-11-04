// NBA.com's team-level tracking tables, one CSV each per season, for the Teams sheet
// (scripts/team-tracking.js, docs/team-tracking.md). The team_tracking/ CSVs keep NBA.com's
// resultSet headers and values as served (percentages 0–1), so a tab can IMPORTDATA one as
// is. Play types (and a copy of drives) go to the bucket's older <yr>/playtype/ folder in
// that folder's own layout instead, which the sheet's Old Off Playtype tab already reads;
// opponents' open and wide-open shots also go to <yr>/opp_shooting/ in its layout.

// leaguedashptstats and the shot/defend dashboards want every filter, if blank.
const BLANK = ['College', 'Conference', 'Country', 'DateFrom', 'DateTo', 'Division', 'DraftPick', 'DraftYear', 'GameScope', 'GameSegment', 'Height', 'ISTRound',
  'Location', 'Outcome', 'PlayerExperience', 'PlayerPosition', 'SeasonSegment', 'StarterBench', 'VsConference', 'VsDivision', 'Weight']
const COMMON = { ...Object.fromEntries(BLANK.map(k => [k, ''])), LastNGames: 0, LeagueID: '00', Month: 0, OpponentTeamID: 0, PORound: 0, Period: 0, TeamID: 0, PerMode: 'Totals' }
const shot = CloseDefDistRange => ({ CloseDefDistRange, DribbleRange: '', GeneralRange: '', ShotClockRange: '', ShotDistRange: '', TouchTimeRange: '' })
const RANGES = [['very_tight', '0-2 Feet - Very Tight'], ['tight', '2-4 Feet - Tight'], ['open', '4-6 Feet - Open'], ['wide_open', '6+ Feet - Wide Open']]

const MEASURES = [
  ...[['speed_distance', 'SpeedDistance'], ['rebounding', 'Rebounding'], ['possessions', 'Possessions'], ['catch_shoot', 'CatchShoot'], ['pullup', 'PullUpShot'],
    // drives also goes to playtype/drives.csv beside the play types, as that folder had it.
    ['defense', 'Defense'], ['drives', 'Drives', [['team_tracking/drives', 'raw'], ['playtype/drives', 'drives']]], ['passing', 'Passing'],
    ['elbow_touch', 'ElbowTouch'], ['post_touch', 'PostTouch'], ['paint_touch', 'PaintTouch'], ['efficiency', 'Efficiency']]
    .map(([name, PtMeasureType, files]) => ({ name, endpoint: 'leaguedashptstats', params: { PlayerOrTeam: 'Team', PtMeasureType }, files })),
  // The team's own shots, then its opponents', by distance to the closest defender.
  ...RANGES.map(([name, range]) => ({ name: `shooting_${name}`, endpoint: 'leaguedashteamptshot', params: shot(range) })),
  // Open and wide open also go to the older opp_shooting/ folder in its layout, the files
  // the Teams sheet's opponents' 3s come from (they were in the luck sheet).
  ...RANGES.map(([name, range]) => ({ name: `opp_shooting_${name}`, endpoint: 'leaguedashoppptshot', params: shot(range),
    files: ['open', 'wide_open'].includes(name) ? [[`team_tracking/opp_shooting_${name}`, 'raw'], [`opp_shooting/${name}`, 'opp_shooting']] : undefined })),
  ...[['overall', 'Overall'], ['3pt', '3 Pointers'], ['2pt', '2 Pointers'], ['lt6', 'Less Than 6Ft'], ['lt10', 'Less Than 10Ft'], ['gt15', 'Greater Than 15Ft']]
    .map(([name, DefenseCategory]) => ({ name: `defend_${name}`, endpoint: 'leaguedashptteamdefend', params: { DefenseCategory } })),
  // Synergy, not tracking, but the sheet's Off Playtype tab reads it from NBA.com too. The
  // names stay as the cache has them. Each goes to the playtype/ folder twice, the same file:
  // under the folder's old name, and under teamplay.csv's playtype key, which the Teams
  // sheet's tabs are keyed by (iso, misc and cut are both).
  ...[['isolation', 'Isolation', 'iso', 'iso'], ['transition', 'Transition', 'trans', 'tran'], ['pr_ball_handler', 'PRBallHandler', 'bh', 'pr_ball'],
    ['pr_roll_man', 'PRRollman', 'rollman', 'pr_roll'], ['post_up', 'Postup', 'postup', 'post'], ['spot_up', 'Spotup', 'spotup', 'spot'],
    ['handoff', 'Handoff', 'handoff', 'hand_off'], ['cut', 'Cut', 'cut', 'cut'], ['off_screen', 'OffScreen', 'offscreen', 'off_screen'],
    ['putbacks', 'OffRebound', 'putback', 'oreb'], ['misc', 'Misc', 'misc', 'misc']]
    .map(([name, PlayType, ...files]) => ({ name: `playtype_${name}`, endpoint: 'synergyplaytypes', params: { PlayType, PlayerOrTeam: 'T', TypeGrouping: 'offensive' },
      files: [...new Set(files)].map(f => [`playtype/${f}`, 'playtype']) }))
]

const seasonLabel = end => `${end - 1}-${String(end).slice(-2)}`
const folder = (end, playoffs) => `${end}/${playoffs ? 'playoffs/' : ''}`
const objectName = (end, playoffs, file) => `${folder(end, playoffs)}${file}.csv`
// Each measure's bucket files, [object, layout]: by default its NBA.com table as is.
const filesOf = m => m.files || [[`team_tracking/${m.name}`, 'raw']]
const cacheName = (end, playoffs, m) => `${folder(end, playoffs)}team_tracking/${m.name}.json`

const requestUrl = (measure, end, playoffs) => {
  const SeasonType = playoffs ? 'Playoffs' : 'Regular Season'
  const params = measure.endpoint === 'synergyplaytypes'
    ? { LeagueID: '00', PerMode: 'Totals', SeasonType, SeasonYear: seasonLabel(end), ...measure.params }
    : { ...COMMON, Season: seasonLabel(end), SeasonType, ...measure.params }
  return `https://stats.nba.com/stats/${measure.endpoint}?${new URLSearchParams(params)}`
}

const resultSet = json => (Array.isArray(json.resultSets) ? json.resultSets[0] : json.resultSets)
const cell = v => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
const toCsv = ({ headers, rowSet }) => [headers, ...rowSet].map(r => r.map(cell).join(',')).join('\n') + '\n'

// The playtype/ folder's layout: full team names, percentages 0–100 to one decimal, PPP to
// two written as the folder's files have it (0.9, 1.0, 0.95).
const pct = v => (v * 100).toFixed(1)
const ppp = v => v.toFixed(2).replace(/(\.\d)0$/, '$1')
const COLUMNS = {
  playtype: [['TEAM', 'TEAM_NAME'], ['GP', 'GP'], ['POSS', 'POSS'], ['FREQ%', 'POSS_PCT', pct], ['PPP', 'PPP', ppp], ['PTS', 'PTS'], ['FGM', 'FGM'],
    ['FGA', 'FGA'], ['FG%', 'FG_PCT', pct], ['EFG%', 'EFG_PCT', pct], ['FTFREQ%', 'FT_POSS_PCT', pct], ['TOVFREQ%', 'TOV_POSS_PCT', pct], ['SFFREQ%', 'SF_POSS_PCT', pct],
    ['AND ONEFREQ%', 'PLUSONE_POSS_PCT', pct], ['SCOREFREQ%', 'SCORE_POSS_PCT', pct], ['PERCENTILE', 'PERCENTILE', pct]],
  drives: [['Team', 'TEAM_NAME'], ['GP', 'GP'], ['W', 'W'], ['L', 'L'], ['MIN', 'MIN'], ['DRIVES', 'DRIVES'], ['FGM', 'DRIVE_FGM'], ['FGA', 'DRIVE_FGA'],
    ['FG%', 'DRIVE_FG_PCT', pct], ['FTM', 'DRIVE_FTM'], ['FTA', 'DRIVE_FTA'], ['FT%', 'DRIVE_FT_PCT', pct], ['PTS', 'DRIVE_PTS'], ['PTS%', 'DRIVE_PTS_PCT', pct],
    ['PASS', 'DRIVE_PASSES'], ['PASS%', 'DRIVE_PASSES_PCT', pct], ['AST', 'DRIVE_AST'], ['AST%', 'DRIVE_AST_PCT', pct], ['TO', 'DRIVE_TOV'], ['TOV%', 'DRIVE_TOV_PCT', pct],
    ['PF', 'DRIVE_PF'], ['PF%', 'DRIVE_PF_PCT', pct]],
  // Team abbreviations, percentages 0–100.
  opp_shooting: [['TEAM', 'TEAM_ABBREVIATION'], ['GP', 'GP'], ['G', 'G'], ['Freq%', 'FGA_FREQUENCY', pct], ['FGM', 'FGM'], ['FGA', 'FGA'], ['FG%', 'FG_PCT', pct],
    ['eFG%', 'EFG_PCT', pct], ['2FG Freq%', 'FG2A_FREQUENCY', pct], ['2FGM', 'FG2M'], ['2FGA', 'FG2A'], ['2FG%', 'FG2_PCT', pct], ['3FG Freq%', 'FG3A_FREQUENCY', pct],
    ['3PM', 'FG3M'], ['3PA', 'FG3A'], ['3P%', 'FG3_PCT', pct]]
}
const csvAs = (layout, { headers, rowSet }) => {
  if (layout === 'raw') return toCsv({ headers, rowSet })
  const cols = COLUMNS[layout].map(([head, key, f]) => {
    if (!headers.includes(key)) throw new Error(`NBA.com's ${layout} table has no ${key}`)
    return [head, headers.indexOf(key), f]
  })
  return toCsv({ headers: cols.map(c => c[0]), rowSet: rowSet.map(r => cols.map(([, i, f]) => (f && r[i] != null ? f(r[i]) : r[i]))) })
}

module.exports = { MEASURES, seasonLabel, objectName, filesOf, cacheName, requestUrl, resultSet, toCsv, csvAs }
