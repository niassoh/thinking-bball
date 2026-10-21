// Every NBA draft pick from NBA.com's draft history -> data/draft.json, keyed by NBA
// person id (the id bio.json carries): { year, round, pick, overall, team, org }.
// A player picked more than once (re-entered the draft) keeps their latest pick.
//
// Usage: node scripts/build-draft.js
const fs = require('fs')
const path = require('path')
const { NBA_HEADERS } = require('../lib/http')

const OUT_FILE = path.join(__dirname, '..', 'data', 'draft.json')
const URL = 'https://stats.nba.com/stats/drafthistory?LeagueID=00'

const main = async () => {
  const res = await fetch(URL, { headers: NBA_HEADERS, signal: AbortSignal.timeout(60000) })
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${URL}`)
  const { headers, rowSet } = (await res.json()).resultSets[0]
  const col = name => headers.indexOf(name)
  const picks = {}
  for (const r of rowSet) {
    const id = String(r[col('PERSON_ID')])
    const pick = {
      year: Number(r[col('SEASON')]),
      round: r[col('ROUND_NUMBER')],
      pick: r[col('ROUND_PICK')],
      overall: r[col('OVERALL_PICK')],
      team: r[col('TEAM_ABBREVIATION')],
      org: r[col('ORGANIZATION')] || null
    }
    if (!picks[id] || picks[id].year < pick.year) picks[id] = pick
  }
  fs.writeFileSync(OUT_FILE, JSON.stringify({ source: URL, generatedAt: new Date().toISOString(), picks }, null, 1) + '\n')
  console.log(`draft.json: ${Object.keys(picks).length} players from ${rowSet.length} picks`)
}

main().catch(err => {
  console.error(err.message)
  process.exit(1)
})
