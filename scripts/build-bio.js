// Builds data/bio.json: NBA id, teams per season in order ("2 TM" labels and
// the profile's team timeline),
// height and position. Age comes from the cached sheet data, not from here.
//
// Sources, in order of precedence (each field records which one filled it):
//   1. gabriel1200/site_Data index_master.csv: NBA id, bref id, team rows per
//      season (traded seasons have a TOT row plus one row per team).
//   2. Kaggle wyattowalsh/basketball csv/common_player_info.csv: height and
//      position by NBA id. Needs KAGGLE_USERNAME / KAGGLE_KEY; skipped with a
//      warning when they are missing.
//   3. site_Data modern_index.csv: position for current players.
//   4. ESPN athlete search: height/position for active players still missing
//      (rookies Kaggle hasn't picked up yet).
// A rookie isn't in index_master until site_Data adds the season, so a player whose only
// season is the latest takes the NBA id from the lineup pull's player list (pbpstats',
// data/lineup-players.json) when exactly one name there matches.
//
// Every run rebuilds bio.json from the sources, so it is safe to run nightly.
// Players that can't be matched are written to data/bio-review.json.
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const Papa = require('papaparse')
const { slugify, loadSheet, regularSeasonKeys, seasonFromKey } = require('../lib/players')
const { fetchJson, sleep } = require('../lib/http')
const { fromBrefAbbr } = require('../lib/teams')

const DATA_DIR = path.join(__dirname, '..', 'data')
const SOURCE_DIR = path.join(DATA_DIR, 'sources')
const BIO_FILE = path.join(DATA_DIR, 'bio.json')
const REVIEW_FILE = path.join(DATA_DIR, 'bio-review.json')
const SITE_DATA = 'https://raw.githubusercontent.com/gabriel1200/site_Data/master'
const KAGGLE_FILE = 'https://www.kaggle.com/api/v1/datasets/download/wyattowalsh/basketball/csv/common_player_info.csv'
const ESPN_SEARCH = 'https://site.web.api.espn.com/apis/common/v3/search'
const ESPN_CORE = 'https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/athletes'

const FIRST_SEASON = '1996-97'
const POSITIONS = { Guard: 'G', Forward: 'F', Center: 'C', 'Guard-Forward': 'G-F', 'Forward-Guard': 'F-G', 'Forward-Center': 'F-C', 'Center-Forward': 'C-F' }

const baseSlug = name => slugify(name).replace(/-(jr|sr|ii|iii|iv)$/, '')

// Sheet names for players who changed or shortened their name since; the value
// is the name site_Data uses. Add entries here when bio-review.json flags one.
const NAME_ALIASES = {
  'enes-kanter': 'Enes Freedom',
  'juan-hernangomez': 'Juancho Hernangómez',
  'kenyon-martin-jr': 'KJ Martin',
  'ronald-holland-ii': 'Ron Holland'
}
const parseCsv = text => Papa.parse(text, { header: true, skipEmptyLines: true }).data
const seasonOfYear = year => `${year - 1}-${String(year).slice(-2)}`

const fetchText = async (url, headers = {}) => {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(120000) })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

// Raw downloads are kept in data/sources/ (gitignored) so a run can be audited.
const saveSource = (name, buf) => {
  fs.mkdirSync(SOURCE_DIR, { recursive: true })
  fs.writeFileSync(path.join(SOURCE_DIR, name), buf)
}

const loadKaggle = async () => {
  const { KAGGLE_USERNAME, KAGGLE_KEY } = process.env
  if (!KAGGLE_USERNAME || !KAGGLE_KEY) {
    console.warn('KAGGLE_USERNAME/KAGGLE_KEY not set: skipping Kaggle height/position')
    return new Map()
  }
  const auth = 'Basic ' + Buffer.from(`${KAGGLE_USERNAME}:${KAGGLE_KEY}`).toString('base64')
  let buf = await fetchText(KAGGLE_FILE, { Authorization: auth })
  // Kaggle serves single files zipped.
  if (buf.subarray(0, 2).toString() === 'PK') {
    saveSource('common_player_info.csv.zip', buf)
    buf = execFileSync('unzip', ['-p', path.join(SOURCE_DIR, 'common_player_info.csv.zip')])
  }
  saveSource('common_player_info.csv', buf)
  return new Map(parseCsv(buf.toString('utf8')).map(r => [String(r.person_id), r]))
}

const espnLookup = async name => {
  const url = `${ESPN_SEARCH}?query=${encodeURIComponent(name)}&type=player&sport=basketball&league=nba&limit=10`
  const hits = ((await fetchJson(url)).items || []).filter(i => i.league === 'nba' && baseSlug(i.displayName) === baseSlug(name))
  if (hits.length !== 1) return null
  const a = await fetchJson(`${ESPN_CORE}/${hits[0].id}`)
  return {
    height: a.displayHeight ? a.displayHeight.replace(/\s/g, '') : null,
    position: a.position ? a.position.abbreviation : null
  }
}

// Sorted keys and one player per line keep nightly git diffs readable.
const writeBio = bio => {
  const lines = Object.keys(bio).sort().map(k => `  ${JSON.stringify(k)}: ${JSON.stringify(bio[k])}`)
  fs.writeFileSync(BIO_FILE, `{\n${lines.join(',\n')}\n}\n`)
}

const main = async () => {
  const keys = regularSeasonKeys()
  const players = new Map() // slug -> { name, seasons: Set }
  const add = (name, season) => {
    const slug = slugify(name)
    if (!players.has(slug)) players.set(slug, { name, seasons: new Set() })
    players.get(slug).seasons.add(season)
  }
  for (const key of keys) {
    for (const row of loadSheet(key).rows) if (row.Player) add(row.Player, seasonFromKey(key))
  }
  // And the historical tab's seasons from the profiles' first (lib/profile.js FIRST_SEASON)
  // to the season tabs' first, which pbpstats doesn't reach.
  const firstTab = seasonFromKey(keys[0])
  for (const row of loadSheet('1historical-24').rows) {
    const season = (row['Yr / Tm'] || '').split(' ')[0]
    if (row.Player && season >= FIRST_SEASON && season < firstTab) add(row.Player, season)
  }
  const active = new Set(loadSheet(keys[keys.length - 1]).rows.map(r => slugify(r.Player)))
  const latest = seasonFromKey(keys[keys.length - 1])
  const lineupPlayers = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'lineup-players.json'), 'utf8'))
  const pulledIds = new Map() // baseSlug -> [nbaId], this season's lineup players
  for (const [nbaId, name] of lineupPlayers.season === latest ? Object.entries(lineupPlayers.players) : []) {
    pulledIds.set(baseSlug(name), [...(pulledIds.get(baseSlug(name)) || []), nbaId])
  }

  const indexCsv = await fetchText(`${SITE_DATA}/index_master.csv`)
  saveSource('index_master.csv', indexCsv)
  const modernCsv = await fetchText(`${SITE_DATA}/modern_index.csv`)
  saveSource('modern_index.csv', modernCsv)

  // baseSlug -> nbaId -> { brefId, seasons: { season: teamRows } }
  const index = new Map()
  for (const r of parseCsv(indexCsv.toString('utf8'))) {
    if (!r.nba_id || !r.player) continue
    const nbaId = String(parseInt(r.nba_id, 10))
    const slug = baseSlug(r.player)
    if (!index.has(slug)) index.set(slug, new Map())
    if (!index.get(slug).has(nbaId)) index.get(slug).set(nbaId, { brefId: r.bref_id, seasons: {} })
    const seasons = index.get(slug).get(nbaId).seasons
    const season = seasonOfYear(Number(r.year))
    if (r.team !== 'TOT') (seasons[season] = seasons[season] || []).push(fromBrefAbbr(r.team))
  }
  const modernPos = new Map(parseCsv(modernCsv.toString('utf8')).map(r => [String(parseInt(r.nba_id, 10)), r.Pos]))
  const kaggle = await loadKaggle()

  const bio = {}
  const review = []
  for (const [slug, { name, seasons }] of players) {
    const candidates = [...(index.get(baseSlug(NAME_ALIASES[slug] || name)) || new Map()).entries()]
    // Same-name players: pick the one whose seasons overlap the sheet's seasons most.
    const scored = candidates
      .map(([nbaId, c]) => [nbaId, c, [...seasons].filter(s => c.seasons[s]).length])
      .sort((a, b) => b[2] - a[2])
    const unmatched = !scored.length || scored[0][2] === 0 || (scored[1] && scored[1][2] === scored[0][2])
    const pulled = unmatched && seasons.size === 1 && seasons.has(latest) ? pulledIds.get(baseSlug(name)) || [] : []
    if (unmatched && pulled.length !== 1) {
      review.push({ slug, name, reason: scored.length ? 'ambiguous or no season overlap in index_master' : 'not in index_master' })
      continue
    }
    const [nbaId, match] = unmatched ? [pulled[0], { brefId: null, seasons: {} }] : scored[0]
    const k = kaggle.get(nbaId)
    const record = {
      sheetName: name,
      nbaId,
      brefId: match.brefId,
      teamsBySeason: match.seasons,
      height: k && k.height ? k.height.replace(/^(\d+)-(\d+)$/, `$1'$2"`) : null,
      position: k && POSITIONS[k.position] ? POSITIONS[k.position] : modernPos.get(nbaId) || null,
      sources: { ids: unmatched ? 'pbpstats' : 'site_Data', height: k && k.height ? 'kaggle' : null, position: null }
    }
    record.sources.position = k && POSITIONS[k.position] ? 'kaggle' : record.position ? 'site_Data' : null

    if (active.has(slug) && (!record.height || !record.position)) {
      try {
        const espn = await espnLookup(name)
        if (espn) {
          if (!record.height && espn.height) {
            record.height = espn.height
            record.sources.height = 'espn'
          }
          if (!record.position && espn.position) {
            record.position = espn.position
            record.sources.position = 'espn'
          }
        }
      } catch (err) {
        review.push({ slug, name, reason: `ESPN fallback failed: ${err.message}` })
      }
      await sleep(150)
    }
    if (active.has(slug) && !record.height) review.push({ slug, name, reason: 'active player without height' })
    bio[slug] = record
  }

  writeBio(bio)
  fs.writeFileSync(REVIEW_FILE, JSON.stringify(review, null, 2) + '\n')
  const count = field => Object.values(bio).filter(b => b.sources[field]).length
  console.log(`bio.json: ${Object.keys(bio).length} players (height ${count('height')}, position ${count('position')}); ${review.length} flagged in bio-review.json`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
