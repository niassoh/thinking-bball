// Fallback headshots for players without an illustrated portrait: NBA.com's official
// headshot, cropped to the portraits' square head-and-shoulders frame and styled toward
// them (warm grade, light posterize), written as assets/players/nba/<slug>-{100,400}.webp.
// The API serves a portrait when one exists and this otherwise (lib/profile.js).
//
// Downloads are cached in data/cache/nba-headshots/<nbaId>.png, so restyling doesn't
// refetch. NBA.com answers an id without a photo with a generic silhouette (HTTP 200);
// those players are skipped and keep their team-initials tile. Fallbacks for players
// who have since got a portrait are deleted.
//
// --cast: instead, the faces of teammates with no profile that the Footprint (LONE
// anchors) and Lonestar (stars) name, mostly from before 2013-14, as
// assets/players/cast/<nbaId>-{100,400}.webp (by NBA id: a name can be a current
// player's too).
//
// Usage: node scripts/portraits/nba-fallback.js [--force] [--slug <slug>] [--cast]
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const sharp = require('sharp')
const { playerIndex, footprintOf, lonestarDoc } = require('../../lib/profile')

const ROOT = path.join(__dirname, '..', '..')
const CAST = process.argv.includes('--cast')
const OUT = path.join(ROOT, 'assets', 'players', CAST ? 'cast' : 'nba')
const PORTRAITS = path.join(ROOT, 'assets', 'players', 'webp')
const CACHE = path.join(ROOT, 'data', 'cache', 'nba-headshots')
const BIO = require(path.join(ROOT, 'data', 'bio.json'))
const URL = id => `https://cdn.nba.com/headshots/nba/latest/1040x760/${id}.png`
// An id no player has; NBA.com returns its silhouette for it.
const NO_SUCH_ID = 999999999
const SIZES = [100, 400]
// Posterizing happens on the page's charcoal so edge pixels quantize toward it.
const BG = { r: 24, g: 24, b: 26 }

const args = process.argv.slice(2)
const force = args.includes('--force')
const only = args.includes('--slug') ? args[args.indexOf('--slug') + 1] : null

const sha1 = buf => crypto.createHash('sha1').update(buf).digest('hex')

const download = async id => {
  const file = path.join(CACHE, `${id}.png`)
  if (fs.existsSync(file)) return fs.readFileSync(file)
  const res = await fetch(URL(id), { signal: AbortSignal.timeout(30000) })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${URL(id)}`)
  const buf = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(file, buf)
  return buf
}

// 1040x760 source: a 660px square from the top centre holds the head and shoulders at
// about the portraits' scale.
const style = async png => {
  const base = await sharp(png).extract({ left: 190, top: 0, width: 660, height: 660 }).resize(400, 400).png().toBuffer()
  const graded = await sharp(base).modulate({ saturation: 0.9 }).linear([1.06, 1.0, 0.92], [-10, -8, -6]).png().toBuffer()
  const alpha = await sharp(graded).extractChannel(3).toBuffer()
  const flat = await sharp(graded).flatten({ background: BG }).median(3).png({ palette: true, colours: 28, dither: 0 }).toBuffer()
  const rgb = await sharp(flat).removeAlpha().toColourspace('srgb').raw().toBuffer()
  return sharp(rgb, { raw: { width: 400, height: 400, channels: 3 } }).joinChannel(alpha).png().toBuffer()
}

// The teammates with no profile whom some profile's Footprint or Lonestar shows:
// [{ slug: nbaId (the file's name), id }].
const castOf = () => {
  const ids = new Set()
  for (const p of playerIndex()) {
    const fp = footprintOf(p.slug)
    for (const v of (fp && fp.views) || []) for (const o of [...v.remove.off, ...v.remove.def]) for (const t of [...o.stars, ...(o.parts || []).flatMap(part => part.stars)]) if (t.face) ids.add(t.face.key)
    const ls = lonestarDoc(p.slug)
    for (const v of (ls && ls.views) || []) for (const s of v.scenarios) for (const t of s.stars) if (t.face) ids.add(t.face)
  }
  return [...ids].sort().map(id => ({ slug: id, id }))
}

const main = async () => {
  fs.mkdirSync(OUT, { recursive: true })
  fs.mkdirSync(CACHE, { recursive: true })
  const hasPortrait = slug => fs.existsSync(path.join(PORTRAITS, `${slug}-100.webp`))

  // Pruned: a fallback whose player has since got a portrait; a cast face whose player
  // has since got a profile (or is no longer shown).
  let pruned = 0
  const cast = CAST ? castOf() : null
  const castIds = cast && new Set(cast.map(p => p.id))
  for (const f of fs.readdirSync(OUT)) {
    const slug = f.replace(/-\d+\.webp$/, '')
    if (CAST ? !castIds.has(slug) : hasPortrait(slug)) { fs.unlinkSync(path.join(OUT, f)); pruned++ }
  }

  const silhouette = sha1(Buffer.from(await (await fetch(URL(NO_SUCH_ID), { signal: AbortSignal.timeout(30000) })).arrayBuffer()))
  const todo = (CAST ? cast : playerIndex().filter(p => !hasPortrait(p.slug) && (!only || p.slug === only)))
    .filter(p => force || !fs.existsSync(path.join(OUT, `${p.slug}-400.webp`)))
  const result = { written: [], noPhoto: [], noId: [], failed: [] }
  const queue = [...todo]
  const worker = async () => {
    for (let p; (p = queue.shift());) {
      const id = p.id || (BIO[p.slug] || {}).nbaId
      if (!id) { result.noId.push(p.slug); continue }
      try {
        const png = await download(id)
        if (sha1(png) === silhouette) { result.noPhoto.push(p.slug); continue }
        const styled = await style(png)
        for (const size of SIZES) await sharp(styled).resize(size, size).webp({ quality: 86, alphaQuality: 90 }).toFile(path.join(OUT, `${p.slug}-${size}.webp`))
        result.written.push(p.slug)
      } catch (err) {
        result.failed.push(`${p.slug} (${err.message})`)
      }
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker))

  console.log(`fallbacks written: ${result.written.length}, no NBA.com photo: ${result.noPhoto.length}, no NBA id: ${result.noId.length}, failed: ${result.failed.length}, pruned: ${pruned} files`)
  if (result.failed.length) console.log(`failed: ${result.failed.join(', ')}`)
  if (result.noPhoto.length) console.log(`no photo: ${result.noPhoto.join(', ')}`)
}

main().catch(err => {
  console.error(err.message)
  process.exit(1)
})
