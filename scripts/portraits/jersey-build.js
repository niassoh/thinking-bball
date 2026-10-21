// Builds the jersey layers the site shows from approved jersey maps
// (scripts/portraits/jersey-key.js), painted with data/jersey-palettes.json:
//   assets/players/jersey/base/<slug>-{400,100}.webp  his portrait in his current
//     team's jersey (a player on no roster now: the team of most of his career, in its
//     era at his biggest season there): the default headshot
//     (lib/profile.js headshotOf)
//   assets/players/jersey/<slug>-{400,100}.webp  a sprite: the jersey band (from `top`
//     down) of each other jersey of his career, side by side, transparent outside the
//     jersey, to lay over the base portrait
//   assets/players/jersey/manifest.json  per player: v (content hash, for cache-busting),
//     top (where the band starts, as a share of the height), ids (sprite frame order),
//     current (the base's jersey), base (the approved portrait the map was made for),
//     shadeSource
// His career jerseys: every team of every season he played (regular season and
// playoffs), in that team's palette era for the season, oldest first.
// Guards: a map made for an earlier portrait is skipped (stale), and a composite that
// changes anything in the head (top 45%) outside the jersey fails the build.
//   node scripts/portraits/jersey-build.js [--slugs a,b]
//   node scripts/portraits/jersey-build.js --sheet <out.jpg> [--slugs a,b]
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const sharp = require('sharp')
const { buildProfile } = require('../../lib/profile')
const { eraFor, JERSEY_DIR, MANIFEST } = require('../../lib/jerseys')
const { paint, trimPosition } = require('../../lib/jersey-paint')

const ROOT = path.join(__dirname, '..', '..')
const PLAYERS = path.join(ROOT, 'assets', 'players')
const METADATA = path.join(PLAYERS, 'metadata')
const W = 1024
const SPRITE_SIZES = [400, 100]
// The sizes the site loads (scripts/export-static.js); the map rebuilds any other.
const BASE_SIZES = [[400, 85], [100, 85]]

const args = process.argv.slice(2)
const arg = name => {
  const i = args.indexOf(name)
  return i === -1 ? null : args[i + 1]
}
const readMeta = slug => JSON.parse(fs.readFileSync(path.join(METADATA, `${slug}.json`), 'utf8'))
const sha1 = buf => crypto.createHash('sha1').update(buf).digest('hex')
const approvedFile = slug => {
  const master = path.join(PLAYERS, `${slug}.png`)
  return fs.existsSync(master) ? master : path.join(PLAYERS, 'webp', `${slug}-1024.webp`)
}

// His jerseys: [{ era, seasons: [...] }] oldest first, and the current one: his current
// team's in the depth chart's season; for a player on no depth chart now (retired: a
// player who sat out last season is still on one), the team he finished the most seasons
// of his career with (bio.json's teams by season, back before the site's first season;
// minutes break a tie), in its era at his biggest season there (Jordan a Bull, not a
// Wizard; Pippen a Bull and Kemp a Sonic, though most of their seasons the site has are
// later). His latest team's jersey would follow most retired players everywhere.
const onRoster = (slug, depth) => !!depth && depth.rows.some(r => r.players.some(p => p.slug === slug))
const BIO = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'bio.json'), 'utf8'))
const mainTeam = (slug, seasons) => {
  const by = new Map()
  const of = team => by.get(team) || by.set(team, { n: 0, mp: 0, best: null, last: null }).get(team)
  const career = (BIO[slug] || {}).teamsBySeason || {}
  for (const [season, teams] of Object.entries(career)) {
    const t = of(teams[teams.length - 1])
    t.n++
    if (!t.last || season > t.last) t.last = season
  }
  for (const s of seasons) {
    const t = of(s.card ? s.card.team : s.teams[s.teams.length - 1])
    if (!Object.keys(career).length) t.n++
    t.mp += s.mp || 0
    if (!t.best || (s.mp || 0) > t.best.mp) t.best = { season: s.season, mp: s.mp || 0 }
  }
  const [team, t] = [...by].sort((a, b) => b[1].n - a[1].n || b[1].mp - a[1].mp)[0] || []
  return team ? { team, season: t.best ? t.best.season : t.last } : null
}
const career = slug => {
  const regular = buildProfile(slug)
  const playoffs = buildProfile(slug, { type: 'playoffs' })
  const byId = new Map()
  const add = (team, season) => {
    const era = eraFor(team, season)
    if (!era) return
    if (!byId.has(era.id)) byId.set(era.id, { era, seasons: [] })
    const seasons = byId.get(era.id).seasons
    if (!seasons.includes(season)) seasons.push(season)
  }
  for (const p of [regular, playoffs]) for (const s of p.seasons) for (const team of new Set([...s.teams, ...(s.card ? [s.card.team] : [])])) add(team, s.season)
  const now = (regular.depth && regular.depth.season) || (regular.seasons.length ? regular.seasons[regular.seasons.length - 1].season : null)
  const main = onRoster(slug, regular.depth) ? null : mainTeam(slug, regular.seasons)
  const current = main ? eraFor(main.team, main.season) : eraFor(regular.team, now)
  const jerseys = [...byId.values()].sort((a, b) => a.seasons.slice().sort()[0].localeCompare(b.seasons.slice().sort()[0]))
  return { jerseys, current }
}

const rgba = async file => sharp(file).resize(W, W, { fit: 'fill' }).ensureAlpha().raw().toBuffer()
const raw = (buf, w, h, channels = 4) => sharp(buf, { raw: { width: w, height: h, channels } })

// The composite's change over the head (the top 45%), outside the jersey map: a jersey
// whose straps ride high (a player looking up) changes its own pixels there, as it
// should; anything else changing means the paint reached the face.
const headChange = (a, b, map) => {
  let sum = 0
  let n = 0
  for (let p = 0; p < W * Math.floor(W * 0.45); p++) {
    if (map[3 * p + 1] || map[3 * p + 2]) continue
    for (let c = 0; c < 4; c++) sum += Math.abs(a[4 * p + c] - b[4 * p + c])
    n += 4
  }
  return n ? sum / n : 0
}

const build = async slug => {
  const meta = readMeta(slug)
  const key = meta.jerseyKey || {}
  if (!key.approvedAttempt || !key.map) return { slug, skipped: 'no approved jersey map' }
  const webp = fs.readFileSync(path.join(PLAYERS, 'webp', `${slug}-1024.webp`))
  if (key.base !== sha1(webp)) return { slug, skipped: 'stale map (the portrait changed since)' }
  const approved = await rgba(approvedFile(slug))
  const map = await sharp(path.join(ROOT, key.map)).removeAlpha().raw().toBuffer()
  const t = trimPosition(map, W, W)
  const { jerseys, current } = career(slug)
  if (!current) return { slug, skipped: 'no palette for his current team' }

  // Base: the portrait in the current jersey.
  const base = paint(approved, map, W, W, current, t)
  const change = headChange(approved, base.rgba, map)
  if (change > 0.5) throw new Error(`${slug}: the jersey reaches into the head (mean change ${change.toFixed(2)} over the top 45%)`)
  fs.mkdirSync(path.join(JERSEY_DIR, 'base'), { recursive: true })
  const outputs = []
  for (const [size, quality] of BASE_SIZES) {
    const file = path.join(JERSEY_DIR, 'base', `${slug}-${size}.webp`)
    await raw(base.rgba, W, W).resize(size, size).webp({ quality, alphaQuality: 100, smartSubsample: true }).toFile(file)
    outputs.push(file)
  }

  // The band: from the first row with any jersey, rounded down to a hundredth so it
  // starts on a whole pixel at both sprite sizes.
  let first = W
  for (let i = 0; i < W * W; i++) {
    if (map[i * 3 + 1] || map[i * 3 + 2]) {
      first = Math.floor(i / W)
      break
    }
  }
  const top = Math.floor((first / W) * 100) / 100
  const others = jerseys.filter(j => j.era.id !== current.id)
  for (const size of SPRITE_SIZES) {
    const bandH = Math.round(size * (1 - top))
    const frames = []
    for (const { era } of others) {
      const { rgba: painted, cover } = paint(approved, map, W, W, era, t)
      const overlay = Buffer.from(painted)
      for (let i = 0; i < W * W; i++) overlay[i * 4 + 3] = cover[i]
      const small = await raw(overlay, W, W).resize(size, size).raw().toBuffer()
      frames.push(await raw(small, size, size).extract({ left: 0, top: size - bandH, width: size, height: bandH }).png().toBuffer())
    }
    const file = path.join(JERSEY_DIR, `${slug}-${size}.webp`)
    if (!frames.length) {
      fs.rmSync(file, { force: true })
      continue
    }
    await sharp({ create: { width: size * frames.length, height: bandH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite(frames.map((input, k) => ({ input, left: k * size, top: 0 })))
      .webp({ quality: 85, alphaQuality: 100, smartSubsample: true })
      .toFile(file)
    outputs.push(file)
  }
  const v = sha1(Buffer.concat(outputs.map(f => fs.readFileSync(f)))).slice(0, 8)
  const bytes = Object.fromEntries(outputs.map(f => [path.relative(JERSEY_DIR, f), fs.statSync(f).size]))
  return {
    slug,
    entry: { v, top, ids: others.map(j => j.era.id), current: current.id, base: key.base, shadeSource: key.shadeSource },
    seasons: Object.fromEntries(jerseys.map(j => [j.era.id, j.seasons.sort()])),
    bytes
  }
}

const slugsToBuild = () => {
  const only = arg('--slugs') ? arg('--slugs').split(',') : null
  return fs.readdirSync(METADATA).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).filter(s => !only || only.includes(s)).sort()
}

const main = async () => {
  if (arg('--sheet')) return sheet(arg('--sheet'))
  const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : { players: {} }
  const built = []
  const skipped = []
  for (const slug of slugsToBuild()) {
    const r = await build(slug)
    if (r.skipped) {
      if (r.skipped !== 'no approved jersey map') skipped.push(`${slug}: ${r.skipped}`)
      if (r.skipped.startsWith('stale')) delete manifest.players[slug]
      continue
    }
    manifest.players[slug] = r.entry
    const kb = Object.entries(r.bytes).map(([f, b]) => `${f.replace(`${slug}-`, '').replace('.webp', '')} ${(b / 1024).toFixed(1)}KB`).join(', ')
    built.push(`${slug}: ${r.entry.current} + ${r.entry.ids.length} jerseys (${r.entry.ids.join(' ')}) · ${kb}`)
  }
  manifest.generatedAt = new Date().toISOString()
  manifest.players = Object.fromEntries(Object.entries(manifest.players).sort(([a], [b]) => a.localeCompare(b)))
  fs.mkdirSync(JERSEY_DIR, { recursive: true })
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n')
  console.log(`built ${built.length}:\n  ${built.join('\n  ')}`)
  if (skipped.length) console.log(`skipped ${skipped.length}:\n  ${skipped.join('\n  ')}`)
}

// Team sheet: per player, his portrait in each jersey of his career (current first) at
// 220px, with a 36px and a 25px circle under each, as the lineup tiles show them.
const sheet = async file => {
  const T = 220
  const rows = []
  for (const slug of slugsToBuild()) {
    const meta = readMeta(slug)
    if (!meta.jerseyKey || !meta.jerseyKey.approvedAttempt) continue
    const approved = await rgba(approvedFile(slug))
    const map = await sharp(path.join(ROOT, meta.jerseyKey.map)).removeAlpha().raw().toBuffer()
    const t = trimPosition(map, W, W)
    const { jerseys, current } = career(slug)
    const list = [{ era: current, seasons: ['now'] }, ...jerseys.filter(j => j.era.id !== current.id)]
    rows.push({ slug, cells: await Promise.all(list.map(async ({ era, seasons }) => ({ era, seasons, img: paint(approved, map, W, W, era, t).rgba }))) })
  }
  if (!rows.length) return console.log('no approved jersey maps')
  const cols = Math.max(...rows.map(r => r.cells.length))
  const cellH = T + 64
  const tiles = []
  for (const [r, row] of rows.entries()) {
    for (const [c, cell] of row.cells.entries()) {
      const left = c * T
      const top = r * cellH + 28
      tiles.push({ input: await raw(cell.img, W, W).resize(T, T).flatten({ background: '#1f1d1c' }).png().toBuffer(), left, top })
      for (const [k, d] of [36, 25].entries()) {
        const circle = Buffer.from(`<svg width="${d}" height="${d}"><circle cx="${d / 2}" cy="${d / 2}" r="${d / 2}"/></svg>`)
        const face = await raw(cell.img, W, W).resize(d, d).flatten({ background: '#34312e' }).composite([{ input: circle, blend: 'dest-in' }]).png().toBuffer()
        tiles.push({ input: face, left: left + 8 + k * 44, top: top + T + 4 })
      }
      const range = cell.seasons[0] === 'now' ? 'current' : cell.seasons.length > 1 ? `${cell.seasons[0]}…${cell.seasons[cell.seasons.length - 1].slice(-2)}` : cell.seasons[0]
      const label = `<svg width="${T - 90}" height="40"><text x="0" y="15" font-family="Helvetica" font-size="13" fill="${cell.era.check ? '#fa962a' : '#fff'}">${cell.era.id}${cell.era.check ? ' ?' : ''}</text><text x="0" y="33" font-family="Helvetica" font-size="11" fill="#999">${range}</text></svg>`
      tiles.push({ input: Buffer.from(label), left: left + 88, top: top + T + 6 })
    }
    tiles.push({ input: Buffer.from(`<svg width="${cols * T}" height="24"><text x="6" y="17" font-family="Helvetica" font-size="15" fill="#ddd">${row.slug}</text></svg>`), left: 0, top: r * cellH + 2 })
  }
  await sharp({ create: { width: cols * T, height: rows.length * cellH + 28, channels: 3, background: '#111' } }).composite(tiles).jpeg({ quality: 85 }).toFile(file)
  console.log(`sheet: ${file} (${rows.length} players; orange = palette to confirm)`)
}

main().catch(err => {
  console.error(err.message || err)
  process.exit(1)
})
