const test = require('node:test')
const assert = require('node:assert')
const { MEASURES, seasonLabel, objectName, filesOf, cacheName, requestUrl, resultSet, toCsv, csvAs } = require('../lib/team-tracking')

const measure = name => MEASURES.find(m => m.name === name)

test('season labels and bucket paths follow the end year', () => {
  assert.strictEqual(seasonLabel(2014), '2013-14')
  assert.strictEqual(seasonLabel(2027), '2026-27')
  assert.strictEqual(objectName(2014, false, 'team_tracking/drives'), '2014/team_tracking/drives.csv')
  assert.strictEqual(objectName(2026, true, 'playtype/iso'), '2026/playoffs/playtype/iso.csv')
  assert.strictEqual(cacheName(2026, true, measure('playtype_isolation')), '2026/playoffs/team_tracking/playtype_isolation.json')
})

test('play types go to the playtype folder under its old names and teamplay.csv\'s, drives to both folders', () => {
  const files = MEASURES.filter(m => m.endpoint === 'synergyplaytypes').flatMap(filesOf)
  assert.ok(files.every(([, layout]) => layout === 'playtype'))
  assert.deepStrictEqual(files.map(([f]) => f).sort(), ['bh', 'cut', 'hand_off', 'handoff', 'iso', 'misc', 'off_screen', 'offscreen', 'oreb', 'post', 'postup', 'pr_ball', 'pr_roll', 'putback',
    'rollman', 'spot', 'spotup', 'tran', 'trans'].map(n => `playtype/${n}`))
  assert.deepStrictEqual(filesOf(measure('playtype_putbacks')), [['playtype/putback', 'playtype'], ['playtype/oreb', 'playtype']])
  assert.deepStrictEqual(filesOf(measure('drives')), [['team_tracking/drives', 'raw'], ['playtype/drives', 'drives']])
  assert.deepStrictEqual(filesOf(measure('pullup')), [['team_tracking/pullup', 'raw']])
  const objects = MEASURES.flatMap(m => filesOf(m).map(f => f[0]))
  assert.strictEqual(new Set(objects).size, objects.length)
  assert.strictEqual(new Set(MEASURES.map(m => m.name)).size, MEASURES.length)
})

test('requests ask for teams in the season and season type', () => {
  const at = name => new URL(requestUrl(measure(name), 2014, true)).searchParams
  const drives = at('drives')
  assert.strictEqual(drives.get('PlayerOrTeam'), 'Team')
  assert.strictEqual(drives.get('PtMeasureType'), 'Drives')
  assert.strictEqual(drives.get('Season'), '2013-14')
  assert.strictEqual(drives.get('SeasonType'), 'Playoffs')
  assert.strictEqual(at('opp_shooting_wide_open').get('CloseDefDistRange'), '6+ Feet - Wide Open')
  const iso = at('playtype_isolation')
  assert.strictEqual(iso.get('SeasonYear'), '2013-14')
  assert.strictEqual(iso.get('PlayerOrTeam'), 'T')
  assert.strictEqual(iso.has('Season'), false)
})

test('CSV keeps the headers, blanks nulls and quotes commas', () => {
  const rs = resultSet({ resultSets: [{ headers: ['TEAM_ID', 'TEAM_NAME', 'FG_PCT'], rowSet: [[1, 'LA Clippers', 0.45], [2, 'A, "B"', null]] }] })
  assert.strictEqual(toCsv(rs), 'TEAM_ID,TEAM_NAME,FG_PCT\n1,LA Clippers,0.45\n2,"A, ""B""",\n')
  assert.deepStrictEqual(resultSet({ resultSets: { headers: ['X'], rowSet: [] } }), { headers: ['X'], rowSet: [] })
})

// 2022-23 Milwaukee isolation as NBA.com serves it, and its row in the bucket's playtype/iso.csv.
test('play types come out in the playtype folder layout', () => {
  const headers = ['SEASON_ID', 'TEAM_ID', 'TEAM_ABBREVIATION', 'TEAM_NAME', 'PLAY_TYPE', 'TYPE_GROUPING', 'PERCENTILE', 'GP', 'POSS_PCT', 'PPP', 'FG_PCT', 'FT_POSS_PCT',
    'TOV_POSS_PCT', 'SF_POSS_PCT', 'PLUSONE_POSS_PCT', 'SCORE_POSS_PCT', 'EFG_PCT', 'POSS', 'PTS', 'FGM', 'FGA', 'FGMX']
  const row = ['22022', 1610612749, 'MIL', 'Milwaukee Bucks', 'Isolation', 'Offensive', 0.034, 82, 0.063, 0.801, 0.384, 0.119, 0.109, 0.112, 0.024, 0.396, 0.408, 588, 471, 179, 466, 287]
  assert.strictEqual(csvAs('playtype', { headers, rowSet: [row, row.map((v, i) => (i === 9 ? 1.004 : v))] }),
    'TEAM,GP,POSS,FREQ%,PPP,PTS,FGM,FGA,FG%,EFG%,FTFREQ%,TOVFREQ%,SFFREQ%,AND ONEFREQ%,SCOREFREQ%,PERCENTILE\n' +
    'Milwaukee Bucks,82,588,6.3,0.8,471,179,466,38.4,40.8,11.9,10.9,11.2,2.4,39.6,3.4\n' +
    'Milwaukee Bucks,82,588,6.3,1.0,471,179,466,38.4,40.8,11.9,10.9,11.2,2.4,39.6,3.4\n')
  assert.throws(() => csvAs('playtype', { headers: headers.filter(h => h !== 'PPP'), rowSet: [] }), /no PPP/)
})

test('drives come out in the playtype folder layout', () => {
  const headers = ['TEAM_ID', 'TEAM_ABBREVIATION', 'TEAM_NAME', 'GP', 'W', 'L', 'MIN', 'DRIVES', 'DRIVE_FGM', 'DRIVE_FGA', 'DRIVE_FG_PCT', 'DRIVE_FTM', 'DRIVE_FTA', 'DRIVE_FT_PCT',
    'DRIVE_PTS', 'DRIVE_PTS_PCT', 'DRIVE_PASSES', 'DRIVE_PASSES_PCT', 'DRIVE_AST', 'DRIVE_AST_PCT', 'DRIVE_TOV', 'DRIVE_TOV_PCT', 'DRIVE_PF', 'DRIVE_PF_PCT']
  const row = [1610612737, 'ATL', 'Atlanta Hawks', 81, 38, 43, 19590, 3130, 502, 1211, 0.415, 297, 378, 0.786, 1334, 0.426, 1139, 0.364, 308, 0.098, 223, 0.071, 191, 0.061]
  assert.strictEqual(csvAs('drives', { headers, rowSet: [row] }),
    'Team,GP,W,L,MIN,DRIVES,FGM,FGA,FG%,FTM,FTA,FT%,PTS,PTS%,PASS,PASS%,AST,AST%,TO,TOV%,PF,PF%\n' +
    'Atlanta Hawks,81,38,43,19590,3130,502,1211,41.5,297,378,78.6,1334,42.6,1139,36.4,308,9.8,223,7.1,191,6.1\n')
})

// 2025-26 Milwaukee's opponents, wide open, as NBA.com serves it.
test('opponents\' open and wide-open shots also go to opp_shooting in its layout', () => {
  assert.deepStrictEqual(filesOf(measure('opp_shooting_wide_open')), [['team_tracking/opp_shooting_wide_open', 'raw'], ['opp_shooting/wide_open', 'opp_shooting']])
  assert.deepStrictEqual(filesOf(measure('opp_shooting_tight')), [['team_tracking/opp_shooting_tight', 'raw']])
  const headers = ['TEAM_ID', 'TEAM_NAME', 'TEAM_ABBREVIATION', 'GP', 'G', 'FGA_FREQUENCY', 'FGM', 'FGA', 'FG_PCT', 'EFG_PCT', 'FG2A_FREQUENCY', 'FG2M', 'FG2A', 'FG2_PCT',
    'FG3A_FREQUENCY', 'FG3M', 'FG3A', 'FG3_PCT']
  const row = [1610612749, 'Milwaukee Bucks', 'MIL', 82, 82, 0.267, 830, 1919, 0.433, 0.598, 0.044, 195, 313, 0.623, 0.223, 635, 1606, 0.395]
  assert.strictEqual(csvAs('opp_shooting', { headers, rowSet: [row] }),
    'TEAM,GP,G,Freq%,FGM,FGA,FG%,eFG%,2FG Freq%,2FGM,2FGA,2FG%,3FG Freq%,3PM,3PA,3P%\n' +
    'MIL,82,82,26.7,830,1919,43.3,59.8,4.4,195,313,62.3,22.3,635,1606,39.5\n')
})
