// The season's six tracking files, from the Mac's nightly (scripts/mac-nightly.sh), to
// gs://thinkingbball/<end year>/, where the stats sheet's tracking tabs IMPORTDATA them.
// Uploads the files the pull wrote (one whose pull failed is missing). Uploads nothing if
// a file lists fewer players than the bucket's copy, drives have no free throws, or the
// league's time of possession tops 30 minutes a team-game: NBA.com's has run about 28
// since its 2025-26 reprocessing, and hit 35 when it broke in 2024-25
// (docs/tracking-source-investigation.md). League drives under 40 a team-game (about 64
// since the reprocessing, 48 before it; the 2026-10-28 pull had 29) are uploaded as they
// are but exit 1, so the nightly's alert names tracking.
//   node scripts/tracking-upload.js <end year> <dir holding player_tracking/ and player_shooting/>
const fs = require('fs')
const os = require('os')
const path = require('path')
const { Readable } = require('stream')
const { google } = require('googleapis')

const BUCKET = 'thinkingbball'
// The Sheets account can't write the bucket.
const KEY_FILE = path.join(os.homedir(), '.gcp', 'thinking-basketball.json')
const FILES = ['player_tracking/touches.csv', 'player_tracking/drives.csv', 'player_tracking/cs.csv', 'player_tracking/pullup.csv', 'player_tracking/close_6.csv', 'player_shooting/wide_open.csv']
const [end, dir] = process.argv.slice(2)

// The files have no quoted fields.
const table = text => {
  const [head, ...rows] = text.trim().split(/\r?\n/).map(l => l.split(','))
  return rows.map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])))
}
const sum = (rows, col) => rows.reduce((s, r) => s + Number(r[col]), 0)

const main = async () => {
  const files = FILES.filter(f => fs.existsSync(path.join(dir, f))).map(f => ({ name: `${end}/${f}`, body: fs.readFileSync(path.join(dir, f)) }))
  if (!files.length) throw new Error(`no tracking files in ${dir}`)
  for (const f of files) {
    f.rows = table(f.body.toString()).length
    const res = await fetch(`https://storage.googleapis.com/${BUCKET}/${f.name}`)
    const before = res.ok ? table(await res.text()).length : 0
    if (f.rows < before) throw new Error(`${f.name}: ${f.rows} players, the bucket's copy ${before}; nothing uploaded`)
  }
  const read = name => {
    const f = files.find(f => f.name.endsWith(name))
    return f && table(f.body.toString())
  }
  const [touches, drives] = [read('touches.csv'), read('drives.csv')]
  const possession = touches && sum(touches, 'Time OfPoss') / (sum(touches, 'MIN') / 240)
  if ((drives && !(sum(drives, 'FTA') > 0)) || possession > 30) {
    throw new Error(`drive FTA ${drives && sum(drives, 'FTA')}, time of possession ${possession?.toFixed(1)} min a team-game; nothing uploaded`)
  }
  const perGame = drives && sum(drives, 'DRIVES') / (sum(drives, 'MIN') / 240)
  const auth = new google.auth.GoogleAuth({ keyFile: KEY_FILE, scopes: ['https://www.googleapis.com/auth/devstorage.read_write'] })
  const storage = google.storage({ version: 'v1', auth: await auth.getClient() })
  for (const f of files) {
    await storage.objects.insert({ bucket: BUCKET, name: f.name, requestBody: { name: f.name, contentType: 'text/csv', cacheControl: 'no-cache' }, media: { mimeType: 'text/csv', body: Readable.from([f.body]) } })
  }
  console.log(`tracking ${end}: uploaded ${files.map(f => `${path.basename(f.name, '.csv')} ${f.rows}`).join(', ')}; time of possession ${possession?.toFixed(1)} min, drives ${perGame?.toFixed(1)} a team-game`)
  if (perGame < 40) throw new Error(`drives ${perGame.toFixed(1)} a team-game, under 40: NBA.com's drives look short (uploaded anyway)`)
}

main().catch(err => {
  console.error(err.message)
  process.exit(1)
})
