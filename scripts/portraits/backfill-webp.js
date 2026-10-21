// Adds any missing WebP sizes (currently 1024) for approved portraits from their
// existing PNG masters. No API calls; existing WebPs are left untouched.
//   node scripts/portraits/backfill-webp.js
const fs = require('fs')
const path = require('path')
const sharp = require('sharp')

const ROOT = path.join(__dirname, '..', '..')
const METADATA = path.join(ROOT, 'assets', 'players', 'metadata')
const SIZES = [[1024, 90], [400, 85], [200, 85], [100, 85]]

const main = async () => {
  for (const f of fs.readdirSync(METADATA).filter(f => f.endsWith('.json')).sort()) {
    const meta = JSON.parse(fs.readFileSync(path.join(METADATA, f), 'utf8'))
    if (!meta.approved || !meta.masterFile) continue
    const slug = f.replace(/\.json$/, '')
    const added = []
    for (const [size, quality] of SIZES) {
      const out = `assets/players/webp/${slug}-${size}.webp`
      if (fs.existsSync(path.join(ROOT, out))) continue
      await sharp(path.join(ROOT, meta.masterFile)).resize(size, size).webp({ quality }).toFile(path.join(ROOT, out))
      added.push(out)
    }
    // Keep the metadata list in size order, largest first.
    meta.webp = SIZES.map(([size]) => `assets/players/webp/${slug}-${size}.webp`).filter(p => fs.existsSync(path.join(ROOT, p)))
    fs.writeFileSync(path.join(METADATA, f), JSON.stringify(meta, null, 2) + '\n')
    console.log(`${slug}: ${added.length ? `added ${added.map(a => path.basename(a)).join(', ')}` : 'complete'}`)
  }
}

main().catch(err => {
  console.error(err.message)
  process.exit(1)
})
