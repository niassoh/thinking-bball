// Shot profile shift for every player with shots in the latest season:
// last 30 days vs rest of season, as raw FGA/FGM per distance band (lib/zones) ->
// data/shotshift/<slug>.json. The UI derives frequency, FG% and value.
// `shots` lists every shot as [x, y, made, recent, band]: pbpstats coordinates
// (tenths of a foot from the basket), 1/0 flags, and the index into ZONES; the
// UI draws them when a band is hovered.
// Each file also carries `league`: every shot in the season (including
// players outside the pull) per zone, the baseline the UI's value mode
// compares against.
//
// --playoffs: that season's playoff shots per player to data/playoffs/shots/<slug>.json
// ({ season, zones: {band: {fga, fgm}}, shots: [x, y, made, band] }); the profile pairs
// them with the regular season's shots for playoffs mode.
//
// Source: ESPN play-by-play (per-shot court coordinates in feet). pbpstats
// get-shots can't be used: it ignores date/game filters and caps at 500 rows.
// Finished games are cached in data/cache/espn/<season>/ (gitignored), so a
// nightly run only fetches new games. Coordinates were calibrated against
// pbpstats for the same game: x = (espnX - 25) * 10, y = espnY * 10.
const fs = require('fs')
const path = require('path')
const { fetchJson, sleep } = require('../lib/http')
const { slugify } = require('../lib/players')
const pbp = require('../lib/pbpstats')
const { ZONES, classify } = require('../lib/zones')
const { recentWindow } = require('../lib/window')
const { writeArtifact, activeSlugs } = require('../lib/artifacts')

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba'
const CACHE_DIR = path.join(__dirname, '..', 'data', 'cache', 'espn')
const PLAYOFFS = process.argv.includes('--playoffs')
const REVIEW_FILE = path.join(__dirname, '..', 'data', PLAYOFFS ? 'shotshift-po-review.json' : 'shotshift-review.json')
// ESPN's season types: 2 regular season, 3 postseason (5 play-in, left out).
const ESPN_TYPE = PLAYOFFS ? 3 : 2

const cached = async (file, fetcher) => {
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'))
  const { doc, final } = await fetcher()
  if (final) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(doc))
  }
  return doc
}

// ESPN event ids of the season type for one date (playoff dates cache separately).
const eventsOn = (season, date) =>
  cached(path.join(CACHE_DIR, season, `scoreboard-${PLAYOFFS ? 'po-' : ''}${date}.json`), async () => {
    const data = await fetchJson(`${ESPN}/scoreboard?dates=${date.replace(/-/g, '')}`)
    await sleep(150)
    const events = (data.events || []).filter(e => e.season && e.season.type === ESPN_TYPE)
    return {
      doc: events.map(e => e.id),
      final: events.length > 0 && events.every(e => e.status.type.completed)
    }
  })

// Compact shot list for one game: [athleteId, made, x, y, points] in pbpstats units.
const gameShots = (season, eventId) =>
  cached(path.join(CACHE_DIR, season, `game-${eventId}.json`), async () => {
    const data = await fetchJson(`${ESPN}/summary?event=${eventId}`)
    await sleep(150)
    const athletes = {}
    for (const team of (data.boxscore && data.boxscore.players) || []) {
      for (const group of team.statistics) for (const a of group.athletes) athletes[a.athlete.id] = a.athlete.displayName
    }
    const shots = (data.plays || [])
      .filter(p => p.shootingPlay && (p.pointsAttempted === 2 || p.pointsAttempted === 3) && p.coordinate && p.participants)
      .filter(p => p.coordinate.x >= 0 && p.coordinate.x <= 50 && p.coordinate.y >= 0 && p.coordinate.y <= 94)
      .map(p => [p.participants[0].athlete.id, p.scoringPlay ? 1 : 0, (p.coordinate.x - 25) * 10, p.coordinate.y * 10, p.pointsAttempted])
    const completed = data.header && data.header.competitions[0].status.type.completed
    return { doc: { athletes, shots }, final: !!completed }
  })

const baseSlug = s => s.replace(/-(jr|sr|ii|iii|iv)$/, '')

const main = async () => {
  const season = await pbp.latestSeasonWithGames()
  const games = await pbp.games(season, PLAYOFFS ? 'playoffs' : 'regular')
  if (!games.size) return console.log(`shotshift ${season}${PLAYOFFS ? ' playoffs' : ''}: no games yet`)
  // The playoffs are one window (every shot counts as `recent`).
  const win = PLAYOFFS ? { start: '' } : recentWindow(games)
  const dates = [...new Set([...games.values()].map(g => g.Date))].sort()

  const active = new Map(activeSlugs().map(s => [baseSlug(s), s]))
  const tallies = new Map() // slug -> zones
  const shotsBySlug = new Map() // slug -> [[x, y, made, recent, band]]
  const league = Object.fromEntries(ZONES.map(z => [z, { fga: 0, fgm: 0 }]))
  const unmatched = new Map() // ESPN name -> shots
  let gameCount = 0

  for (const date of dates) {
    const bucket = date >= win.start ? 'recent' : 'rest'
    for (const eventId of await eventsOn(season, date)) {
      const { athletes, shots } = await gameShots(season, eventId)
      gameCount++
      for (const [athleteId, made, x, y, points] of shots) {
        const zone = classify(x, y, points)
        league[zone].fga++
        league[zone].fgm += made
        const name = athletes[athleteId] || athleteId
        const slug = active.get(baseSlug(slugify(name)))
        if (!slug) {
          unmatched.set(name, (unmatched.get(name) || 0) + 1)
          continue
        }
        if (!tallies.has(slug)) tallies.set(slug, Object.fromEntries(ZONES.map(z => [z, { rest: { fga: 0, fgm: 0 }, recent: { fga: 0, fgm: 0 } }])))
        const cell = tallies.get(slug)[zone][bucket]
        cell.fga++
        cell.fgm += made
        if (!shotsBySlug.has(slug)) shotsBySlug.set(slug, [])
        shotsBySlug.get(slug).push([Math.round(x), Math.round(y), made, bucket === 'recent' ? 1 : 0, ZONES.indexOf(zone)])
      }
    }
  }

  let changed = 0
  for (const [slug, zones] of tallies) {
    const doc = PLAYOFFS
      ? { season, generatedAt: new Date().toISOString(), zones: Object.fromEntries(Object.entries(zones).map(([z, c]) => [z, c.recent])), shots: shotsBySlug.get(slug).map(([x, y, made, , band]) => [x, y, made, band]) }
      : { season, generatedAt: new Date().toISOString(), window: win, zones, league, shots: shotsBySlug.get(slug) }
    if (writeArtifact(PLAYOFFS ? 'playoffs/shots' : 'shotshift', slug, doc, { inlineNumberArrays: true })) changed++
  }
  // Players outside the season pull (low minutes) are expected here; anyone
  // with a lot of shots probably needs an alias.
  const review = [...unmatched.entries()].sort((a, b) => b[1] - a[1]).map(([name, shots]) => ({ name, shots }))
  fs.writeFileSync(REVIEW_FILE, JSON.stringify(review, null, 2) + '\n')
  console.log(`shotshift ${season}${PLAYOFFS ? ' playoffs' : ''}: ${gameCount} games, ${tallies.size} players, ${changed} files changed${PLAYOFFS ? '' : `; window ${win.start}..${win.end}`}; ${review.length} unmatched ESPN names`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
