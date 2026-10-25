// data/history/box-stats.json: Basketball-Reference's regular-season lines for 1996-97..
// 1999-00 (each team's and a traded player's season, per 100 possessions), from the
// user-supplied play-by-play archive's public.fact_player_season_stats.csv, kept at
// data/sources/archive/ (no calls). The profiles work the historical tab's box columns out
// from them for the players the tab leaves out (lib/historical.js).
//   node scripts/box-stats.js
const fs = require('fs')
const path = require('path')
const { boxStatsOf } = require('../lib/historical')
const { writeArtifact } = require('../lib/artifacts')

const FILE = path.join(__dirname, '..', 'data', 'sources', 'archive', 'public.fact_player_season_stats.csv')

const doc = boxStatsOf(fs.readFileSync(FILE, 'utf8'))
const seasons = Object.fromEntries(Object.keys(doc.seasons).sort().map(s => [s, doc.seasons[s]]))
writeArtifact('history', 'box-stats', { generatedAt: new Date().toISOString(), source: 'data/sources/archive/public.fact_player_season_stats.csv (user-supplied, Basketball-Reference)', columns: doc.columns, seasons })
console.log(Object.entries(seasons).map(([s, r]) => `${s} ${r.length}`).join(' · '))
