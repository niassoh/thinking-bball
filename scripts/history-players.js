// data/history/players.json: the name of every player in the lineup history
// (data/history/[playoffs/]lineups/<season>/, built from the play-by-play archive by
// analysis/footprint/lineup_history.py) and in the Footprint's lineups
// (data/footprint/<season>/lineups/, back to 1996-97), from pbpstats' player list, for
// players the site has no bio for. One call; rerun after adding seasons to either.
const fs = require('fs')
const path = require('path')
const pbp = require('../lib/pbpstats')
const { writeArtifact } = require('../lib/artifacts')

const HISTORY = path.join(__dirname, '..', 'data', 'history')
const FOOTPRINT = path.join(__dirname, '..', 'data', 'footprint')

const files = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
  const f = path.join(dir, e.name)
  return e.isDirectory() ? files(f) : e.name.endsWith('.json') && e.name !== 'players.json' ? [f] : []
})

const main = async () => {
  const ids = new Set()
  for (const f of files(HISTORY)) for (const l of JSON.parse(fs.readFileSync(f, 'utf8')).lineups) for (const id of l.ids) ids.add(id)
  for (const f of files(FOOTPRINT).filter(f => path.basename(path.dirname(f)) === 'lineups')) {
    for (const c of JSON.parse(fs.readFileSync(f, 'utf8')).chunks) for (const l of c.lineups) for (const id of l.ids) ids.add(id)
  }
  const all = await pbp.players()
  const players = Object.fromEntries([...ids].sort().map(id => [id, all[id] || null]))
  writeArtifact('history', 'players', { generatedAt: new Date().toISOString(), players })
  console.log(`history players: ${ids.size} (${Object.values(players).filter(n => !n).length} without a name)`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
