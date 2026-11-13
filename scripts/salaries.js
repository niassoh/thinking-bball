// Each player's salary by season (data/salaries.json, { players: { <bref id>: { '2024-25':
// dollars } }, caps }), and each season's salary cap (CAPS, the league's), from two exports of a salary database: its historical table (a row per
// player-season, 1996-97 to 2024-25, by name and Basketball-Reference team code; `season` the
// year it ended) and its contracts table (each player's contract from 2025-26 on, by
// Basketball-Reference id, as of the 2025-26 rosters). Matched to data/bio.json, by bref id,
// or by name and that season's team. Run by hand when a new export comes in:
//   node scripts/salaries.js <historical.csv> <contracts.csv>
const fs = require('fs')
const path = require('path')

const DATA = path.join(__dirname, '..', 'data')

// The historical table's 2020-21 to 2023-24 are in 2024-25 dollars (its source adjusted
// them for inflation; the rest are as paid): these undo it. Each is the same for every
// player to seven digits (LeBron, Tatum, Durant, the minimums).
const INFLATED = { 2021: 1.2186914, 2022: 1.1563475, 2023: 1.0602880, 2024: 1.0297140 }
const TEAM = { BRK: 'BKN', CHO: 'CHA', PHO: 'PHX' }
// The salary cap each season, as the league set it (2026-27: pr.nba.com, June 30, 2026).
const CAPS = {
  '1996-97': 24363000, '1997-98': 26900000, '1998-99': 30000000, '1999-00': 34000000, '2000-01': 35500000,
  '2001-02': 42500000, '2002-03': 40271000, '2003-04': 43840000, '2004-05': 43870000, '2005-06': 49500000,
  '2006-07': 53135000, '2007-08': 55630000, '2008-09': 58680000, '2009-10': 57700000, '2010-11': 58044000,
  '2011-12': 58044000, '2012-13': 58044000, '2013-14': 58679000, '2014-15': 63065000, '2015-16': 70000000,
  '2016-17': 94143000, '2017-18': 99093000, '2018-19': 101869000, '2019-20': 109140000, '2020-21': 109140000,
  '2021-22': 112414000, '2022-23': 123655000, '2023-24': 136021000, '2024-25': 140588000, '2025-26': 154647000,
  '2026-27': 164961000
}

// A minimal CSV reader: quoted fields, commas inside them.
const csv = file => {
  const [head, ...rows] = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).map(line => {
    const out = []
    let cur = ''
    let q = false
    for (const ch of line) {
      if (ch === '"') q = !q
      else if (ch === ',' && !q) { out.push(cur); cur = '' } else cur += ch
    }
    return [...out, cur]
  })
  return rows.map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])))
}
const fold = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b/g, '').replace(/[^a-z]/g, '')
const seasonOf = end => `${end - 1}-${String(end).slice(2)}`

const main = ([historical, contracts]) => {
  const bio = JSON.parse(fs.readFileSync(path.join(DATA, 'bio.json'), 'utf8'))
  const byName = new Map()
  for (const [slug, b] of Object.entries(bio)) {
    const k = fold(b.sheetName || slug)
    byName.set(k, [...(byName.get(k) || []), slug])
  }
  const players = {}
  const put = (id, season, dollars) => { (players[id] = players[id] || {})[season] = dollars }
  let missed = 0
  for (const r of csv(historical)) {
    const end = Number(r.season)
    const season = seasonOf(end)
    const team = TEAM[r.team_abbr] || r.team_abbr
    // A name more than one player had: the one on that team that season.
    const there = (byName.get(fold(r.player_name)) || []).filter(slug => {
      const teams = (bio[slug].teamsBySeason || {})[season]
      return teams && (r.team_abbr === '2TM' || teams.includes(team))
    })
    // One player under several slugs (jimmy-butler, jimmy-butler-iii) is one match.
    const ids = new Set(there.map(slug => bio[slug].brefId))
    if (ids.size !== 1) { missed++; continue }
    put([...ids][0], season, Math.round(Number(r.salary) / (INFLATED[end] || 1)))
  }
  for (const r of csv(contracts)) {
    for (const [col, v] of Object.entries(r)) {
      const m = col.match(/^salary_(\d{4})_(\d{2})$/)
      if (m && v) put(r.player_id, `${m[1]}-${m[2]}`, Number(v))
    }
  }
  const sorted = Object.fromEntries(Object.keys(players).sort().map(s => [s, Object.fromEntries(Object.entries(players[s]).sort())]))
  fs.writeFileSync(path.join(DATA, 'salaries.json'), JSON.stringify({ players: sorted, caps: CAPS }) + '\n')
  console.log(`${Object.keys(sorted).length} players; ${missed} historical rows matched no player on our sheets`)
}

if (require.main === module) main(process.argv.slice(2))
