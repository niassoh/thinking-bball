// Writes the profile site's API as static files, for hosting without a server
// (GitHub Pages; see docs/daily-pipeline-requirements.md):
//   <out>/api/profiles.json, teams.json
//   <out>/api/lineups-league-<season>.json  each season's lineup pool (the lineup pull's
//                                      and the history's: profiles show past seasons)
//   <out>/api/profile/<slug>.json      every player, plus old slug spellings
//   <out>/api/leaderboard/{index,<season>}.json  the Leaderboard page's seasons, and each one
//   <out>/api/teamboard/<season>.json  the Team board: every team's season (lib/teamboard.js)
//   <out>/api/teamunits/<season>.json  each team's most-played and best units (the team card)
//   <out>/api/playoffs/leaderboard/delta/<season>.json  playoffs minus regular season
//   <out>/api/footprint/<slug>.json    the Footprint tab's views, for a player who has them
//   <out>/api/lonestar/<slug>.json     the Lonestar tab's views, for a player who has them
//   <out>/api/shots/<slug>.json        his every regular-season shot by season, packed, for the
//                                      bio card's career view (lib/profile.js shotDotsOf)
//   <out>/api/distribution/<key>.json  each stat with data (key = statKey(label))
//   <out>/api/playoffs/{profile/<slug>.json, distribution/<key>.json, lineups-league-<season>.json, leaderboard/}
//                                      the same for playoffs mode (lib/profile.js types)
//   <out>/assets/players/{webp,nba,jersey/base}/<slug>-{100,400}.webp  the headshot sizes
//                                      the site uses (jersey/base: in his current jersey)
//   <out>/assets/players/cast/<nbaId>-{100,400}.webp  faces of teammates with no profile
//   <out>/assets/players/jersey/<slug>-{100,400}.webp  his other jerseys' sprites
// The JSON is the same document the Express routes in index.js return. <out>/api
// and <out>/assets/players are cleared first, so dropped players don't linger.
// Usage: npm run export:static -- --out ../thinking-bball-profile/public
const fs = require('fs')
const path = require('path')
const { teamboard, SEASONS: TEAMBOARD_SEASONS } = require('../lib/teamboard')
const { teamUnitsDoc, buildProfile, shotDotsOf, footprintDoc, lonestarDoc, leaderboard, leaderboardDelta, leaderboardRecent, leaderboardSeasons, playerIndex, teamList, distribution, lineupLeague, lineupSeasons, aliasSlugs } = require('../lib/profile')
const { ALL_STATS, statKey } = require('../lib/stats')

const ASSETS = path.join(__dirname, '..', 'assets', 'players')
const HEADSHOT_DIRS = ['webp', 'nba', 'cast', 'jersey/base', 'jersey']
const SIZES = [100, 400]

const exportStatic = out => {
  const api = path.join(out, 'api')
  const players = path.join(out, 'assets', 'players')
  fs.rmSync(api, { recursive: true, force: true })
  fs.rmSync(players, { recursive: true, force: true })
  fs.mkdirSync(api, { recursive: true })
  let bytes = 0
  const write = (file, doc) => {
    const text = JSON.stringify(doc)
    fs.writeFileSync(path.join(api, file), text)
    bytes += text.length
  }

  const index = playerIndex()
  write('profiles.json', index)
  write('teams.json', teamList())
  fs.mkdirSync(path.join(api, 'teamboard'), { recursive: true })
  fs.mkdirSync(path.join(api, 'teamunits'), { recursive: true })
  for (const season of TEAMBOARD_SEASONS) {
    const board = teamboard(season)
    if (board) write(`teamboard/${season}.json`, board)
    const units = teamUnitsDoc(season)
    if (units) write(`teamunits/${season}.json`, units)
  }

  const keys = new Map()
  for (const { label } of ALL_STATS) {
    const key = statKey(label)
    if (keys.has(key)) throw new Error(`stat key ${key} for both ${keys.get(key)} and ${label}`)
    keys.set(key, label)
  }
  const profiles = {}
  const distributions = {}
  for (const type of ['regular', 'playoffs']) {
    const pre = type === 'playoffs' ? 'playoffs/' : ''
    fs.mkdirSync(path.join(api, pre, 'profile'), { recursive: true })
    fs.mkdirSync(path.join(api, pre, 'distribution'), { recursive: true })
    fs.mkdirSync(path.join(api, pre, 'leaderboard'), { recursive: true })
    fs.mkdirSync(path.join(api, 'footprint'), { recursive: true })
    fs.mkdirSync(path.join(api, 'lonestar'), { recursive: true })
    fs.mkdirSync(path.join(api, 'shots'), { recursive: true })
    const boards = leaderboardSeasons(type)
    write(`${pre}leaderboard/index.json`, { seasons: boards })
    for (const season of boards) write(`${pre}leaderboard/${season}.json`, leaderboard(season, { type }))
    const recent = type === 'regular' && leaderboardRecent()
    if (recent) write('leaderboard/recent.json', recent)
    if (type === 'playoffs') {
      fs.mkdirSync(path.join(api, pre, 'leaderboard', 'delta'), { recursive: true })
      for (const season of boards) {
        const doc = leaderboardDelta(season)
        if (doc) write(`${pre}leaderboard/delta/${season}.json`, doc)
      }
    }
    for (const season of lineupSeasons(type)) {
      const pool = lineupLeague(type, season)
      if (pool) write(`${pre}lineups-league-${season}.json`, pool)
    }
    profiles[type] = 0
    for (const slug of [...index.map(p => p.slug), ...aliasSlugs()]) {
      const doc = buildProfile(slug, { type })
      if (!doc) continue
      write(`${pre}profile/${slug}.json`, doc)
      profiles[type]++
      if (type === 'regular' && doc.footprint) write(`footprint/${slug}.json`, footprintDoc(slug))
      if (type === 'regular' && doc.lonestar) write(`lonestar/${slug}.json`, lonestarDoc(slug))
      const dots = type === 'regular' && shotDotsOf(slug)
      if (dots) write(`shots/${slug}.json`, dots)
    }
    for (const [key, label] of keys) {
      const doc = distribution(label, { type })
      if (doc) write(`${pre}distribution/${key}.json`, doc)
    }
    distributions[type] = fs.readdirSync(path.join(api, pre, 'distribution')).length
  }

  let images = 0
  for (const dir of HEADSHOT_DIRS) {
    if (!fs.existsSync(path.join(ASSETS, dir))) continue
    fs.mkdirSync(path.join(players, dir), { recursive: true })
    for (const file of fs.readdirSync(path.join(ASSETS, dir))) {
      if (!SIZES.some(size => file.endsWith(`-${size}.webp`))) continue
      fs.copyFileSync(path.join(ASSETS, dir, file), path.join(players, dir, file))
      bytes += fs.statSync(path.join(players, dir, file)).size
      images++
    }
  }
  return { profiles, distributions, images, bytes }
}

if (require.main === module) {
  const at = process.argv.indexOf('--out')
  if (at === -1 || !process.argv[at + 1]) {
    console.error('usage: node scripts/export-static.js --out <dir>')
    process.exit(1)
  }
  const out = path.resolve(process.argv[at + 1])
  const r = exportStatic(out)
  console.log(`export-static -> ${out}: ${r.profiles.regular} + ${r.profiles.playoffs} playoff profiles, ${r.distributions.regular} + ${r.distributions.playoffs} playoff distributions, ${r.images} images, ${(r.bytes / 1e6).toFixed(1)} MB`)
}

module.exports = { exportStatic }
