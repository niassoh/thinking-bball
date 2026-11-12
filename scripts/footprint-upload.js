// Footprint's lineup files (data/footprint/<season>/), for use outside the site, to
// gs://thinkingbball/footprint/<season>/, which anyone can read at
// https://storage.googleapis.com/thinkingbball/footprint/<season>/<file>. footprint/index.json
// lists every season's files. The nightly sends its season; a list of seasons is the backfill.
//   node scripts/footprint-upload.js <season>...    e.g. 2026-27, or $(ls data/footprint | grep -)
const fs = require('fs')
const os = require('os')
const path = require('path')
const { Readable } = require('stream')
const { google } = require('googleapis')

const BUCKET = 'thinkingbball'
// The Sheets account can't write the bucket; the nightly writes this key from a secret.
const KEY_FILE = process.env.GCS_KEY_FILE || path.join(os.homedir(), '.gcp', 'thinking-basketball.json')
const ROOT = path.join(__dirname, '..', 'data', 'footprint')
const seasons = process.argv.slice(2)

const filesOf = season => {
  const dir = path.join(ROOT, season)
  const top = fs.readdirSync(dir).filter(f => f.endsWith('.json'))
  const lineups = fs.readdirSync(path.join(dir, 'lineups')).filter(f => f.endsWith('.json')).map(f => `lineups/${f}`)
  return [...top, ...lineups]
}

const main = async () => {
  if (!seasons.length || seasons.some(s => !/^\d{4}-\d{2}$/.test(s))) throw new Error('usage: footprint-upload.js <season>...')
  const auth = new google.auth.GoogleAuth({ keyFile: KEY_FILE, scopes: ['https://www.googleapis.com/auth/devstorage.read_write'] })
  const storage = google.storage({ version: 'v1', auth: await auth.getClient() })
  const put = (name, body) => storage.objects.insert({
    bucket: BUCKET, name,
    requestBody: { name, contentType: 'application/json', cacheControl: 'no-cache' },
    media: { mimeType: 'application/json', body: Readable.from([body]) },
  })
  const res = await fetch(`https://storage.googleapis.com/${BUCKET}/footprint/index.json`)
  const index = res.ok ? await res.json() : { seasons: {} }
  for (const season of seasons) {
    const files = filesOf(season)
    await Promise.all(files.map(f => put(`footprint/${season}/${f}`, fs.readFileSync(path.join(ROOT, season, f)))))
    index.seasons[season] = files
    console.log(`footprint ${season}: uploaded ${files.length} files`)
  }
  index.updated = new Date().toISOString()
  index.seasons = Object.fromEntries(Object.entries(index.seasons).sort(([a], [b]) => a.localeCompare(b)))
  await put('footprint/index.json', JSON.stringify(index, null, 1))
}

main().catch(err => {
  console.error(err.message)
  process.exit(1)
})
