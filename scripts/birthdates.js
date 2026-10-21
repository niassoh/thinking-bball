// Each player's date of birth -> data/birthdates.json ({ born: { nbaId: 'YYYY-MM-DD' } }),
// for ages the site works out on the day (the Leaderboard, the profile header).
//   1. Wikidata: one query for everyone with an NBA.com player id (P3647) and a date of
//      birth (P569), retired players too.
//   2. ESPN, for those Wikidata lacks (new players): its athlete search by bio.json's sheet
//      name, then the athlete's record. Its search has only active players. Dates found this
//      way are kept, so later runs look up only players still missing.
// Where both have a player and disagree, Wikidata's is kept and the gap is printed.
//
// Usage: node scripts/birthdates.js
const fs = require('fs')
const path = require('path')
const { slugify } = require('../lib/players')
const { fetchJson, sleep } = require('../lib/http')

const BIO_FILE = path.join(__dirname, '..', 'data', 'bio.json')
const OUT_FILE = path.join(__dirname, '..', 'data', 'birthdates.json')
const WIKIDATA = 'https://query.wikidata.org/sparql'
const QUERY = 'SELECT ?nba ?dob WHERE { ?p wdt:P3647 ?nba ; wdt:P569 ?dob . }'
const ESPN_SEARCH = 'https://site.web.api.espn.com/apis/common/v3/search'
const ESPN_CORE = 'https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/athletes'
const PAUSE_MS = 150

const wikidata = async () => {
  const url = `${WIKIDATA}?query=${encodeURIComponent(QUERY)}`
  const rows = (await fetchJson(url, { headers: { Accept: 'application/sparql-results+json', 'User-Agent': 'thinking-bball/1.0 (player ages)' } })).results.bindings
  return new Map(rows.map(r => [r.nba.value, r.dob.value.slice(0, 10)]))
}

// The NBA player of that name: ESPN's search, narrowed to the NBA and the exact name, its
// suffix too (by name alone, Gary Payton matched Gary Payton II).
const espnDate = async name => {
  const url = `${ESPN_SEARCH}?query=${encodeURIComponent(name)}&type=player&sport=basketball&league=nba&limit=10`
  const hits = ((await fetchJson(url)).items || []).filter(i => i.league === 'nba' && slugify(i.displayName) === slugify(name))
  await sleep(PAUSE_MS)
  if (hits.length !== 1) return null
  const date = (await fetchJson(`${ESPN_CORE}/${hits[0].id}`)).dateOfBirth
  await sleep(PAUSE_MS)
  return date ? date.slice(0, 10) : null
}

const main = async () => {
  const bio = JSON.parse(fs.readFileSync(BIO_FILE, 'utf8'))
  const before = fs.existsSync(OUT_FILE) ? JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')).born : {}
  const wiki = await wikidata()
  const born = {}
  const gaps = []
  const missed = []
  let espn = 0
  for (const [slug, b] of Object.entries(bio)) {
    if (!b.nbaId) continue
    const w = wiki.get(b.nbaId)
    if (w) {
      if (before[b.nbaId] && before[b.nbaId] !== w) gaps.push(`${slug} ${before[b.nbaId]} vs ${w}`)
      born[b.nbaId] = w
      continue
    }
    if (before[b.nbaId]) {
      born[b.nbaId] = before[b.nbaId]
      continue
    }
    try {
      const date = await espnDate(b.sheetName || slug)
      if (date) {
        born[b.nbaId] = date
        espn++
      } else missed.push(b.sheetName || slug)
    } catch (err) {
      missed.push(`${b.sheetName || slug} (${err.message})`)
    }
  }
  fs.writeFileSync(OUT_FILE, JSON.stringify({ source: 'Wikidata (P3647, P569), else ESPN athlete search + record', generatedAt: new Date().toISOString(), born }, null, 1) + '\n')
  console.log(`birthdates: ${Object.keys(born).length} players (${espn} new from ESPN); unmatched ${missed.length}${missed.length ? `: ${missed.join(', ')}` : ''}`)
  if (gaps.length) console.log(`Wikidata and an earlier ESPN date disagree for ${gaps.length}: ${gaps.join('; ')}`)
}

main().catch(err => {
  console.error(err.message)
  process.exit(1)
})
