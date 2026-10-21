// Candidate search from nba.com pages (news articles, game recaps, team-site
// posts) found by web search. Team-site game galleries (scan-galleries.js) only
// carry 1024 px web copies, where faces come out ~30-110 px; articles embed the
// full-size Getty/NBAE photos (often 2048-2560 px). Articles carry no captions,
// so each Getty photo id is looked up on gettyimages.com, and photos are kept
// only when the caption names the player first (as scan-galleries.js does).
//
//   node scripts/portraits/scan-articles.js --slug aaron-gordon --name "Aaron Gordon" <page url> [<page url> ...]
//
// Appends to assets/player-sources/candidates-v2/<slug>.json (deduplicated by
// Getty id). Captions are cached in data/cache/getty/<id>.txt (gitignored).
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const OUT_DIR = path.join(ROOT, 'assets', 'player-sources', 'candidates-v2')
const CAPTIONS = path.join(ROOT, 'data', 'cache', 'getty')
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'
// Same off-target list as scan-galleries.js: moments outside the McCain band or outside a game.
const OFF_TARGET = /\b(dunk|dunks|celebrat|yell|scream|flex|hangs on the rim|warm|warms|warmup|warm-up|shootaround|practice|media day|bench|introduc|national anthem|huddle)\w*/i

const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const args = process.argv.slice(2)
const opt = name => {
  const i = args.indexOf(name)
  return i === -1 ? null : args[i + 1]
}
const urls = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'))

// Every Getty photo on the page, keeping the largest copy: WordPress adds
// -WxH resize suffixes, so the bare or "-scaled" file is the biggest.
const gettyImages = html => {
  const best = new Map()
  for (const src of new Set(html.match(/https:\/\/cdn\.nba\.com\/(?:manage|teams\/uploads)\/[^"'\\\s)]*?GettyImages[-_](\d+)[^"'\\\s)]*?\.jpe?g/gi) || [])) {
    const id = src.match(/GettyImages[-_](\d+)/i)[1]
    const resized = /-\d{2,4}x\d{2,4}\.jpe?g$/i.test(src)
    const cur = best.get(id)
    if (!cur || (cur.resized && !resized) || (!resized && /-scaled\./.test(src))) best.set(id, { id, src, resized })
  }
  return [...best.values()].filter(x => !x.resized)
}

const gettyCaption = async id => {
  const file = path.join(CAPTIONS, `${id}.txt`)
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8')
  const res = await fetch(`https://www.gettyimages.com/detail/news-photo/x/${id}`, { headers: { 'User-Agent': UA } })
  if (!res.ok) return null
  const html = await res.text()
  const caption = ((html.match(/<meta[^>]+name="description"[^>]+content="([^"]*)"/) || [])[1] || '')
    .replace(/\s*Get premium, high resolution news photos at Getty Images\s*$/, '')
    .replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"')
  fs.mkdirSync(CAPTIONS, { recursive: true })
  fs.writeFileSync(file, caption)
  return caption
}

const main = async () => {
  const slug = opt('--slug')
  const name = opt('--name')
  if (!slug || !name || !urls.length) throw new Error('usage: --slug <slug> --name "<First Last>" <page url>...')
  const words = norm(name).replace(/[^a-z\s'-]/g, '').split(/\s+/).filter(w => !/^(jr|sr|ii|iii|iv)$/.test(w))
  const first = words[0]
  const last = words[words.length - 1]

  fs.mkdirSync(OUT_DIR, { recursive: true })
  const file = path.join(OUT_DIR, `${slug}.json`)
  const doc = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { player: name, slug, galleries: [], candidates: [] }
  doc.articles = doc.articles || []

  for (const url of urls) {
    if (doc.articles.some(a => a.url === url)) continue
    const res = await fetch(url, { headers: { 'User-Agent': UA } })
    if (!res.ok) {
      console.log(`${url}: HTTP ${res.status}`)
      continue
    }
    const images = gettyImages(await res.text())
    let kept = 0
    for (const img of images) {
      if (doc.candidates.some(c => (c.gettyId && c.gettyId === img.id) || c.sourceUrl === img.src)) continue
      const caption = await gettyCaption(img.id)
      if (!caption) continue
      // The subject is the first player named in a Getty caption.
      const cap = norm(caption).replace(/^[^:]*:\s*/, '')
      if (!cap.startsWith(`${first} `) || !cap.slice(0, 80).includes(last)) continue
      doc.candidates.push({
        index: doc.candidates.length,
        sourceUrl: img.src,
        sourcePage: url,
        gettyId: img.id,
        caption,
        photographer: null,
        credit: 'Getty Images / NBAE',
        license: 'unknown',
        offTargetCaption: OFF_TARGET.test(caption)
      })
      kept++
    }
    doc.articles.push({ url, scannedAt: new Date().toISOString(), gettyPhotos: images.length })
    console.log(`${url}: ${images.length} Getty photos, ${kept} of ${name}`)
  }
  fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n')
  console.log(`${slug}: ${doc.candidates.length} candidates (${doc.candidates.filter(c => !c.offTargetCaption).length} with on-target captions)`)
}

main().catch(err => {
  console.error(err.message)
  process.exit(1)
})
