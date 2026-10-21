// Round-2 candidate search (see SOURCE_RULES.md): official team-site game
// galleries on nba.com. Each gallery page embeds its photos with Getty/NBAE
// captions (player, action, photographer), so we keep the photos whose caption
// names the player. Gallery URLs are found by searching in Chrome and passed
// in here, so the scan itself is reproducible.
//
//   node scripts/portraits/scan-galleries.js --slug nikola-jokic --name "Nikola Jokic" \
//     --thumbs /tmp/thumbs <gallery url> [<gallery url> ...]
//
// Appends to assets/player-sources/candidates-v2/<slug>.json (deduplicated by URL).
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const OUT_DIR = path.join(ROOT, 'assets', 'player-sources', 'candidates-v2')
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'
// Captions that describe moments outside the McCain energy band (6–8/10) or
// outside a game. They're kept but marked, so rejections are visible.
const OFF_TARGET = /\b(dunk|dunks|celebrat|yell|scream|flex|hangs on the rim|warm|warms|warmup|warm-up|shootaround|practice|media day|bench|introduc|national anthem|huddle)\w*/i

const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const args = process.argv.slice(2)
const opt = name => {
  const i = args.indexOf(name)
  return i === -1 ? null : args[i + 1]
}
const urls = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'))

const galleryImages = html => {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)
  if (!m) return []
  const page = JSON.parse(m[1]).props.pageProps.pageObject || {}
  const found = new Map()
  const walk = node => {
    if (!node || typeof node !== 'object') return
    if (typeof node.src === 'string' && /cdn\.nba\.com\/teams\/uploads/.test(node.src) && node.caption) {
      if (!found.has(node.src)) found.set(node.src, { src: node.src, caption: node.caption.replace(/\s+/g, ' ').trim(), size: node.size || null })
    }
    for (const v of Object.values(node)) walk(v)
  }
  walk(page)
  return { title: page.title || null, date: page.date || null, images: [...found.values()] }
}

const main = async () => {
  const slug = opt('--slug')
  const name = opt('--name')
  const thumbs = opt('--thumbs')
  if (!slug || !name || !urls.length) throw new Error('usage: --slug <slug> --name "<First Last>" [--thumbs dir] <gallery url>...')
  const last = norm(name).split(' ').slice(-1)[0]
  const first = norm(name).split(' ')[0]

  fs.mkdirSync(OUT_DIR, { recursive: true })
  const file = path.join(OUT_DIR, `${slug}.json`)
  const doc = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { player: name, slug, galleries: [], candidates: [] }

  for (const url of urls) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } })
    if (!res.ok) {
      console.log(`${url}: HTTP ${res.status}`)
      continue
    }
    const { title, date, images } = galleryImages(await res.text())
    if (!doc.galleries.some(g => g.url === url)) doc.galleries.push({ url, title, date, scannedAt: new Date().toISOString(), photos: images.length })
    let kept = 0
    for (const img of images) {
      const cap = norm(img.caption)
      // The subject is the first player named in a Getty caption.
      const firstNamed = cap.replace(/^[^:]*:\s*/, '')
      if (!firstNamed.startsWith(`${first} `) || !firstNamed.includes(last)) continue
      if (doc.candidates.some(c => c.sourceUrl === img.src)) continue
      const photographer = (img.caption.match(/\(Photo by ([^)]+?)\//) || [])[1] || null
      doc.candidates.push({
        index: doc.candidates.length,
        sourceUrl: img.src,
        sourcePage: url,
        galleryTitle: title,
        caption: img.caption,
        photographer,
        credit: photographer ? `${photographer}/NBAE via Getty Images` : null,
        license: 'unknown',
        size: img.size,
        offTargetCaption: OFF_TARGET.test(img.caption)
      })
      kept++
    }
    console.log(`${title}: ${images.length} photos, ${kept} of ${name}`)
  }
  fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n')

  if (thumbs) {
    fs.mkdirSync(path.join(thumbs, slug), { recursive: true })
    for (const c of doc.candidates) {
      const out = path.join(thumbs, slug, `${String(c.index).padStart(3, '0')}.jpg`)
      if (fs.existsSync(out)) continue
      const res = await fetch(c.sourceUrl, { headers: { 'User-Agent': UA } })
      if (res.ok) fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()))
    }
  }
  console.log(`${slug}: ${doc.candidates.length} candidates (${doc.candidates.filter(c => !c.offTargetCaption).length} with on-target captions)`)
}

main().catch(err => {
  console.error(err.message)
  process.exit(1)
})
