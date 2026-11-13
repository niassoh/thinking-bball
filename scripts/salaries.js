// Each player's salary by season (data/salaries.json, { players: { <bref id>: { '2024-25':
// dollars } } }), from two exports of a salary database: its historical table (a row per
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
  fs.writeFileSync(path.join(DATA, 'salaries.json'), JSON.stringify({ players: sorted }) + '\n')
  console.log(`${Object.keys(sorted).length} players; ${missed} historical rows matched no player on our sheets`)
}

if (require.main === module) main(process.argv.slice(2))
