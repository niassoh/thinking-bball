// data/heights.json: every NBA player's listed height in inches, by Basketball-Reference
// id (bio.json's brefId), from Basketball-Reference's player index (one page a letter,
// 26 requests, 3 s apart; the pages are kept in data/sources/bref-players/, so a rerun with
// --cached calls nothing). bio.json has heights only for current players (ESPN); the
// profile and the Leaderboard fall back to these (lib/profile.js heightOf).
//   node scripts/heights.js [--cached]
const fs = require('fs')
const path = require('path')
const { writeArtifact } = require('../lib/artifacts')

const SOURCE_DIR = path.join(__dirname, '..', 'data', 'sources', 'bref-players')
const URL = letter => `https://www.basketball-reference.com/players/${letter}/`
const PAUSE_MS = 3000
const CACHED = process.argv.includes('--cached')

const page = async letter => {
  const file = path.join(SOURCE_DIR, `${letter}.html`)
  if (CACHED && fs.existsSync(file)) return fs.readFileSync(file, 'utf8')
  const res = await fetch(URL(letter), { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(60000) })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${URL(letter)}`)
  const html = await res.text()
  fs.mkdirSync(SOURCE_DIR, { recursive: true })
  fs.writeFileSync(file, html)
  await new Promise(resolve => setTimeout(resolve, PAUSE_MS))
  return html
}

// Each row: the player's id (data-append-csv) and his height's inches (the cell's csk).
const ROW = /data-append-csv="([^"]+)"[\s\S]*?data-stat="height" csk="([\d.]+)"/g

const main = async () => {
  const players = {}
  for (const letter of 'abcdefghijklmnopqrstuvwxyz') {
    const html = await page(letter)
    let n = 0
    for (const [, id, inches] of html.matchAll(ROW)) {
      players[id] = Number(inches)
      n++
    }
    console.log(`${letter}: ${n}`)
  }
  writeArtifact('', 'heights', { generatedAt: new Date().toISOString(), source: 'basketball-reference.com/players/<letter>/', players })
  console.log(`heights: ${Object.keys(players).length} players`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
