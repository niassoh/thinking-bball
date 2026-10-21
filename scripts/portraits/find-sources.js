// Lists candidate source photos for each portrait target from Wikimedia Commons
// (freely licensed, with license/author metadata), newest first. Writes
// assets/player-sources/candidates/<slug>.json and downloads small preview
// thumbnails to --thumbs <dir> (outside the repo) for manual scoring against
// basketball-player-portrait-reference-pack/SOURCE_SELECTION.md.
//
// Usage: node scripts/portraits/find-sources.js --thumbs /tmp/thumbs [--slug nikola-jokic]
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const TARGETS = path.join(ROOT, 'data', 'portrait-targets.json')
const OUT_DIR = path.join(ROOT, 'assets', 'player-sources', 'candidates')
const API = 'https://commons.wikimedia.org/w/api.php'
// Wikimedia asks API clients to identify themselves.
const HEADERS = { 'User-Agent': 'thinking-bball-portraits/0.1 (prottushzh@gmail.com)' }
const MIN_WIDTH = 800
const MAX_CANDIDATES = 16

const arg = name => {
  const i = process.argv.indexOf(name)
  return i === -1 ? null : process.argv[i + 1]
}

const strip = html => (html || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

const query = async generator => {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    ...generator,
    prop: 'imageinfo',
    iiprop: 'url|size|extmetadata|mime',
    iiurlwidth: '400'
  })
  const res = await fetch(`${API}?${params}`, { headers: HEADERS })
  if (!res.ok) throw new Error(`Commons HTTP ${res.status}`)
  return Object.values((await res.json()).query?.pages || {})
}

// ISO-ish date from Commons' free-text date fields ("2025-03-26 19:02", "Taken on 1 May 2021").
const isoDate = text => {
  const iso = text.match(/\d{4}-\d{2}-\d{2}/)
  if (iso) return iso[0]
  const parsed = Date.parse(text.replace(/^Taken on\s*/i, ''))
  return Number.isNaN(parsed) ? '' : new Date(parsed).toISOString().slice(0, 10)
}

// Commons file titles name everyone in frame, so a title with only this
// player's name is more likely to have a large, unobstructed face.
const soloTitle = (title, name) => {
  const rest = title.replace(/^File:/, '').replace(/\.[a-z]+$/i, '').replace(/\(.*?\)/g, '')
  return rest.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().includes(name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()) && !/ and |,| vs\.? | - /i.test(rest)
}

const search = async name => {
  const pages = [
    ...(await query({ generator: 'search', gsrsearch: `"${name}" filetype:bitmap`, gsrnamespace: '6', gsrlimit: '50' })),
    ...(await query({ generator: 'categorymembers', gcmtitle: `Category:${name}`, gcmtype: 'file', gcmlimit: '200' }))
  ]
  const seen = new Set()
  return pages
    .filter(p => p.imageinfo && !seen.has(p.title) && seen.add(p.title))
    .map(p => {
      const ii = p.imageinfo[0]
      const m = ii.extmetadata || {}
      return {
        title: p.title,
        sourcePage: ii.descriptionurl,
        sourceUrl: ii.url,
        thumbUrl: ii.thumburl,
        width: ii.width,
        height: ii.height,
        mime: ii.mime,
        date: isoDate(strip(m.DateTimeOriginal?.value) || strip(m.DateTime?.value)),
        solo: soloTitle(p.title, name),
        license: strip(m.LicenseShortName?.value) || 'unknown',
        licenseUrl: m.LicenseUrl?.value || null,
        author: strip(m.Artist?.value) || null,
        credit: strip(m.Credit?.value) || null,
        description: strip(m.ImageDescription?.value).slice(0, 200)
      }
    })
    .filter(c => c.width >= MIN_WIDTH && /jpeg|png/.test(c.mime))
    .sort((a, b) => (b.solo - a.solo) || (b.date || '').localeCompare(a.date || ''))
    .slice(0, MAX_CANDIDATES)
}

const main = async () => {
  const thumbs = arg('--thumbs')
  const only = arg('--slug')
  const { targets } = JSON.parse(fs.readFileSync(TARGETS, 'utf8'))
  fs.mkdirSync(OUT_DIR, { recursive: true })
  for (const t of targets.filter(t => !only || t.slug === only)) {
    const candidates = await search(t.name.normalize('NFC'))
    fs.writeFileSync(path.join(OUT_DIR, `${t.slug}.json`), JSON.stringify({ player: t.name, slug: t.slug, searchedAt: new Date().toISOString(), candidates }, null, 2) + '\n')
    if (thumbs) {
      fs.mkdirSync(path.join(thumbs, t.slug), { recursive: true })
      for (const [i, c] of candidates.entries()) {
        const res = await fetch(c.thumbUrl, { headers: HEADERS })
        if (res.ok) fs.writeFileSync(path.join(thumbs, t.slug, `${String(i).padStart(2, '0')}.jpg`), Buffer.from(await res.arrayBuffer()))
      }
    }
    console.log(`${t.slug}: ${candidates.length} candidates`)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
