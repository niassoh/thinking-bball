// Every player's Footprint, for use outside the site, to gs://thinkingbball/footprint/, which
// anyone can read at https://storage.googleapis.com/thinkingbball/footprint/<file>:
// <NBA id>.json per player and index.json (players, stats, fields). Unpacked from the static
// export's api/footprint/<slug>.json, keeping each view (every season and span) and its 17
// stats; not the REMOVE BEST options (most of the export's size), the chart scales or the
// jerseys. Gzipped; storage.googleapis.com unzips for a client that doesn't take gzip.
// tbball's deploy runs it after a fresh export.
//   node scripts/footprint-upload.js <export dir>     (holding api/footprint/)
const fs = require('fs')
const os = require('os')
const path = require('path')
const zlib = require('zlib')
const { Readable } = require('stream')
const { google } = require('googleapis')

const BUCKET = 'thinkingbball'
// The Sheets account can't write the bucket; the deploy writes this key from a secret.
const KEY_FILE = process.env.GCS_KEY_FILE || path.join(os.homedir(), '.gcp', 'thinking-basketball.json')
const BIO = path.join(__dirname, '..', 'data', 'bio.json')
const FIELDS = {
  status: 'notable (a real, large swing), noise (|z| under 2.5), typical (smaller than most players\' swings), thin (too small a sample), na',
  on: 'his team with him on (teammates only, for a stat whose `mates` is true)',
  off: 'his team with him off',
  diff: 'on − off, pooled over his team-seasons weighted by sample',
  lg: 'the league\'s value over the same seasons',
  r: 'on against the league, season by season',
  onPctl: 'percentile of r among the league\'s players (100 is best, read by `good`)',
  rank: 'a notable swing\'s place among the league\'s, from the nearer end: [place, of, "best" | "worst"]',
  nOn: 'sample with him on, in the stat\'s `noun`',
  nOff: 'sample with him off',
  z: 'diff over its standard error',
  pctl: 'percentile of |diff| among the league\'s swings',
  swingPctl: 'percentile of diff among the league\'s swings (100 is best, read by `good`)',
  mate: 'true when most of the swing is explained by a teammate\'s minutes'
}

const main = async () => {
  const dir = path.join(process.argv[2] || '', 'api', 'footprint')
  if (!process.argv[2] || !fs.existsSync(dir)) throw new Error('usage: footprint-upload.js <export dir holding api/footprint/>')
  const bio = JSON.parse(fs.readFileSync(BIO, 'utf8'))
  const docs = new Map()
  // An old slug (a renamed player) exports the same document as his current one.
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
    const slug = path.basename(f, '.json')
    const id = bio[slug] && bio[slug].nbaId
    if (!id) throw new Error(`${slug}: no NBA id in data/bio.json`)
    if (!docs.has(id)) docs.set(id, { slug, name: bio[slug].sheetName, doc: JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) })
  }
  const first = docs.values().next().value.doc
  const stats = first.stats.map(({ key, effect, label, side, mates, unit, good, noun }) => ({ key, effect, label, side, mates, unit, good, noun }))
  const unpack = (row, fields, statuses) => Object.fromEntries(fields.map((f, i) => [f, f === 'status' ? statuses[row[i]] : f === 'mate' ? row[i] === 1 : row[i]]))
  const player = (id, { name, doc }) => ({
    id, name,
    views: doc.views.map(v => ({
      id: v.id,
      seasons: v.seasons,
      teams: v.spans.map(s => ({ season: s.season, team: s.team, minOn: s.minutes.on, minOff: s.minutes.off })),
      minutes: v.minutes,
      stats: Object.fromEntries(doc.stats.map((st, i) => [st.key, v.effects[i] ? unpack(v.effects[i], doc.fields.effect, doc.statuses) : null]))
    }))
  })

  const auth = new google.auth.GoogleAuth({ keyFile: KEY_FILE, scopes: ['https://www.googleapis.com/auth/devstorage.read_write'] })
  const storage = google.storage({ version: 'v1', auth: await auth.getClient() })
  const put = (name, value) => storage.objects.insert({
    bucket: BUCKET, name,
    requestBody: { name, contentType: 'application/json', contentEncoding: 'gzip', cacheControl: 'no-cache' },
    media: { mimeType: 'application/json', body: Readable.from([zlib.gzipSync(JSON.stringify(value))]) }
  })
  const ids = [...docs.keys()]
  for (let i = 0; i < ids.length; i += 32) await Promise.all(ids.slice(i, i + 32).map(id => put(`footprint/${id}.json`, player(id, docs.get(id)))))
  const players = Object.fromEntries(ids.map(id => [id, { name: docs.get(id).name, slug: docs.get(id).slug, seasons: docs.get(id).doc.seasons }]))
  await put('footprint/index.json', { updated: new Date().toISOString(), players, stats, fields: FIELDS })
  console.log(`footprint: uploaded ${ids.length} players`)
}

main().catch(err => {
  console.error(err.message)
  process.exit(1)
})
