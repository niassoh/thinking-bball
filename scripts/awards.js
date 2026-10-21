// data/awards.json: each player's NBA awards by Basketball-Reference id (bio.json's
// brefId), from the user-supplied files in data/sources/awards/ (no calls):
//   player_award_shares.csv   award voting by season (`winner` t): MVP, Defensive Player,
//                             Rookie, Sixth Man, Most Improved, Clutch Player
//   champions.csv             each season's champion and Finals MVP (by name, which is
//                             matched to a profile through its slug)
// and from Basketball-Reference (requests 4 s apart, the pages kept in
// data/sources/bref-awards/, so a rerun calls nothing): All-NBA and All-Defensive teams
// (/awards/all_league.html, all_defense.html), `allnba1`–`allnba3`, `alldef1`–`alldef2` by
// tier; and All-Star selections (/allstar/NBA_<year>.html, a page a game: its box score,
// injury replacements included, and its "Did not play" notes, the players selected who sat
// out). The user-supplied All-Star CSV was the game's box score alone, so it missed the
// selected who sat and whole players besides, and counted 2025's Rising Stars as All-Stars.
// Seasons are 'YYYY-YY'. `champions` is by team (the site's code where it knows the
// team); a player's titles are worked out in lib/profile.js from his teams.
//   node scripts/awards.js
const fs = require('fs')
const path = require('path')
const { writeArtifact } = require('../lib/artifacts')
const { slugify } = require('../lib/players')
const { TEAMS } = require('../lib/teams')

const SOURCES = path.join(__dirname, '..', 'data', 'sources', 'awards')
const BREF = path.join(__dirname, '..', 'data', 'sources', 'bref-awards')
const PAUSE_MS = 4000

// A Basketball-Reference page ('awards/all_league'): the kept copy, else fetched (and kept).
const brefPage = async page => {
  const file = path.join(BREF, `${path.basename(page)}.html`)
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8')
  const url = `https://www.basketball-reference.com/${page}.html`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(60000) })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  const html = await res.text()
  fs.mkdirSync(BREF, { recursive: true })
  fs.writeFileSync(file, html)
  await new Promise(resolve => setTimeout(resolve, PAUSE_MS))
  return html
}
// The NBA's teams on such a page: [{ season, tier (1-3), ids }].
const teamsOf = (html, table) => {
  const at = html.indexOf(`id="${table}"`)
  const rows = html.slice(at, html.indexOf('</table>', at)).match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || []
  return rows.map(r => ({
    season: (/data-stat="season"[^>]*>(?:<a[^>]*>)?(\d{4}-\d{2})/.exec(r) || [])[1],
    lg: (/data-stat="lg_id"[^>]*>(?:<a[^>]*>)?([A-Z]+)/.exec(r) || [])[1],
    tier: Number((/data-stat="all_team"[^>]*>(\d)/.exec(r) || [])[1]),
    ids: [...r.matchAll(/\/players\/\w\/(\w+)\.html/g)].map(m => m[1])
  })).filter(t => t.season && t.lg === 'NBA' && t.tier)
}
// An All-Star game's page: everyone in its box score and everyone its notes list as selected
// but not playing, whatever the reason ("<a>Kevin Durant</a> (Giannis): Did not play due to
// injury", "<a>Joel Embiid</a> (Team Durant): Ruled out due to COVID-19 contact tracing").
const allStarsOf = html => new Set([
  ...(html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || []).map(r => (/\/players\/\w\/(\w+)\.html/.exec(r) || [])[1]).filter(Boolean),
  ...[...html.matchAll(/\/players\/\w\/(\w+)\.html">[^<]*<\/a>\s*\([^)]*\):/g)].map(m => m[1])
])
// Profiles start in 1996-97 and their players' first selections in the 1980s; the pages
// from the merger on. No game in 1999 (the lockout).
const FIRST_ALL_STAR = 1977
const NO_ALL_STAR = [1999]
// 2025's and 2026's games were tournaments and their pages hold the final alone, so those
// seasons are the NBA's selections (nba.com/allstar/<year>/roster): those named, the ones who
// sat among them (2025: Antetokounmpo, Davis, James, Edwards; 2026: Antetokounmpo, Curry,
// Gilgeous-Alexander), the injury replacements and 2026's commissioner's pick (Leonard).
const SELECTED = {
  2025: ['donovan-mitchell', 'jalen-brunson', 'giannis-antetokounmpo', 'jayson-tatum', 'karl-anthony-towns', 'shai-gilgeous-alexander', 'stephen-curry',
    'kevin-durant', 'lebron-james', 'nikola-jokic', 'anthony-edwards', 'anthony-davis', 'james-harden', 'jaren-jackson-jr', 'alperen-sengun',
    'jalen-williams', 'victor-wembanyama', 'damian-lillard', 'darius-garland', 'jaylen-brown', 'cade-cunningham', 'tyler-herro', 'evan-mobley',
    'pascal-siakam', 'trae-young', 'kyrie-irving'],
  2026: ['cade-cunningham', 'jalen-brunson', 'tyrese-maxey', 'giannis-antetokounmpo', 'jaylen-brown', 'shai-gilgeous-alexander', 'stephen-curry',
    'luka-doncic', 'victor-wembanyama', 'nikola-jokic', 'scottie-barnes', 'jalen-duren', 'jalen-johnson', 'donovan-mitchell', 'norman-powell',
    'pascal-siakam', 'karl-anthony-towns', 'deni-avdija', 'devin-booker', 'kevin-durant', 'anthony-edwards', 'chet-holmgren', 'lebron-james',
    'jamal-murray', 'kawhi-leonard', 'alperen-sengun', 'brandon-ingram', 'de-aaron-fox']
}
const BIO = require(path.join(__dirname, '..', 'data', 'bio.json'))

// A CSV with a header row, as objects (quoted fields may hold commas).
const readCsv = file => {
  const [head, ...lines] = fs.readFileSync(path.join(SOURCES, file), 'utf8').trim().split(/\r?\n/)
  const split = line => {
    const out = []
    let cur = ''
    let quoted = false
    for (const ch of line) {
      if (ch === '"') quoted = !quoted
      else if (ch === ',' && !quoted) { out.push(cur); cur = '' } else cur += ch
    }
    out.push(cur)
    return out
  }
  const keys = split(head)
  return lines.map(l => Object.fromEntries(split(l).map((v, i) => [keys[i], v])))
}

// 2023 -> '2022-23'.
const seasonOf = endYear => `${endYear - 1}-${String(endYear).slice(2)}`
const AWARDS = { 'nba mvp': 'mvp', 'nba dpoy': 'dpoy', 'nba roy': 'roy', 'nba smoy': 'smoy', 'nba mip': 'mip', 'nba clutch_poy': 'clutch' }
// A champion's code by its nickname ("Golden State Warriors" -> GSW), for the teams the
// site knows.
const codeOf = name => (Object.entries(TEAMS).find(([, t]) => name.endsWith(` ${t.name}`)) || [null])[0]

const main = async () => {
  const players = {}
  const add = (id, award, season) => {
    const p = (players[id] = players[id] || {})
    p[award] = [...new Set([...(p[award] || []), season])].sort()
  }
  const bySlug = new Map(Object.entries(BIO).filter(([, b]) => b.brefId).map(([s, b]) => [s, b.brefId]))
  let shares = 0
  for (const r of readCsv('player_award_shares.csv')) {
    if (r.winner !== 't' || !AWARDS[r.award] || !r.player_id) continue
    add(r.player_id, AWARDS[r.award], seasonOf(Number(r.season)))
    shares++
  }
  let allstar = 0
  // The last game played: February's, so this year's from March.
  const lastGame = new Date().getFullYear() - (new Date().getMonth() < 2 ? 1 : 0)
  for (let year = FIRST_ALL_STAR; year <= lastGame; year++) {
    if (NO_ALL_STAR.includes(year)) continue
    const ids = SELECTED[year]
      ? SELECTED[year].map(slug => { if (!bySlug.get(slug)) throw new Error(`No Basketball-Reference id for ${slug}`); return bySlug.get(slug) })
      : [...allStarsOf(await brefPage(`allstar/NBA_${year}`))]
    if (!ids.length) throw new Error(`No All-Stars on the ${year} page`)
    for (const id of ids) add(id, 'allstar', seasonOf(year))
    allstar += ids.length
  }
  let teams = 0
  for (const [page, table, key] of [['all_league', 'awards_all_league', 'allnba'], ['all_defense', 'awards_all_defense', 'alldef']]) {
    for (const t of teamsOf(await brefPage(`awards/${page}`), table)) {
      for (const id of t.ids) add(id, `${key}${t.tier}`, t.season)
      teams++
    }
  }
  const champions = {}
  const unmatched = []
  for (const r of readCsv('champions.csv')) {
    const season = seasonOf(Number(r.Year))
    champions[season] = { name: r.Winner, team: codeOf(r.Winner) }
    if (!r['Finals MVP'] || r['Finals MVP'] === 'N/A') continue
    const id = bySlug.get(slugify(r['Finals MVP']))
    if (id) add(id, 'fmvp', season)
    else unmatched.push(`${season} ${r['Finals MVP']}`)
  }
  writeArtifact('', 'awards', { generatedAt: new Date().toISOString(), source: 'data/sources/awards/ (user-supplied), data/sources/bref-awards/ (Basketball-Reference)', players, champions })
  console.log(`awards: ${Object.keys(players).length} players; ${shares} award wins, ${allstar} All-Star selections, ${teams} All-NBA / All-Defensive teams, ${Object.keys(champions).length} champions`)
  console.log(`Finals MVPs with no profile (before the site's seasons): ${unmatched.join(', ')}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
