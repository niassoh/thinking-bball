// NBA.com's team tracking tables (lib/team-tracking.js MEASURES) for the Teams sheet, one
// CSV a measure a season, to gs://thinkingbball/<end year>/team_tracking/<measure>.csv
// (playoffs: <end year>/playoffs/team_tracking/), beside the player files' player_tracking/;
// play types (and drives again) to <end year>/playtype/<name>.csv, the bucket's older team
// play type folder, in its layout (docs/team-tracking.md). Runs on the Mac: stats.nba.com
// doesn't answer GitHub's runners. Raw responses are cached in data/cache/nba-team-tracking/,
// so an interrupted run resumes; --refresh re-asks NBA.com (the season being played changes
// nightly). A measure NBA.com returns empty (playoffs not started) gets no file. --upload
// sends the CSVs to the bucket, skipping one the bucket already has byte for byte and one
// with fewer teams than the bucket's copy (--force overwrites that anyway: a copy known to be
// wrong, backed up first), and reads each back.
//   node scripts/team-tracking.js [--from=2014] [--to=<this season>] [--playoffs] [--refresh] [--upload [--force]] [--out=<dir>]
const fs = require('fs')
const os = require('os')
const path = require('path')
const { Readable } = require('stream')
const { google } = require('googleapis')
const { fetchJson, sleep, NBA_HEADERS } = require('../lib/http')
const { MEASURES, objectName, filesOf, cacheName, requestUrl, resultSet, csvAs } = require('../lib/team-tracking')

const BUCKET = 'thinkingbball'
const KEY_FILE = path.join(os.homedir(), '.gcp', 'thinking-basketball.json')
const CACHE = path.join(__dirname, '..', 'data', 'cache', 'nba-team-tracking')
const opt = name => (process.argv.find(a => a.startsWith(`--${name}=`)) || '').slice(name.length + 3) || null
const flag = name => process.argv.includes(`--${name}`)
const now = new Date()
const TO = Number(opt('to')) || now.getFullYear() + (now.getMonth() >= 9 ? 1 : 0)
const FROM = Number(opt('from')) || 2014
const PLAYOFFS = flag('playoffs')
const OUT = opt('out') || path.join(__dirname, '..', 'data', 'sources', 'team-tracking')

const pull = async (measure, end) => {
  const cached = path.join(CACHE, cacheName(end, PLAYOFFS, measure))
  if (!flag('refresh') && fs.existsSync(cached)) return JSON.parse(fs.readFileSync(cached))
  const json = await fetchJson(requestUrl(measure, end, PLAYOFFS), { headers: NBA_HEADERS, retries: 5 })
  await sleep(1500)
  fs.mkdirSync(path.dirname(cached), { recursive: true })
  fs.writeFileSync(cached, JSON.stringify(json))
  return json
}

const rowCount = text => text.trim().split('\n').length - 1

const upload = async files => {
  const auth = new google.auth.GoogleAuth({ keyFile: KEY_FILE, scopes: ['https://www.googleapis.com/auth/devstorage.read_write'] })
  const storage = google.storage({ version: 'v1', auth: await auth.getClient() })
  const bad = []
  let same = 0
  for (const f of files) {
    const url = `https://storage.googleapis.com/${BUCKET}/${f.name}`
    // The bucket's older files are served public, max-age=3600: ask past any cached copy.
    const before = await fetch(`${url}?v=${Date.now()}`)
    const old = before.ok ? await before.text() : null
    if (old === f.body) {
      same++
      continue
    }
    if (!flag('force') && old != null && rowCount(old) > f.rows) {
      bad.push(`${f.name}: ${f.rows} teams, the bucket's copy more; not uploaded`)
      continue
    }
    await storage.objects.insert({ bucket: BUCKET, name: f.name, requestBody: { name: f.name, contentType: 'text/csv', cacheControl: 'no-cache' }, media: { mimeType: 'text/csv', body: Readable.from([f.body]) } })
    const back = await fetch(`${url}?v=${Date.now()}`)
    if (!back.ok || (await back.text()) !== f.body) bad.push(`${f.name}: read back ${back.status}, not the uploaded file`)
  }
  return { bad, same }
}

const main = async () => {
  const files = []
  const empty = []
  for (let end = FROM; end <= TO; end++) {
    for (const m of MEASURES) {
      const rs = resultSet(await pull(m, end))
      if (!rs.rowSet.length) {
        empty.push(`${end} ${m.name}`)
        continue
      }
      for (const [file, layout] of filesOf(m)) {
        const name = objectName(end, PLAYOFFS, file)
        const body = csvAs(layout, rs)
        fs.mkdirSync(path.dirname(path.join(OUT, name)), { recursive: true })
        fs.writeFileSync(path.join(OUT, name), body)
        files.push({ name, body, rows: rs.rowSet.length })
      }
    }
    console.log(`${end}${PLAYOFFS ? ' playoffs' : ''}: ${files.filter(f => f.name.startsWith(`${end}/`)).length} files`)
  }
  if (empty.length) console.log(`empty at NBA.com, no file: ${empty.join(', ')}`)
  if (flag('upload')) {
    const { bad, same } = await upload(files)
    console.log(`uploaded ${files.length - same - bad.length} of ${files.length} to gs://${BUCKET} (${same} already there as is)`)
    if (bad.length) throw new Error(bad.join('\n'))
  }
}

main().catch(err => {
  console.error(err.message)
  process.exit(1)
})
