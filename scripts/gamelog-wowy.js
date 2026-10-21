// For every player in the latest season pull:
//   data/gamelog/<slug>.json: last 5 games (pbpstats game logs + game list for
//     home/away and final score; opponent tier from the latest teamcat Net rank)
//     and games played in the shared recent window (lib/window.js)
//   data/wowy/<slug>.json: team net rating per 100 with him on/off, and on
//     without each of his three highest-minute teammates, summed from his team's
//     lineup file (scripts/lineups.js; the same totals as pbpstats' WOWY, audit #83,
//     every 2025-26 row within 0.05 net, #166). Run it after the lineups pull.
// --playoffs: the same for that season's playoffs, to data/playoffs/{gamelog,wowy}/
// (the game log counts his playoff games instead of a recent window; teammates are
// ranked by playoff minutes, from the playoff sheet's pull when there is one).
const fs = require('fs')
const path = require('path')
const { loadSheet, loadCache, slugify, num } = require('../lib/players')
const pbp = require('../lib/pbpstats')
const { writeArtifact, loadBio, latestSeasonRows } = require('../lib/artifacts')
const { recentWindow } = require('../lib/window')
const { sum } = require('../lib/lineups')
const { mergeLineups } = require('../lib/stints')

const DATA_DIR = path.join(__dirname, '..', 'data')
const TYPE = process.argv.includes('--playoffs') ? 'playoffs' : 'regular'
const dir = d => (TYPE === 'playoffs' ? path.join('playoffs', d) : d)

const latestTeamcat = () => {
  const keys = Object.keys(loadCache()).filter(k => /^teamcat-\d+$/.test(k)).sort()
  return loadSheet(keys[keys.length - 1]).rows.filter(r => r.Tm && r.Tm !== 'League Average')
}

const lastName = name => name.split(' ').slice(1).join(' ') || name

const gameLogRows = (logs, games, netRank) =>
  logs.slice(-5).reverse().map(g => {
    const game = games.get(g.GameId)
    const home = game.HomeTeamAbbreviation === g.Team
    const [us, them] = home ? [game.HomePoints, game.AwayPoints] : [game.AwayPoints, game.HomePoints]
    return {
      date: g.Date,
      gameId: g.GameId,
      opp: g.Opponent,
      home,
      result: us > them ? 'W' : 'L',
      pts: g.Points || 0,
      reb: g.Rebounds || 0,
      ast: g.Assists || 0,
      ts: g.TsPct === undefined || g.TsPct === null ? null : Math.round(g.TsPct * 1000) / 10,
      oppRank: netRank[g.Opponent] || null
    }
  })

// The team's whole season of five-man lineups, null until its file holds this season.
const teamLineups = (season, team) => {
  const file = path.join(DATA_DIR, dir('lineups'), `${team}.json`)
  const d = fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8'))
  return d && d.season === season ? d.lineups || mergeLineups(d.chunks.map(c => c.lineups)) : null
}

const wowyRows = ({ season, lineups, team, nbaId, name, mates }) => {
  const sub = `${season.replace('-', '–')}${TYPE === 'playoffs' ? ' playoffs' : ''} · ${team}`
  const has = id => l => l.ids.includes(String(id))
  const on = has(nbaId)
  const row = (label, keep) => ({ label, sub, ...sum(lineups.filter(keep)) })
  const rows = [row('Team, he’s on', on), row('Team, he’s off', l => !on(l))]
  for (const m of mates) rows.push(row(`On, w/o ${lastName(m.name)}`, l => on(l) && !has(m.nbaId)(l)))
  if (mates[0]) rows.push(row(`Neither ${lastName(name)} nor ${lastName(mates[0].name)}`, l => !on(l) && !has(mates[0].nbaId)(l)))
  return rows
}

const main = async () => {
  const season = await pbp.latestSeasonWithGames()
  const games = await pbp.games(season, TYPE)
  if (!games.size) return console.log(`gamelog-wowy ${season} ${TYPE}: no games yet`)
  const win = TYPE === 'regular' ? recentWindow(games) : null
  const netRank = Object.fromEntries(latestTeamcat().sort((a, b) => num(b.Net) - num(a.Net)).map((r, i) => [r.Tm, i + 1]))
  const bio = loadBio()
  const rows = latestSeasonRows()
  // Teammates are ranked by minutes in the same games: the playoff sheet's pull for
  // the playoffs when there is one.
  const poKey = `dailycat-playoffs-${season.slice(-2)}`
  const mateRows = TYPE === 'playoffs' && loadCache()[poKey] ? loadSheet(poKey).rows : rows

  let logsChanged = 0
  let wowyChanged = 0
  let skipped = 0
  const failed = []
  for (const r of rows) {
    const slug = slugify(r.Player)
    const nbaId = bio[slug] && bio[slug].nbaId
    if (!nbaId) { skipped++; continue }
    try {
      const changed = await updatePlayer({ r, slug, nbaId, season, games, win, netRank, bio, rows: mateRows })
      logsChanged += changed.logs
      wowyChanged += changed.wowy
    } catch (err) {
      // One player's failure shouldn't stop the run; the next run retries it.
      failed.push(slug)
      console.error(`${slug}: ${err.message}`)
    }
  }
  console.log(`gamelog-wowy ${season}${TYPE === 'playoffs' ? ' playoffs' : ''}: ${logsChanged} game logs and ${wowyChanged} WOWY files changed; ${skipped} players without an NBA id; ${failed.length} failed${failed.length ? ': ' + failed.join(', ') : ''}`)
}

const updatePlayer = async ({ r, slug, nbaId, season, games, win, netRank, bio, rows }) => {
  const changed = { logs: 0, wowy: 0 }
  // Only the season type's own games (a play-in game can show up in playoff logs).
  const logs = (await pbp.gameLogs(nbaId, season, TYPE)).filter(g => games.has(g.GameId))
  if (!logs.length) return changed
  const counts = win
    ? { recent: { start: win.start, end: win.end, games: logs.filter(g => g.Date >= win.start && g.Date <= win.end).length, seasonGames: logs.length } }
    : { playoffGames: logs.length }
  if (writeArtifact(dir('gamelog'), slug, { season, generatedAt: new Date().toISOString(), ...counts, games: gameLogRows(logs, games, netRank) })) changed.logs++

  const team = logs[logs.length - 1].Team
  const lineups = teamLineups(season, team)
  if (!lineups) return changed

  const mates = rows
    .filter(m => m.Tm === team && m.Player !== r.Player)
    .sort((a, b) => num(b.MP) - num(a.MP))
    .map(m => ({ name: m.Player, nbaId: (bio[slugify(m.Player)] || {}).nbaId }))
    .filter(m => m.nbaId)
    .slice(0, 3)
  const doc = { season, team, gp: logs.length, generatedAt: new Date().toISOString(), rows: wowyRows({ season, lineups, team, nbaId, name: r.Player, mates }) }
  if (writeArtifact(dir('wowy'), slug, doc)) changed.wowy++
  return changed
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
