// The Team board: every team's season from the team sheet's Format tab (sheets-teamcat.js
// caches it as teamcat-<yy>), in the Leaderboard's shape: the stats once (`labels`, each
// one's rules in `stats`), grouped by the sheet's own Category row, and each team's values
// (`v`) and percentiles among the 30 (`p`) in that order, with the sheet's League Average
// row as `league`. A column with no value for any team (the sheet's "last month" ones) is
// left out.
const { decompress } = require('compress-json')
const { loadCache, num } = require('./players')
const { percentileOf } = require('./percentile')
const { TEAMS } = require('./teams')

// Which way a stat helps, as the sheet ranks it (sheets-teamcat.js: DRTG, Losses and a
// defense's Opp columns are better low); pace and shares of play are styles.
const lowerBetter = l => /DRTG|Losses|^Opp /.test(l)
const neutral = l => !lowerBetter(l) && /Pace|Share|^Off after|^Def after/.test(l)
const decimalsOf = values => Math.max(0, ...values.filter(v => v !== '' && v !== undefined).map(v => (String(v).split('.')[1] || '').length))
const groupId = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

// The board from the sheet's values (`sheet.values`: the header, the Category row, then a
// row a team and League Average) and its glossary.
const boardOf = (sheet, season) => {
  const [header, category, ...rows] = sheet.values
  const teams = rows.filter(r => TEAMS[r[0]])
  const leagueRow = rows.find(r => r[0] === 'League Average') || []
  // The stats: every column after Tm up to the sheet's appended perc* copies, with a value.
  const cols = header.map((h, i) => [h, i]).filter(([h, i]) => i > 0 && h && !h.startsWith('perc') && teams.some(r => num(r[i]) !== null))
  const labels = cols.map(([h]) => h)
  const stats = Object.fromEntries(cols.map(([h, i]) => [h, {
    dec: decimalsOf(teams.map(r => r[i])),
    lowerBetter: lowerBetter(h),
    neutral: neutral(h),
    desc: (sheet.glossy && sheet.glossy[h]) || null
  }]))
  const groups = []
  for (const [h, i] of cols) {
    const name = category[i] || 'Overview'
    const g = groups.find(x => x.name === name) || groups[groups.push({ id: groupId(name), name, stats: [] }) - 1]
    g.stats.push(h)
  }
  const values = teams.map(r => cols.map(([, i]) => num(r[i])))
  return {
    season,
    groups,
    labels,
    stats,
    league: Object.fromEntries(cols.map(([h, i]) => [h, num(leagueRow[i])])),
    teams: teams.map((r, t) => ({
      team: r[0],
      name: TEAMS[r[0]].name,
      v: values[t],
      p: labels.map((l, k) => percentileOf(values[t][k], values.map(v => v[k]), stats[l].lowerBetter))
    }))
  }
}

// 2013-14 on, where the bucket's play types and opponents' open shots start: past seasons
// were read from a copy of the team sheet (audit #222, #223).
const SEASONS = Array.from({ length: 14 }, (_, i) => `${2013 + i}-${String(14 + i).padStart(2, '0')}`)
const teamboard = (season = SEASONS[SEASONS.length - 1]) => {
  const raw = loadCache()[`teamcat-${season.slice(5)}`]
  return raw ? boardOf(decompress(raw), season) : null
}

module.exports = { teamboard, boardOf, SEASONS }
