// Records the chosen source photo for a player and downloads it, so the
// generation step always starts from the same real photo.
//
//   node scripts/portraits/select-source.js --slug nikola-jokic --candidate 1 \
//     --scores 3,3,2,2,2,1,0 --rejected 4:11,6:12 [--crop x,y,size] [--notes "..."]
//   node scripts/portraits/select-source.js --slug chet-holmgren --url <image url> \
//     --page <page url> --license "..." --author "..." --scores ... [--needs-review "why"]
//
// Round 2 (SOURCE_RULES.md) adds: --energy <1-10, McCain=7> --vs-mccain "<how>"
//   --jersey "<team + season>" --concerns "<text>" --alt "<url> (<why>)" (repeatable)
//   --supersede "<reason>"  moves the previous pick into rejectedCandidates with that reason.
//
// --candidate indexes assets/player-sources/candidates/<slug>.json (from
// find-sources.js). --scores follows SOURCE_SELECTION.md: clarity, size,
// expression, occlusion, angle, recency, jersey. --crop is a square
// head-and-shoulders box in the saved image's pixels; generate.js applies it
// before sending the photo to the model.
const fs = require('fs')
const path = require('path')
const sharp = require('sharp')

const ROOT = path.join(__dirname, '..', '..')
const CANDIDATES = path.join(ROOT, 'assets', 'player-sources', 'candidates')
const SOURCES = path.join(ROOT, 'assets', 'player-sources')
const METADATA = path.join(ROOT, 'assets', 'players', 'metadata')
const TARGETS = path.join(ROOT, 'data', 'portrait-targets.json')
const API = 'https://commons.wikimedia.org/w/api.php'
const HEADERS = { 'User-Agent': 'thinking-bball-portraits/0.1 (prottushzh@gmail.com)' }
// cdn.nba.com rejects non-browser clients.
const BROWSER_HEADERS = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36' }
// Commons originals run up to 17,000 px; 3,000 px on the long edge keeps the
// face large enough to crop while keeping the repo small.
const MAX_EDGE = 3000
const CRITERIA = [['faceClarity', 3], ['faceSize', 3], ['expression', 3], ['minimalOcclusion', 2], ['headAngle', 2], ['recentAppearance', 2], ['currentJersey', 1]]

const arg = name => {
  const i = process.argv.indexOf(name)
  return i === -1 ? null : process.argv[i + 1]
}
const all = name => process.argv.flatMap((a, i) => (a === name ? [process.argv[i + 1]] : []))

const parseScores = text => {
  const vals = text.split(',').map(Number)
  if (vals.length !== CRITERIA.length || vals.some((v, i) => !(v >= 0 && v <= CRITERIA[i][1]))) {
    throw new Error(`--scores needs ${CRITERIA.length} values within ${CRITERIA.map(c => c[1]).join(',')}`)
  }
  const breakdown = Object.fromEntries(CRITERIA.map(([k], i) => [k, vals[i]]))
  return { total: vals.reduce((a, b) => a + b, 0), breakdown }
}

// Commons serves resized renditions on request; ask for one within MAX_EDGE.
const commonsRendition = async (title, width, height) => {
  if (Math.max(width, height) <= MAX_EDGE) return null
  const w = width >= height ? MAX_EDGE : Math.round((MAX_EDGE * width) / height)
  const params = new URLSearchParams({ action: 'query', format: 'json', titles: title, prop: 'imageinfo', iiprop: 'url', iiurlwidth: String(w) })
  const res = await fetch(`${API}?${params}`, { headers: HEADERS })
  const page = Object.values((await res.json()).query.pages)[0]
  return page.imageinfo[0].thumburl
}

const main = async () => {
  const slug = arg('--slug')
  if (!slug) throw new Error('--slug is required')
  const target = JSON.parse(fs.readFileSync(TARGETS, 'utf8')).targets.find(t => t.slug === slug)
  if (!target) throw new Error(`${slug} is not in data/portrait-targets.json`)
  const scores = parseScores(arg('--scores') || '')

  let source
  let rejected = []
  if (arg('--candidate') !== null) {
    const { candidates } = JSON.parse(fs.readFileSync(path.join(CANDIDATES, `${slug}.json`), 'utf8'))
    const c = candidates[Number(arg('--candidate'))]
    const rendition = await commonsRendition(c.title, c.width, c.height)
    source = {
      sourceUrl: c.sourceUrl,
      downloadUrl: rendition || c.sourceUrl,
      sourcePage: c.sourcePage,
      license: c.license,
      licenseUrl: c.licenseUrl,
      author: c.author,
      credit: c.credit,
      photoDate: c.date || null,
      originalSize: [c.width, c.height]
    }
    const scored = Object.fromEntries((arg('--rejected') || '').split(',').filter(Boolean).map(s => s.split(':').map(Number)))
    rejected = candidates
      .map((r, i) => ({ index: i, title: r.title, sourcePage: r.sourcePage, license: r.license, score: scored[i] ?? null }))
      .filter(r => r.index !== Number(arg('--candidate')))
  } else {
    source = {
      sourceUrl: arg('--url'),
      downloadUrl: arg('--url'),
      sourcePage: arg('--page'),
      license: arg('--license') || 'unknown',
      licenseUrl: null,
      author: arg('--author'),
      credit: null,
      photoDate: arg('--date'),
      originalSize: null
    }
    if (!source.sourceUrl) throw new Error('--candidate or --url is required')
  }

  const isCommons = /wikimedia\.org/.test(source.downloadUrl)
  const res = await fetch(source.downloadUrl, { headers: isCommons ? HEADERS : BROWSER_HEADERS })
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${source.downloadUrl}`)
  // Commons only serves fixed thumbnail widths, so normalize here: apply EXIF
  // rotation, fit within MAX_EDGE, and flatten transparency (NBA CDN PNGs).
  const { data, info } = await sharp(Buffer.from(await res.arrayBuffer()))
    .rotate()
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#808080' })
    .jpeg({ quality: 92 })
    .toBuffer({ resolveWithObject: true })
  const sourceFile = `assets/player-sources/${slug}.jpg`
  fs.mkdirSync(SOURCES, { recursive: true })
  for (const old of ['jpg', 'png']) fs.rmSync(path.join(SOURCES, `${slug}.${old}`), { force: true })
  fs.writeFileSync(path.join(ROOT, sourceFile), data)
  source.storedSize = [info.width, info.height]
  source.processing = `EXIF-rotated, fit within ${MAX_EDGE}px, flattened on #808080, JPEG q92`

  const metaFile = path.join(METADATA, `${slug}.json`)
  const previous = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : {}
  // A new source photo invalidates the old crop box.
  const sameSource = previous.sourceUrl === source.sourceUrl
  const crop = arg('--crop') ? arg('--crop').split(',').map(Number) : sameSource && previous.crop ? [previous.crop.x, previous.crop.y, previous.crop.size] : null
  if (arg('--supersede') && previous.sourceUrl && !sameSource) {
    rejected = [
      ...(previous.rejectedCandidates || []),
      { sourceUrl: previous.sourceUrl, sourcePage: previous.sourcePage, license: previous.license, score: previous.sourceSelectionScore ?? null, reason: arg('--supersede'), previousPick: true }
    ]
  } else if (sameSource && !rejected.length) {
    rejected = previous.rejectedCandidates || []
  }
  rejected = [...rejected, ...all('--alt').map(a => ({ sourceUrl: a.split(' ')[0], note: a.slice(a.indexOf(' ') + 1), license: 'unknown', round: 2 }))]
  // Generation state belongs to the source photo it was made from. On an
  // unchanged source every other field (QA notes, rounds, webp list…) is kept.
  // On a new source the whole previous generation state moves into
  // supersededHistory, but an approved portrait stays live (approved,
  // masterFile, webp) until a new attempt is finalized, so there is always a
  // fallback.
  const GENERATION_FIELDS = ['promptVersion', 'generationAttempt', 'attempts', 'round', 'previousRounds', 'cancelledRounds', 'rejectedApiCalls', 'qaSummary', 'bestRejectedAttempt']
  const previousGeneration = Object.fromEntries(GENERATION_FIELDS.filter(k => previous[k] !== undefined).map(k => [k, previous[k]]))
  const meta = {
    ...(sameSource ? previous : {}),
    player: target.name,
    playerId: slug,
    ...source,
    sourceFile,
    selectedAt: new Date().toISOString(),
    sourceSelectionScore: scores.total,
    sourceSelectionBreakdown: scores.breakdown,
    crop: crop && { x: crop[0], y: crop[1], size: crop[2] },
    needsReview: arg('--needs-review') || null,
    notes: arg('--notes') || null,
    selectionRules: arg('--energy') ? 'SOURCE_SELECTION.md + scripts/portraits/SOURCE_RULES.md' : 'SOURCE_SELECTION.md',
    energy: arg('--energy') ? Number(arg('--energy')) : null,
    energyVsMcCain: arg('--vs-mccain') || null,
    jersey: arg('--jersey') || null,
    concerns: arg('--concerns') || null,
    rejectedCandidates: rejected,
    promptVersion: sameSource ? previous.promptVersion || null : null,
    generationAttempt: sameSource ? previous.generationAttempt || 0 : 0,
    attempts: sameSource ? previous.attempts || [] : [],
    // Keep the live portrait as the fallback until a new attempt is finalized.
    masterFile: previous.masterFile || null,
    webp: previous.webp || [],
    approved: previous.approved || false,
    approvedFromSource: sameSource ? previous.approvedFromSource || previous.sourceUrl : previous.approvedFromSource || previous.sourceUrl || null,
    supersededHistory: [
      ...(previous.supersededHistory || []),
      ...(!sameSource && previous.sourceUrl ? [{ sourceUrl: previous.sourceUrl, sourcePage: previous.sourcePage, sourceFile: previous.sourceFile, crop: previous.crop, ...previousGeneration, approved: previous.approved || false, masterFile: previous.masterFile || null, supersededReason: arg('--supersede') || null, supersededFiles: previous.supersededFiles || [] }] : [])
    ]
  }
  if (!sameSource) for (const k of ['round', 'previousRounds', 'cancelledRounds', 'rejectedApiCalls', 'qaSummary', 'bestRejectedAttempt']) delete meta[k]
  fs.mkdirSync(METADATA, { recursive: true })
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2) + '\n')
  console.log(`${slug}: ${sourceFile} (${source.license}, score ${scores.total}/16)`)
}

main().catch(err => {
  console.error(err.message)
  process.exit(1)
})
