// Makes the stats sheet's tracking tabs follow Instructions!A13 (the season).
//
// Before: Touches/Drives/CS3/PU3 held a fixed 2025-26 range IMPORTRANGE'd from
// another spreadsheet (PU3's was catch-and-shoot data), and the prior-season
// blocks behind every 3yr/2yr window were pasted 2024-25/2023-24 values, so
// any other season mixed in the wrong years (docs/tracking-data-audit.md §7).
// After: each source area IMPORTDATAs the season's CSV from the GCS bucket in
// Instructions!B29 (current season = LEFT(A13,4)+1, then -1 and -2), rebuilt
// into the exact column layout the existing formulas read, so none of the
// ~11,500 downstream formulas change. Also fixed while there:
//   - CS3/PU3 current season now uses 3PM/3PA, like their prior-season blocks
//     (it added all-FG makes/attempts to prior 3-point ones);
//   - PU3/WO3 prior-season lookups key on the raw name (column B), as CS3
//     does; their accent-stripped key never matched the accented CSV names;
//   - every import (WO3!A2 and Inside6!B2 too) names players as RS PBP does,
//     matched on NBA id, since NBA.com's own names drift (Jimmy Butler III).
//
//
// --playoffs does the same for the playoff stats sheet, whose tabs still read
// site_data's raw CSV layouts (name first): each tab's current-season area imports
// the season's playoff CSV (gs://thinkingbball/<yr>/playoffs/..., audit #87) in
// that layout with pbpstats' names ('PS PBP'), the prior-season imports are
// emptied so the 3yr/2yr stats cover this playoff run only (the tabs' sums skip
// a missing season), and All PS gets the tracking columns Format reads but that
// were never filled (3yr PU3/CS3/WO3, Pass:Ast, 2yr Def).
//
// Usage: node scripts/sheet-tracking-imports.js [--playoffs]            (dry run)
//        node scripts/sheet-tracking-imports.js [--playoffs] --apply
//        node scripts/sheet-tracking-imports.js [--playoffs] --revert <backup.json>
const fs = require('fs')
const path = require('path')
const { google } = require('googleapis')

const PLAYOFFS = process.argv.includes('--playoffs')
const SHEET_ID = PLAYOFFS ? '1v8vHxHLw94KgsPCZ5s4BLfYygZFRFQ0Tr4wrThZPq_g' : '10deal7utcC-C3j3w_3lJX-LjOqpEQ6l8KZBxmGT6OVE'
const BACKUP_DIR = path.join(__dirname, '..', 'data', 'sources', 'sheet-backup')
const LAST_ROW = 700

const SEASON = { cur: 'LEFT(Instructions!$A$13, 4)+1', y1: 'LEFT(Instructions!$A$13, 4)', y2: 'LEFT(Instructions!$A$13, 4)-1' }
// IMPORTDATA caches a URL's result for about an hour; bump VERSION after
// re-uploading CSVs so the sheet fetches them again.
const VERSION = PLAYOFFS ? '20261009' : '20261002'
// The playoff sheet's Instructions!B29 holds a GitHub user other tabs still read, so
// its bucket is spelled out.
const csv = (season, file) => PLAYOFFS
  ? `IMPORTDATA(CONCATENATE("https://storage.googleapis.com/thinkingbball/", ${SEASON[season]}, "/playoffs/${file}?v=${VERSION}"))`
  : `IMPORTDATA(CONCATENATE("https://", Instructions!$B$29, ${SEASON[season]}, "/${file}?v=${VERSION}"))`
const header = names => `{${names.map(n => `"${n}"`).join(', ')}}`
// Sheets has no DROP; CHOOSEROWS from row 2 skips the CSV's own header row.
const ROWS = 'd, CHOOSEROWS(raw, SEQUENCE(ROWS(raw) - 1, 1, 2))'
// All RS (All PS) matches players by name, and its names are pbpstats' ('RS PBP'!C,
// 'PS PBP'!C). NBA.com renames players (Jimmy Butler III, Bobby Portis Jr.), so each
// name is swapped for the pbpstats name with the same NBA id, keeping NBA.com's otherwise.
const PBP = PLAYOFFS ? "'PS PBP'" : "'RS PBP'"
const name = (nameCol, idCol) =>
  `nm, IFERROR(VLOOKUP(TO_TEXT(CHOOSECOLS(d, ${idCol})), {TO_TEXT(${PBP}!$A$3:$A$${LAST_ROW}), ${PBP}!$C$3:$C$${LAST_ROW}}, 2, 0), CHOOSECOLS(d, ${nameCol}))`
// Percentages are 0–100 in the CSVs and 0–1 in the NBA API layout these areas had.
const PCT = 'p, LAMBDA(c, IFERROR(CHOOSECOLS(d, c)/100, "")), blank, IF(SEQUENCE(ROWS(d)), "")'
const current = (file, names, columns, nameCol, idCol) =>
  `=ARRAYFORMULA(LET(raw, ${csv('cur', file)}, ${ROWS}, ${PCT}, ${name(nameCol, idCol)}, VSTACK(${header(names)}, HSTACK(${columns}))))`
// A CSV with its own header row, columns in `cols` order, the name column swapped.
const block = (season, file, cols, nameCol, idCol) =>
  `=IFERROR(ARRAYFORMULA(LET(raw, ${csv(season, file)}, ${ROWS}, ${name(nameCol, idCol)}, ` +
  `VSTACK(CHOOSECOLS(CHOOSEROWS(raw, 1), ${cols.join(', ')}), HSTACK(${cols.map(c => (c === nameCol ? 'nm' : `CHOOSECOLS(d, ${c})`)).join(', ')})))), "")`
const pick = (...c) => `CHOOSECOLS(d, ${c.join(', ')})`
const span = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i)

// CSV columns (site_data layouts):
// touches: Player,Team,GP,W,L,MIN,PTS,TOUCHES,Front CTTouches,Time OfPoss,Avg Sec PerTouch,...,PLAYER_ID(20),TEAM_ID(21)
// drives:  PLAYER_ID,PLAYER,TEAM,GP,W,L,MIN,DRIVES,FGM,FGA,FG%,FTM,FTA,FT%,PTS,PTS%,PASS,PASS%,AST,AST%,TO,TOV%,PF,PF%
// cs:      PLAYER,TEAM,GP,MIN,FGM,FGA,FG%,3PM,3PA,3P%,eFG%,PTS,PLAYER_ID
// pullup:  PLAYER,TEAM,GP,W,L,MIN,FGM,FGA,FG%,3PM,3PA,3P%,eFG%,PTS,PLAYER_ID,TEAM_ID
// wide_open: PLAYER_ID,PLAYER,TEAM,AGE,GP,G,FREQ%,FGM,FGA,FG%,EFG%,2FG FREQ%,2FGM,2FGA,2FG%,3FG FREQ%,3PM,3PA,3P%
// close_6: PLAYER,TEAM,AGE,POSITION,GP,G,FREQ%,DFGM,DFGA,DFG%,FG%,Diff%,PLAYER_ID
const REGULAR_SOURCES = [
  {
    cell: 'Touches!B2', clear: null,
    formula: current('player_tracking/touches.csv',
      ['PLAYER_NAME', 'TEAM_ID', 'TEAM_ABBREVIATION', 'GP', 'W', 'L', 'MIN', 'POINTS', 'TOUCHES', 'FRONT_CT_TOUCHES', 'TIME_OF_POSS', 'AVG_SEC_PER_TOUCH'],
      ['nm', pick(21, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11)].join(', '), 1, 20)
  },
  {
    cell: 'Drives!B2', clear: null,
    formula: current('player_tracking/drives.csv',
      ['PLAYER_NAME', 'TEAM_ID', 'TEAM_ABBREVIATION', 'GP', 'W', 'L', 'MIN', 'DRIVES', 'DRIVE_FGM', 'DRIVE_FGA', 'DRIVE_FG_PCT', 'DRIVE_FTM', 'DRIVE_FTA', 'DRIVE_FT_PCT',
        'DRIVE_PTS', 'DRIVE_PTS_PCT', 'DRIVE_PASSES', 'DRIVE_PASSES_PCT', 'DRIVE_AST', 'DRIVE_AST_PCT', 'DRIVE_TOV', 'DRIVE_TOV_PCT', 'DRIVE_PF', 'DRIVE_PF_PCT'],
      ['nm', 'blank', pick(3, 4, 5, 6, 7, 8, 9, 10), 'p(11)', pick(12, 13), 'p(14)', pick(15), 'p(16)', pick(17), 'p(18)', pick(19), 'p(20)', pick(21), 'p(22)', pick(23), 'p(24)'].join(', '), 2, 1)
  },
  {
    cell: "'CS3'!B2", clear: null,
    formula: current('player_tracking/cs.csv',
      ['PLAYER_NAME', 'TEAM_ID', 'TEAM_ABBREVIATION', 'GP', 'W', 'L', 'MIN', 'CATCH_SHOOT_FG3M', 'CATCH_SHOOT_FG3A', 'CATCH_SHOOT_FG3_PCT', 'CATCH_SHOOT_PTS'],
      ['nm', 'blank', pick(2, 3), 'blank', 'blank', pick(4, 8, 9), 'p(10)', pick(12)].join(', '), 1, 13)
  },
  {
    cell: "'PU3'!B2", clear: null,
    formula: current('player_tracking/pullup.csv',
      ['PLAYER_NAME', 'TEAM_ID', 'TEAM_ABBREVIATION', 'GP', 'W', 'L', 'MIN', 'PULL_UP_FG3M', 'PULL_UP_FG3A', 'PULL_UP_FG3_PCT', 'PULL_UP_PTS'],
      ['nm', pick(16, 2, 3, 4, 5, 6, 10, 11), 'p(12)', pick(14)].join(', '), 1, 15)
  },
  // Already season-based; only the name matching changes.
  { cell: "'WO3'!A2", clear: null, formula: block('cur', 'player_shooting/wide_open.csv', span(1, 19), 2, 1) },
  { cell: 'Inside6!B2', clear: null, formula: block('cur', 'player_tracking/close_6.csv', span(1, 12), 1, 13) },
  // Prior-season blocks: the layouts their fixed-index VLOOKUPs expect.
  { cell: 'Touches!AA2', clear: `Touches!AA2:AU${LAST_ROW}`, formula: block('y1', 'player_tracking/touches.csv', span(1, 21), 1, 20) },
  // cs: PLAYER,TEAM,GP,MIN,PTS,FGM,FGA,FG%,3PM,3PA,3P%,eFG%
  { cell: "'CS3'!AB2", clear: `'CS3'!AB2:AM${LAST_ROW}`, formula: block('y1', 'player_tracking/cs.csv', [1, 2, 3, 4, 12, 5, 6, 7, 8, 9, 10, 11], 1, 13) },
  { cell: "'CS3'!AO2", clear: `'CS3'!AO2:AZ${LAST_ROW}`, formula: block('y2', 'player_tracking/cs.csv', [1, 2, 3, 4, 12, 5, 6, 7, 8, 9, 10, 11], 1, 13) },
  // pullup Y-1: PLAYER,TEAM,GP,W,L,MIN,PTS,FGM,FGA,FG%,3PM,3PA,3P%,eFG%; Y-2: the CSV's own order
  { cell: "'PU3'!AE2", clear: `'PU3'!AE2:AR${LAST_ROW}`, formula: block('y1', 'player_tracking/pullup.csv', [1, 2, 3, 4, 5, 6, 14, 7, 8, 9, 10, 11, 12, 13], 1, 15) },
  { cell: "'PU3'!AU2", clear: `'PU3'!AU2:BJ${LAST_ROW}`, formula: block('y2', 'player_tracking/pullup.csv', span(1, 16), 1, 15) },
  // wide_open without PLAYER_ID
  { cell: "'WO3'!AK2", clear: `'WO3'!AK2:BB${LAST_ROW}`, formula: block('y1', 'player_shooting/wide_open.csv', span(2, 19), 2, 1) },
  { cell: "'WO3'!BD2", clear: `'WO3'!BD2:BU${LAST_ROW}`, formula: block('y2', 'player_shooting/wide_open.csv', span(2, 19), 2, 1) },
  { cell: 'Inside6!AB2', clear: `Inside6!AB2:AM${LAST_ROW}`, formula: block('y1', 'player_tracking/close_6.csv', span(1, 12), 1, 13) }
]
// Prior-season lookups keyed on the accent-stripped name column.
const REGULAR_REKEY = [
  { range: `'PU3'!R3:W${LAST_ROW}`, from: /VLOOKUP\(\$AC(\d+),/, to: 'VLOOKUP($B$1,' },
  { range: `'WO3'!Y3:AB${LAST_ROW}`, from: /VLOOKUP\(\$AH(\d+),/, to: 'VLOOKUP($B$1,' }
]

// Playoff sheet: each current-season area at B2 in the CSV's own layout minus a leading
// PLAYER_ID (and cs/close_6's trailing one, which would spill into the first formula
// column), so the tabs' fixed column references read what they always have. The
// prior-season imports (row 2 of each block; nothing else is in them) are emptied.
const PLAYOFF_SOURCES = [
  { cell: 'Touches!B2', clear: null, formula: block('cur', 'player_tracking/touches.csv', span(1, 21), 1, 20) },
  { cell: 'Drives!B2', clear: null, formula: block('cur', 'player_tracking/drives.csv', span(2, 24), 2, 1) },
  { cell: "'CS3'!B2", clear: null, formula: block('cur', 'player_tracking/cs.csv', span(1, 12), 1, 13) },
  { cell: "'PU3'!B2", clear: null, formula: block('cur', 'player_tracking/pullup.csv', span(1, 16), 1, 15) },
  { cell: "'WO3'!B2", clear: null, formula: block('cur', 'player_shooting/wide_open.csv', span(2, 19), 2, 1) },
  { cell: 'Inside6!B2', clear: null, formula: block('cur', 'player_tracking/close_6.csv', span(1, 12), 1, 13) },
  ...['Touches!Z2', "'CS3'!Z2", "'CS3'!AM2", "'PU3'!AD2", "'PU3'!AS2", "'WO3'!AD2", "'WO3'!AW2", 'Inside6!AB2'].map(cell => ({ cell, clear: cell, formula: null }))
]
// All PS: the tracking columns Format reads through Sort (CY–DD, DI–DK), as All RS has
// them, by header in each tab (All PS has formulas in rows 2–173).
const PS_ROWS = 173
const lookup = (tab, last, header) => r => `=IF($B${r}="", "", VLOOKUP($B${r}, ${tab}!$B$3:$${last}$${LAST_ROW}, MATCH(${header}, ${tab}!$B$2:$${last}$2, 0), 0))`
const PS_COLUMNS = [
  ['CY', '3yr PU3/36', lookup("'PU3'", 'AB', 'CY$1')],
  ['CZ', '3yr PU3%', lookup("'PU3'", 'AB', 'CZ$1')],
  ['DA', '3yr CS3/36', lookup("'CS3'", 'X', '"3yr Att/36"')],
  ['DB', '3yr CS3%', lookup("'CS3'", 'X', '"3yr %"')],
  ['DC', '3yr WO3/36', lookup("'WO3'", 'AB', '"3yr Att/36"')],
  ['DD', '3yr WO3%', lookup("'WO3'", 'AB', '"3yr %"')],
  ['DI', 'Pass:Ast', lookup('Drives', 'AD', 'DI$1')],
  ['DJ', '2yr DFGA / 36', lookup('Inside6', 'Y', 'DJ$1')],
  ['DK', '2yr Diff', lookup('Inside6', 'Y', 'DK$1')]
]
const PS_WRITES = PS_COLUMNS.map(([c, header, f]) => ({ range: `'All PS'!${c}1:${c}${PS_ROWS}`, values: [[header], ...span(2, PS_ROWS).map(r => [f(r)])] }))

const SOURCES = PLAYOFFS ? PLAYOFF_SOURCES : REGULAR_SOURCES
const REKEY = PLAYOFFS ? [] : REGULAR_REKEY
const EXTRA = PLAYOFFS ? PS_WRITES : []

const client = async () => {
  const auth = new google.auth.GoogleAuth({ keyFile: path.join(__dirname, '..', 'privatekey.json'), scopes: ['https://www.googleapis.com/auth/spreadsheets'] })
  return google.sheets({ version: 'v4', auth: await auth.getClient() })
}

const read = async (sheets, ranges) =>
  (await sheets.spreadsheets.values.batchGet({ spreadsheetId: SHEET_ID, ranges, valueRenderOption: 'FORMULA' })).data.valueRanges

const write = (sheets, data) =>
  sheets.spreadsheets.values.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { valueInputOption: 'USER_ENTERED', data } })

const main = async () => {
  const sheets = await client()
  const revert = process.argv.indexOf('--revert')
  if (revert > 0) {
    const backup = JSON.parse(fs.readFileSync(process.argv[revert + 1], 'utf8'))
    await sheets.spreadsheets.values.batchClear({ spreadsheetId: SHEET_ID, requestBody: { ranges: backup.map(b => b.range) } })
    await write(sheets, backup.filter(b => b.values).map(b => ({ range: b.range, values: b.values })))
    return console.log(`restored ${backup.length} ranges`)
  }

  const [window] = await read(sheets, ['Instructions!E13:F13'])
  if ((window.values || []).flat().some(Boolean)) throw new Error('A recent-shift window is set in Instructions!E13:F13; clear it first')

  const rekeyed = (REKEY.length ? await read(sheets, REKEY.map(r => r.range)) : []).map((vr, i) => {
    const { from, to } = REKEY[i]
    const values = (vr.values || []).map(row => row.map(c => (typeof c === 'string' ? c.replace(from, (m, r) => to.replace('$1', r)) : c)))
    return { range: REKEY[i].range, values, changed: values.flat().filter((c, j) => c !== (vr.values.flat()[j])).length }
  })
  for (const s of SOURCES) console.log(`${s.cell}${s.clear ? ` (clears ${s.clear})` : ''}${s.formula ? `\n  ${s.formula}` : ''}`)
  for (const r of rekeyed) console.log(`${r.range}: ${r.changed} lookups rekeyed to column B`)
  for (const w of EXTRA) console.log(`${w.range}: "${w.values[0][0]}", then ${w.values[1][0]} …`)
  if (!process.argv.includes('--apply')) return console.log('dry run; rerun with --apply')

  const backupRanges = [...SOURCES.map(s => s.clear || s.cell), ...REKEY.map(r => r.range), ...EXTRA.map(w => w.range)]
  const backup = (await read(sheets, backupRanges)).map((vr, i) => ({ range: backupRanges[i], values: vr.values || null }))
  fs.mkdirSync(BACKUP_DIR, { recursive: true })
  const file = path.join(BACKUP_DIR, `${PLAYOFFS ? 'playoff-' : ''}tracking-imports-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(file, JSON.stringify(backup))
  console.log(`backup: ${path.relative(process.cwd(), file)}`)

  await sheets.spreadsheets.values.batchClear({ spreadsheetId: SHEET_ID, requestBody: { ranges: SOURCES.filter(s => s.clear).map(s => s.clear) } })
  await write(sheets, [...SOURCES.filter(s => s.formula).map(s => ({ range: s.cell, values: [[s.formula]] })), ...rekeyed.map(r => ({ range: r.range, values: r.values })), ...EXTRA])
  console.log(`applied; revert with: node scripts/sheet-tracking-imports.js${PLAYOFFS ? ' --playoffs' : ''} --revert ${path.relative(process.cwd(), file)}`)
}

main().catch(err => {
  console.error(err.message)
  process.exit(1)
})
