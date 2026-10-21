const test = require('node:test')
const assert = require('node:assert')
const { slugify, loadSheet, regularSeasonKeys, seasonFromKey: seasonOf, num } = require('../lib/players')
const { percentileOf } = require('../lib/percentile')
const { ALL_STATS, RELATIVE } = require('../lib/stats')
const { buildProfile, footprintOf, leaderboard, leaderboardDelta, leaderboardRecent, playerIndex, teamList, distribution, lineupLeague, weightedMean, pullOffsets, fillWindows } = require('../lib/profile')

// An illustrated portrait, as approved or in its jersey layers (lib/jerseys.js).
const ILLUSTRATED = ['portrait', 'jersey']

test('slugify strips diacritics, periods and undecomposable letters', () => {
  assert.strictEqual(slugify('Nikola Jokić'), 'nikola-jokic')
  assert.strictEqual(slugify('Nikola Jokic'), 'nikola-jokic')
  assert.strictEqual(slugify('O.G. Anunoby'), 'og-anunoby')
  assert.strictEqual(slugify('Ömer Aşık'), 'omer-asik')
  assert.strictEqual(slugify('Kristaps Porziņģis'), 'kristaps-porzingis')
})

test('percentileOf ranks ties together and respects lower-is-better', () => {
  const pool = [1, 2, 2, 3, 4]
  assert.strictEqual(percentileOf(2, pool), 20)
  assert.strictEqual(percentileOf(4, pool), 80)
  assert.strictEqual(percentileOf(1, pool, true), 80)
  assert.strictEqual(percentileOf(null, pool), null)
})

test('fillWindows: in the season being played a player with no wide-open threes yet keeps his 3yr window', () => {
  const rows = entries => ({ rows: new Map(entries) })
  const seasons = new Map([
    ['2024-25', rows([['a', { MP: '2000' }]])],
    ['2025-26', rows([['a', { MP: '1000' }]])],
    ['2026-27', rows([['a', { MP: '30' }], ['b', { MP: '30', '3yr Wide Open 3s/36': '2.0', 'perc3yr Wide Open 3s/36': '0.00' }]])]
  ])
  const one = {
    '2024-25': { a: { 'Wide Open 3s/36': 3, 'Wide Open 3%': 40 } },
    '2025-26': { a: { 'Wide Open 3s/36': 1.5, 'Wide Open 3%': 30 } },
    '2026-27': { a: { 'Wide Open 3s/36': 0 } }
  }
  fillWindows(seasons, one)
  const [a, b] = ['a', 'b'].map(slug => seasons.get('2026-27').rows.get(slug))
  // (3 x 2000 + 1.5 x 1000 + 0 x 30) / 3030 minutes; the percentage weighted by attempts.
  assert.strictEqual(a['3yr Wide Open 3s/36'], '2.5')
  assert.strictEqual(a['3yr Wide Open 3%'], '38.0')
  assert.deepStrictEqual([a['perc3yr Wide Open 3s/36'], b['perc3yr Wide Open 3s/36']], ['0.50', '0.00'])
})

test('weightedMean ignores missing values and zero weights', () => {
  assert.strictEqual(weightedMean([[10, 1], [20, 3], [null, 5], [99, 0]]), 17.5)
  assert.strictEqual(weightedMean([[null, 1]]), null)
})

test('pullOffsets measures each season key against the latest pull', () => {
  const seasons = new Map([
    ['2023-24', { source: 'daily', rows: new Map([['a', { Age: '30.0' }], ['b', { Age: '25.0' }]]) }],
    ['2024-25', { source: 'daily', rows: new Map([['a', { Age: '31.1' }], ['b', { Age: '26.1' }]]) }]
  ])
  const { offsets, latestEndYear } = pullOffsets(seasons)
  assert.ok(Math.abs(offsets.get('2023-24') - 1.1) < 1e-9)
  assert.strictEqual(offsets.get('2024-25'), 0)
  assert.strictEqual(latestEndYear, 2025)
})

// Rim2FT and rRim2FT are written in from the lineups (lib/profile.js rimDefense).
const WRITTEN_IN = new Set(['Rim2FT', 'rRim2FT'])
test('every mapped stat column exists in the latest season pull', () => {
  const keys = regularSeasonKeys()
  const header = loadSheet(keys[keys.length - 1]).header
  for (const { label, column } of ALL_STATS) {
    if (column && !WRITTEN_IN.has(column)) assert.ok(header.includes(column), `${label} -> ${column}`)
  }
})

test('rim defense: his on-court rim points against the season\'s league, ranked within the season', () => {
  const d = leaderboard('2023-24')
  const raw = d.labels.indexOf('Rim2FT')
  const rel = d.labels.indexOf('rRim2FT')
  // One league a season: raw minus relative is the same for every player.
  const lgs = new Set(d.players.filter(p => p.v[raw] !== null).map(p => Math.round((p.v[raw] - p.v[rel]) * 10) / 10))
  assert.ok(lgs.size <= 2, [...lgs].join())
  // Fewer allowed is better: Gobert's year, near the top.
  const gobert = d.players.find(p => p.slug === 'rudy-gobert')
  assert.ok(gobert.v[rel] < -5 && gobert.p[rel] >= 95, `${gobert.v[rel]} ${gobert.p[rel]}`)
  assert.strictEqual(leaderboardRecent().stats.rRim2FT.na, true)
})

test('profile: league average is 0 for relative stats and minutes-weighted otherwise', () => {
  const p = buildProfile('nikola-jokic')
  assert.strictEqual(p.name.startsWith('Nikola Jok'), true)
  for (const label of RELATIVE) assert.ok(p.stats[label].lg.every(v => v === 0 || v === null), label)

  const keys = regularSeasonKeys()
  const rows = loadSheet(keys[keys.length - 1]).rows
  const expected = weightedMean(rows.map(r => [num(r.Load), num(r.MP)]))
  assert.ok(Math.abs(p.stats.Load.lg[p.stats.Load.lg.length - 1] - expected) < 1e-9)
  // Shooting percentages are averaged over shots: weight = attempt rate x minutes.
  const drivesTs = weightedMean(rows.map(r => [num(r['Drives TS%']), num(r['Drives/36']) * num(r.MP)]))
  assert.ok(Math.abs(p.stats['Drives TS%'].lg[p.stats['Drives TS%'].lg.length - 1] - drivesTs) < 1e-9)
})

test('profile: traded seasons are labelled', () => {
  const harden = buildProfile('james-harden')
  assert.strictEqual(harden.seasons.find(s => s.season === '2021-22').tm, '2 TM')
  assert.deepStrictEqual(harden.seasons.find(s => s.season === '2025-26').teams, ['LAC', 'CLE'])
  assert.deepStrictEqual(harden.seasons.find(s => s.season === '2023-24').teams, ['LAC'])
})

test('profile: seasons start at 1996-97 (the historical tab before 2000-01)', () => {
  const lebron = buildProfile('lebron-james')
  assert.strictEqual(lebron.seasons[0].season, '2003-04')
  assert.ok(lebron.seasons.length >= 23)
  // His rise score reads every playoff run, from his first (2005-06).
  assert.strictEqual(lebron.riser.span[0], 2006)
  const iverson = buildProfile('allen-iverson')
  assert.strictEqual(iverson.seasons[0].season, '1996-97')
  assert.strictEqual(iverson.seasons[iverson.seasons.length - 1].season, '2009-10')
  // A career over before the season tabs begin: the historical tab's rows alone, and his
  // Footprint from play-by-play (an NBA id from bio.json).
  const barkley = buildProfile('charles-barkley')
  assert.deepStrictEqual(barkley.seasons.map(s => s.season), ['1996-97', '1997-98', '1998-99'])
  assert.ok(barkley.footprint.seasons.includes('1999-00'))
})

test('profile: a past season\'s rotation sets each starter by his position that season', () => {
  // The sheet has no position estimate before 2000-01, so the 1996-97 Rockets' five take
  // their listed ones (Basketball-Reference's): Olajuwon at center, not shooting guard.
  const card = buildProfile('hakeem-olajuwon').seasons.find(s => s.season === '1996-97').card
  assert.deepStrictEqual(card.rotation.rows.map(r => [r.pos, r.players[0].name]), [['PG', 'Matt Maloney'], ['SG', 'Clyde Drexler'], ['SF', 'Mario Elie'], ['PF', 'Charles Barkley'], ['C', 'Hakeem Olajuwon']])
})

test('profile: a past rotation places players without a profile by their listed position', () => {
  // Jim McIlvaine and Larry Stewart have no profile: McIlvaine starts at center (not SF,
  // which pushed Kemp to C), Stewart's 958 minutes count.
  const rows = buildProfile('gary-payton').seasons.find(s => s.season === '1996-97').card.rotation.rows
  assert.deepStrictEqual(rows.map(r => [r.pos, r.players[0].name]), [['PG', 'Gary Payton'], ['SG', 'Hersey Hawkins'], ['SF', 'Detlef Schrempf'], ['PF', 'Shawn Kemp'], ['C', 'Jim McIlvaine']])
  const stewart = rows.flatMap(r => r.players).find(p => p.name === 'Larry Stewart')
  assert.ok(stewart && !stewart.hasProfile)
})

test('profile: depth chart flags which players have a profile', () => {
  const players = buildProfile('donovan-mitchell').depth.rows.flatMap(r => r.players)
  assert.ok(players.length)
  for (const pl of players) assert.strictEqual(pl.hasProfile, buildProfile(pl.slug) !== null, pl.slug)
  assert.ok(players.some(pl => pl.hasProfile))
})

test('shot shift: league baseline covers every shot in the pulled players\' zones', () => {
  const fs = require('fs')
  const path = require('path')
  const dir = path.join(__dirname, '..', 'data', 'shotshift')
  const files = fs.readdirSync(dir).map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
  const { league } = files[0]
  for (const zone of Object.keys(files[0].zones)) {
    const pulled = files.reduce((s, f) => s + f.zones[zone].rest.fga + f.zones[zone].recent.fga, 0)
    assert.ok(league[zone].fga >= pulled, zone)
    assert.ok(league[zone].fgm <= league[zone].fga, zone)
  }
  assert.ok(files.every(f => JSON.stringify(f.league) === JSON.stringify(league)))
})

// A season under 30 days old has no shifts yet (scripts/recent-shift.js).
test('recent shift: each stat carries the spread of season values across players', { skip: !Object.keys(require('../data/recent-shift.json').players).length && 'no shifts yet' }, () => {
  const doc = require('../data/recent-shift.json')
  const stats = buildProfile(Object.keys(doc.players)[0]).recentShift.stats
  assert.deepStrictEqual(stats.map(r => r.stat), ['BPM', 'AuPM / g', 'Load', 'rTS%', 'Net On'])
  for (const r of stats) {
    const v = Object.values(doc.players).map(rows => rows.find(x => x.stat === r.stat).season.value)
    const mean = v.reduce((a, b) => a + b, 0) / v.length
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length)
    assert.ok(Math.abs(r.spread - sd) < 1e-9, r.stat)
    assert.ok(r.spread > 0, r.stat)
  }
})

test('profile: last season\'s players count as active in the new season\'s first three weeks, and only then', () => {
  const [last, newest] = regularSeasonKeys().slice(-2).map(seasonOf)
  const first = Object.values(require(`../data/footprint/${newest}/games.json`).games).sort()[0]
  const grace = Date.now() - Date.parse(first) < 21 * 864e5
  const depth = require('../data/depth/_index.json')
  // Last seen last season, on no depth chart: active and not retired only in the grace.
  const x = playerIndex().find(p => p.seasons[1] === last.replace('-', '–') && !depth[p.slug])
  const p = buildProfile(x.slug)
  assert.deepStrictEqual([x.active, p.active, p.retired], [grace, grace, !grace])
})

test('recent shift: a season under 30 days old has no shifts or shot maps yet, and every profile carries its window', { skip: !!require('../data/recent-shift.json').window.restEnd && 'the season is 30+ days old' }, () => {
  const doc = require('../data/recent-shift.json')
  for (const slug of ['shai-gilgeous-alexander', 'shaquille-o-neal']) {
    const p = buildProfile(slug)
    assert.deepStrictEqual(p.recentShift, { season: doc.season, window: doc.window, stats: [] })
    assert.strictEqual(p.shotShift, null)
  }
})

test('player index: active players without a portrait are ordered by (BPM + 2) x minutes over 3 seasons, weighted 1/2/3', () => {
  const seasons = regularSeasonKeys().slice(-3).map((key, i) => [new Map(loadSheet(key).rows.map(r => [slugify(r.Player), r])), i + 1])
  const value = slug => seasons.reduce((sum, [rows, w]) => {
    const r = rows.get(slug)
    return r && num(r.BPM) !== null && num(r.MP) !== null ? sum + w * (num(r.BPM) + 2) * num(r.MP) : sum
  }, 0)
  const group = playerIndex().filter(p => p.active && !ILLUSTRATED.includes(p.headshot))
  // Shrinks as portraits are added; it just needs enough players to test the order.
  assert.ok(group.length > 50)
  for (let i = 1; i < group.length; i++) assert.ok(value(group[i - 1].slug) >= value(group[i].slug) - 1e-6, `${group[i - 1].slug} before ${group[i].slug}`)
})

test('index: each player\'s best season is his top BPM among seasons of 800+ minutes', () => {
  const index = new Map(playerIndex().map(p => [p.slug, p]))
  for (const slug of ['nikola-jokic', 'stephen-curry', 'tim-duncan', 'karl-malone']) {
    const p = buildProfile(slug)
    const qualified = p.seasons.map((s, i) => ({ season: s.season, mp: s.mp, bpm: p.stats.BPM.vals[i].n })).filter(s => s.mp >= 800 && s.bpm !== null)
    const top = qualified.reduce((a, b) => (b.bpm > a.bpm ? b : a))
    assert.deepStrictEqual([index.get(slug).bestSeason.season, index.get(slug).bestSeason.bpm], [top.season, top.bpm], slug)
  }
})

test('profile: a player whose listed name changed is one player (joined by NBA id)', () => {
  const p = buildProfile('jimmy-butler-iii')
  assert.strictEqual(p.seasons[0].season, '2012-13')
  assert.strictEqual(p.seasons.filter(s => s.season <= '2025-26').length, 14)
  // The old spelling's slug opens the same merged profile.
  assert.strictEqual(buildProfile('jimmy-butler').slug, 'jimmy-butler-iii')
  const slugs = playerIndex().map(x => x.slug)
  for (const old of ['jimmy-butler', 'juan-hernangomez', 'kenyon-martin-jr', 'kevin-knox', 'marcus-morris']) assert.ok(!slugs.includes(old), old)
})

test('profile: bio carries the draft pick, or undrafted', () => {
  assert.deepStrictEqual(buildProfile('josh-hart').bio.draft, { year: 2017, round: 1, overall: 30, team: 'UTA' })
  assert.deepStrictEqual(buildProfile('nikola-jokic').bio.draft, { year: 2014, round: 2, overall: 41, team: 'DEN' })
  assert.deepStrictEqual(buildProfile('fred-vanvleet').bio.draft, { undrafted: true })
  // Teams every season, those under the minutes floor too: Curry's 26-game 2011-12 has no
  // season row but still a team.
  const curry = buildProfile('stephen-curry')
  assert.ok(!curry.seasons.some(s => s.season === '2011-12'))
  assert.deepStrictEqual(curry.bio.teamsBySeason['2011-12'], ['GSW'])
})

test('profile: a past player\'s seasons against the rest of his career', () => {
  // Shaq is out of the latest season: each season carries `career`, its stats against his
  // other seasons' minutes-weighted and his shots by band against theirs.
  const p = buildProfile('shaquille-o-neal')
  assert.strictEqual(p.active, false)
  assert.strictEqual(p.retired, true)
  // Out of the latest season but on a current depth chart: the same view, not retired, and
  // active in the library.
  const ad = buildProfile('anthony-davis')
  assert.deepStrictEqual([ad.active, ad.retired], [false, false])
  assert.strictEqual(playerIndex().find(x => x.slug === 'anthony-davis').active, true)
  const i = p.seasons.findIndex(s => s.season === '1999-00')
  const bpm = p.seasons[i].career.stats.find(r => r.stat === 'BPM')
  assert.strictEqual(bpm.recent.value, p.stats.BPM.vals[i].n)
  const others = p.seasons.map((s, j) => [j === i || !p.stats.BPM.vals[j] ? null : p.stats.BPM.vals[j].n, s.mp]).filter(([v, w]) => v !== null && w)
  assert.ok(Math.abs(bpm.season.value - others.reduce((a, [v, w]) => a + v * w, 0) / others.reduce((a, [, w]) => a + w, 0)) < 1e-9)
  const rim = p.seasons[i].career.shots.zones.rim
  assert.ok(rim.recent.fga > 0 && rim.rest.fga > rim.recent.fga)
  // An active player's seasons carry it too: the card is his view of his past seasons.
  const curry = buildProfile('stephen-curry')
  assert.strictEqual(curry.active, true)
  assert.ok(curry.seasons.every(s => s.career))
})

test('profile: unknown players return null', () => {
  assert.strictEqual(buildProfile('not-a-player'), null)
})

test('profile: tracking stats come from the stats sheet, every season since 2013-14', () => {
  const p = buildProfile('lebron-james')
  const at = season => p.seasons.findIndex(s => s.season === season)
  const row = loadSheet('dailycat-26').rows.find(r => r.Player === 'LeBron James')
  assert.strictEqual(p.stats['Drives / 36'].vals[at('2025-26')].n, num(row['Drives/36']))
  // Drives and < 6 ft defense were blank for these seasons before the sheet's
  // tracking tabs followed the season (docs/data-pull-audit.md #70-74).
  assert.ok(p.stats['Drives / 36'].vals[at('2017-18')])
  for (const season of ['2023-24', '2024-25', '2025-26']) assert.ok(p.stats['Def FGA <6ft /36'].vals[at(season)], season)
  for (const label of ['Drives / 36', 'Pullup 3%', 'Time of Poss %']) {
    for (const v of p.stats[label].vals) if (v) assert.ok(v.p >= 0 && v.p <= 100, label)
  }
})

test("distribution: a season's sorted pool values, which place the player at his percentile", () => {
  const d = distribution('Drives / 36')
  const values = d.seasons['2025-26']
  assert.ok(values.length > 250)
  assert.ok(values.every((v, i) => i === 0 || values[i - 1] <= v))
  const p = buildProfile('pascal-siakam')
  const v = p.stats['Drives / 36'].vals[p.seasons.findIndex(s => s.season === '2025-26')]
  // The share of the pool below him matches his percentile.
  assert.ok(Math.abs(Math.round((values.filter(x => x < v.n).length / values.length) * 100) - v.p) <= 1)
  assert.strictEqual(distribution('DRTG On').lowerBetter, true)
  assert.strictEqual(distribution('Not a stat'), null)
})

test('wowy: rows are typed and the teammates they name link to their profiles', () => {
  const w = buildProfile('nikola-jokic').wowy
  assert.deepStrictEqual(w.rows.map(r => r.kind), ['on', 'off', 'without', 'without', 'without', 'neither'])
  assert.deepStrictEqual(w.rows.map(r => r.mate && r.mate.slug), [null, null, 'jamal-murray', 'tim-hardaway-jr', 'bruce-brown', 'jamal-murray'])
  // Every named teammate across the league resolves to one player.
  for (const p of playerIndex().filter(x => x.active)) {
    const x = buildProfile(p.slug).wowy
    if (x) for (const r of x.rows) if (r.kind === 'without' || r.kind === 'neither') assert.ok(r.mate, `${p.slug}: ${r.label}`)
  }
})

test('lineups: on/off agree with the WOWY pull and teammates link to profiles', () => {
  const p = buildProfile('nikola-jokic')
  const L = p.lineups
  assert.strictEqual(L.team, p.wowy.team)
  const [on, off] = p.wowy.rows
  assert.strictEqual(L.on.minutes, on.minutes)
  assert.strictEqual(L.on.net, Math.round(on.net * 10) / 10)
  assert.strictEqual(L.off.net, Math.round(off.net * 10) / 10)
  for (const k of [2, 3, 4, 5]) {
    assert.strictEqual(L.units[k].mostUsed.mates.length, k - 1)
    assert.ok(L.units[k].best.minutes >= L.floors[k], k)
  }
  // Options let the site pick the best at any minimum; at the default it's the same unit.
  for (const k of [2, 3, 4, 5]) {
    const [ids, minutes, net] = L.units[k].options.find(([, m]) => m >= L.floors[k])
    assert.deepStrictEqual({ minutes, net, names: ids.map(id => L.people[id].name) }, { minutes: L.units[k].best.minutes, net: L.units[k].best.net, names: L.units[k].best.mates.map(m => m.name) }, k)
  }
  assert.strictEqual(L.mates[0].slug, 'jamal-murray')
  assert.strictEqual(L.self.slug, 'nikola-jokic')
  assert.ok(ILLUSTRATED.includes(L.self.headshot))
  assert.ok(L.units[3].best.mates.every(m => m.headshot && m.headshotVersion))
  for (const m of [...L.units[5].mostUsed.mates, ...L.mates]) assert.ok(m.slug, m.name)
  // The league pool the tooltip draws is the one the ranks count against.
  const lg = lineupLeague()
  for (const k of [2, 3, 4, 5]) {
    assert.strictEqual(lg.nets[k].length, L.units[k].best.rank.of, k)
    assert.strictEqual(lg.nets[k].filter(n => n > L.units[k].best.net).length + 1, L.units[k].best.rank.rank, k)
  }
})

test('team list: all 30 teams with nickname and a depth chart whose players say if they have a profile', () => {
  const teams = teamList()
  assert.strictEqual(teams.length, 30)
  const den = teams.find(t => t.team === 'DEN')
  assert.strictEqual(den.name, 'Nuggets')
  assert.deepStrictEqual(den.depth.rows.map(r => r.pos), ['PG', 'SG', 'SF', 'PF', 'C'])
  assert.ok(den.depth.rows.find(r => r.pos === 'C').players.some(p => p.slug === 'nikola-jokic' && p.hasProfile))
})

test('headshot: the illustrated portrait wins, else the NBA.com fallback, else none', () => {
  assert.strictEqual(buildProfile('jayson-tatum').headshot, 'portrait')
  // Any player still on the NBA.com fallback (who that is changes as portraits are added).
  const index = playerIndex()
  const fallback = index.find(p => p.headshot === 'nba')
  assert.ok(fallback)
  assert.strictEqual(buildProfile(fallback.slug).headshot, 'nba')
  // Any player with neither (NBA.com serves a silhouette, so no fallback was made).
  const none = buildProfile(index.find(p => !p.headshot).slug)
  assert.strictEqual(none.headshot, null)
  assert.strictEqual(none.headshotVersion, null)
  const firstOther = index.findIndex(p => !ILLUSTRATED.includes(p.headshot))
  assert.ok(index.slice(firstOther).every(p => !ILLUSTRATED.includes(p.headshot)), 'portraits lead the index')
})

test('headshot: the version follows the image, not its modified time (a fresh checkout keeps every URL)', () => {
  const fs = require('fs')
  const path = require('path')
  const slug = playerIndex().find(p => p.headshot === 'nba').slug
  const file = path.join(__dirname, '..', 'assets', 'players', 'nba', `${slug}-100.webp`)
  const before = buildProfile(slug).headshotVersion
  const { atime, mtime } = fs.statSync(file)
  try {
    fs.utimesSync(file, atime, new Date('2001-01-01'))
    assert.strictEqual(buildProfile(slug).headshotVersion, before)
  } finally {
    fs.utimesSync(file, atime, mtime)
  }
})

test('playoffs profile: his runs in the regular profile\'s shape, percentiles from the playoff sheet', () => {
  const { playoffSeasonKeys } = require('../lib/players')
  const keys = playoffSeasonKeys().filter(k => seasonOf(k) >= '2013-14')
  const p = buildProfile('nikola-jokic', { type: 'playoffs' })
  assert.strictEqual(p.seasonType, 'playoffs')
  const runs = keys.filter(k => loadSheet(k).rows.some(r => slugify(r.Player) === 'nikola-jokic'))
  assert.deepStrictEqual(p.seasons.filter(s => !s.empty).map(s => s.season), runs.map(seasonOf))
  const last = loadSheet(runs[runs.length - 1]).rows.find(r => slugify(r.Player) === 'nikola-jokic')
  const bpm = p.stats.BPM.vals[p.seasons.findIndex(s => s.season === seasonOf(runs[runs.length - 1]))]
  assert.strictEqual(bpm.n, num(last.BPM))
  assert.strictEqual(bpm.p, Math.round(num(last.percBPM) * 100))
  // Identity comes from the regular season.
  const r = buildProfile('nikola-jokic')
  assert.deepStrictEqual([p.name, p.team, p.bio], [r.name, r.team, r.bio])
  assert.deepStrictEqual(p.playoffs, r.playoffs)
})

test('multi-year stats say how many seasons they span in the regular season only', () => {
  const r = buildProfile('nikola-jokic')
  const p = buildProfile('nikola-jokic', { type: 'playoffs' })
  assert.strictEqual(r.stats['Pullup 3%'].years, 3)
  assert.strictEqual(r.stats['Def FGA <6ft /36'].years, 2)
  assert.strictEqual(r.stats.BPM.years, null)
  assert.ok(Object.values(p.stats).every(s => s.years === null))
})

test('playoffs profile: the playoff sheet\'s pulls from 1996-97', () => {
  // Duncan's first run is his rookie year's; before 2000-01 the sheet takes its games from
  // the archive, so rTS% (and BPM on it) is against his opponents, not raw TS%.
  const duncan = buildProfile('tim-duncan', { type: 'playoffs' })
  const first = duncan.seasons.findIndex(s => !s.empty)
  assert.strictEqual(duncan.seasons[first].season, '1997-98')
  assert.ok(Math.abs(duncan.stats['rTS%'].vals[first].n) < 8)
  // Chris Paul's 2007-08 run: New Orleans' code then (NOH) has its opponents' averages.
  const paul = buildProfile('chris-paul', { type: 'playoffs' })
  assert.ok(paul.stats['rTS%'].vals[paul.seasons.findIndex(s => s.season === '2007-08')].n !== null)
  // Duncan's 2002-03 run, 24 games and 1,021 minutes, with every stat the pull has.
  const i = duncan.seasons.findIndex(s => s.season === '2002-03')
  assert.deepStrictEqual([duncan.seasons[i].gp, duncan.seasons[i].mp, duncan.seasons[i].tm], [24, 1021, 'SAS'])
  assert.ok(duncan.stats.BPM.vals[i].n > 5 && duncan.stats.OBPM.vals[i].n !== null)
})

test('playoffs card: each run against its own regular season', () => {
  const p = buildProfile('nikola-jokic', { type: 'playoffs' })
  const run = p.seasons.find(s => s.season === '2022-23')
  const season = run.shift.season
  assert.strictEqual(season, '2022-23')
  const rs = loadSheet(`dailycat-${season.slice(-2)}`).rows.find(r => slugify(r.Player) === 'nikola-jokic')
  const po = loadSheet(`dailycat-playoffs-${season.slice(-2)}`).rows.find(r => slugify(r.Player) === 'nikola-jokic')
  const bpm = run.shift.stats.find(s => s.stat === 'BPM')
  assert.deepStrictEqual([bpm.season.value, bpm.recent.value], [num(rs.BPM), num(po.BPM)])
  assert.ok(bpm.spread > 0)
})

test('playoffs profile: a player without playoff runs has an empty one, not none', () => {
  const p = buildProfile('cooper-flagg', { type: 'playoffs' })
  assert.ok(p)
  assert.deepStrictEqual([p.seasons[0].season, p.playoffs.runs, p.recentShift], ['2025-26', 0, null])
  assert.ok(p.seasons.every(s => s.empty))
  assert.ok(Object.values(p.stats).every(s => !s.available))
})

test('both season types list the same seasons, a season without the type\'s games empty', () => {
  // Rondo: the playoffs he missed (Boston's 2006-07, his injured 2012-13) and the 2020-21
  // regular season under the sheet's minutes floor.
  const r = buildProfile('rajon-rondo')
  const p = buildProfile('rajon-rondo', { type: 'playoffs' })
  assert.deepStrictEqual(p.seasons.map(s => s.season), r.seasons.map(s => s.season))
  const at = (doc, season) => doc.seasons.find(s => s.season === season)
  assert.deepStrictEqual([at(p, '2006-07').empty, at(p, '2006-07').gp, at(p, '2006-07').tm], [true, null, 'BOS'])
  assert.strictEqual(at(r, '2020-21').empty, true)
  assert.ok(!at(p, '2020-21').empty && !at(r, '2006-07').empty)
  const i = p.seasons.findIndex(s => s.season === '2006-07')
  assert.ok(Object.values(p.stats).every(s => s.vals[i] === null && s.lg[i] === null))
})

test('distribution: playoffs read the playoff runs', () => {
  const { playoffSeasonKeys } = require('../lib/players')
  const key = playoffSeasonKeys().pop()
  const d = distribution('BPM', { type: 'playoffs' })
  assert.strictEqual(d.seasons[seasonOf(key)].length, loadSheet(key).rows.filter(r => num(r.BPM) !== null).length)
})

test('footprint: regular season only, a view for each season since 1996-97 and each span, notable only where the swing clears the bar', () => {
  const p = buildProfile('nikola-jokic')
  // His rookie season on; the profile has only the seasons, the tab fetches the views.
  assert.deepStrictEqual(p.footprint.seasons.slice(0, 11), ['2015-16', '2016-17', '2017-18', '2018-19', '2019-20', '2020-21', '2021-22', '2022-23', '2023-24', '2024-25', '2025-26'])
  const doc = footprintOf('nikola-jokic')
  const n = doc.seasons.length
  assert.deepStrictEqual(doc.seasons, p.footprint.seasons)
  assert.deepStrictEqual(doc.views.slice(0, n).map(v => v.id), [...doc.seasons].reverse())
  assert.strictEqual(doc.views.length, n + (n * (n - 1)) / 2)
  // Each season on his team that season; this season's minutes are the lineup card's (once
  // this season's minutes are enough for a footprint view).
  const latest = doc.views[0]
  assert.deepStrictEqual(latest.spans.map(s => [s.season, s.team]), [[doc.seasons[n - 1], 'DEN']])
  if (p.lineups.season === latest.id) assert.ok(Math.abs(latest.minutes.on - p.lineups.on.minutes) <= 1 && Math.abs(latest.minutes.off - p.lineups.off.minutes) <= 1)
  const two = doc.views.find(v => v.id === '2024-25..2025-26')
  assert.deepStrictEqual(two.spans.map(s => [s.season, s.team]), [['2024-25', 'DEN'], ['2025-26', 'DEN']])
  assert.ok(Math.abs(two.minutes.on - two.spans[0].minutes.on - two.spans[1].minutes.on) <= 1)
  for (const fp of [latest, two]) {
    // The rim is one stat on each end, rim and two-shot free throw points per 100 (attempts
    // and finishing together); on offense, his teammates'.
    assert.strictEqual(fp.effects.length, 17)
    assert.deepStrictEqual(fp.effects.filter(e => /rim/i.test(e.key)).map(e => e.key), ['rimPts', 'oppRimPts'])
    for (const s of fp.effects.filter(e => e.status === 'notable')) {
      assert.ok(Math.abs(s.z) >= 2.5 && s.pctl >= 75, s.key)
      assert.ok(['own', 'replacement', 'partner', 'thin'].includes(s.context.kind))
      if (s.context.mate && s.context.mate.slug) assert.ok(buildProfile(s.context.mate.slug), s.context.mate.slug)
    }
    for (const s of fp.effects.filter(e => e.status !== 'notable')) assert.strictEqual(s.context, null, s.key)
  }
  assert.strictEqual(buildProfile('nikola-jokic', { type: 'playoffs' }).footprint, null)
})

test("footprint: teammates' stats leave his own shots out (Giannis's teammates shoot threes)", () => {
  const v = footprintOf('giannis-antetokounmpo').views.find(x => x.id === '2023-24..2024-25')
  // With him on, 57% of his teammates' shots are threes (checked by hand from the
  // possessions), though the whole team's share dips: his own shots are 7% threes.
  const e = v.effects.find(x => x.key === 'tm3Rate')
  assert.ok(e.on >= 56.5 && e.on <= 58.5, e.on)
  assert.strictEqual(e.status, 'notable')
  // Checked without the stars the Lonestar tab sets aside: Lillard, and with Middleton.
  assert.deepStrictEqual(v.remove.off.map(o => o.stars.map(t => t.slug).join('+')), ['damian-lillard', 'damian-lillard+khris-middleton'])
  // When Lillard sits, the lift is still there: not a teammate effect.
  assert.ok(v.remove.off[0].tiles.tm3Rate.diff > 10, v.remove.off[0].tiles.tm3Rate.diff)
  assert.strictEqual(e.mate, false)
  // The built lineups keep what lib/footprint.js reads.
  const doc = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'data', 'footprint', '2024-25', 'lineups', 'MIL.json')))
  const { FIELDS, OWN } = require('../lib/footprint')
  assert.deepStrictEqual(doc.fields, FIELDS)
  assert.deepStrictEqual(doc.own, OWN)
})

test('leaderboard: a season\'s players with each stat as their profiles show it, and Footprint\'s swings in the regular season', () => {
  const d = leaderboard('2025-26')
  assert.deepStrictEqual(d.groups.map(g => g.id), ['impact', 'creation', 'offense', 'rim', 'shooting', 'defense', 'team', 'footprint'])
  // Every group's stats, then the hidden single-season shooting columns (in no group).
  const hidden = d.labels.filter(l => !d.groups.some(g => g.stats.includes(l)))
  assert.deepStrictEqual(hidden, ['Wide Open 3s/36', 'Wide Open 3%', 'Pullup 3s/36', 'Pullup 3%', 'C&S 3s/36', 'C&S 3%', 'Def FGA <6ft /36', 'Def FGA Diff%'].map(l => `1yr ${l}`))
  // Read the way the stat they stand for is: opponents' FG% is better lower.
  assert.strictEqual(d.stats['1yr Def FGA Diff%'].lowerBetter, d.stats['Def FGA Diff%'].lowerBetter)
  assert.ok(hidden.every(l => d.stats[l].hidden))
  // Curry's 2025-26 single season: the bucket's catch-and-shoot file for that season alone.
  const one = require('../data/tracking-seasons.json').seasons['2025-26']['stephen-curry']
  assert.strictEqual(d.players.find(x => x.slug === 'stephen-curry').v[d.labels.indexOf('1yr C&S 3%')], one['C&S 3%'])
  const row = d.players.find(x => x.slug === 'jaylen-brown')
  const p = buildProfile('jaylen-brown')
  const i = p.seasons.findIndex(s => s.season === '2025-26')
  assert.strictEqual(row.mp, p.seasons[i].mp)
  assert.strictEqual(row.age, p.seasons[i].age)
  assert.strictEqual(row.gp, p.seasons[i].gp)
  for (const g of d.groups.filter(g => g.id !== 'footprint')) {
    for (const l of g.stats) {
      const k = d.labels.indexOf(l)
      const v = p.stats[l].vals[i]
      assert.deepStrictEqual([row.v[k], row.p[k]], v ? [v.n, v.p] : [null, null], l)
    }
  }
  // His footprint that season: the same swings, lit where the tab lights them.
  const fp = footprintOf('jaylen-brown').views.find(v => v.id === '2025-26')
  for (const e of fp.effects) {
    const k = d.labels.indexOf(e.effect)
    assert.strictEqual(row.v[k], e.status === 'thin' ? null : e.diff, e.effect)
    assert.strictEqual((row.lit || []).includes(k), e.status === 'notable', e.effect)
  }
  assert.strictEqual(leaderboard('2025-26', { type: 'playoffs' }).groups.some(g => g.id === 'footprint'), false)
  assert.strictEqual(leaderboard('1995-96'), null)
})

test('leaderboard: each row has the birth date the site works ages out from', () => {
  const doc = leaderboard('2025-26')
  const born = require('../data/birthdates.json').born
  const jokic = doc.players.find(p => p.slug === 'nikola-jokic')
  assert.strictEqual(jokic.born, '1995-02-19')
  // Every row with a known birth date carries it; the sheet's age stays as the fallback.
  const ids = require('../data/bio.json')
  assert.ok(doc.players.every(p => p.born === (born[(ids[p.slug] || {}).nbaId] || null)))
  assert.strictEqual(buildProfile('nikola-jokic').bio.born, '1995-02-19')
})

test('leaderboard recent: the last 30 days as the sheet scoped them, with the stats it can\'t scope listed but empty', () => {
  const doc = leaderboardRecent()
  const w = require('../data/recent-window.json')
  assert.strictEqual(doc.type, 'recent')
  assert.deepStrictEqual(doc.window, w.window)
  assert.strictEqual(doc.players.length, w.rows.length)
  // A player's values are the window's row, ranked among the window's players.
  const [row] = w.rows
  const pl = doc.players.find(p => p.slug === slugify(row.Player))
  const k = doc.labels.indexOf('rTS%')
  assert.strictEqual(pl.v[k], Number(row['rTS%']))
  assert.ok(pl.p[k] >= 0 && pl.p[k] <= 100)
  assert.strictEqual(pl.mp, Number(row.MP))
  // Season-level and tracking stats have no 30-day values; Team and Footprint are out.
  for (const l of ['Time of Poss %', 'C&S 3%', 'Team Net', 'Net On/Off']) {
    assert.strictEqual(doc.stats[l].na, true, l)
    assert.ok(doc.players.every(p => p.v[doc.labels.indexOf(l)] === null), l)
  }
  assert.deepStrictEqual(doc.groups.filter(g => g.na).map(g => g.id), ['team', 'footprint'])
  assert.ok(!doc.stats.BPM.na)
})

test('leaderboard delta: each playoff player\'s playoff value minus his regular-season one, ranked among the changes', () => {
  const d = leaderboardDelta('2024-25')
  const po = leaderboard('2024-25', { type: 'playoffs' })
  const rs = leaderboard('2024-25')
  assert.strictEqual(d.type, 'delta')
  assert.ok(!d.groups.some(g => g.id === 'footprint'))
  // Only playoff players with a regular-season row.
  assert.ok(d.players.length > 0 && d.players.length < po.players.length)
  assert.ok(d.players.every(p => rs.players.some(r => r.slug === p.slug)))
  const k = d.labels.indexOf('BPM')
  const j = d.players.find(p => p.slug === 'jalen-brunson')
  const pj = po.players.find(p => p.slug === 'jalen-brunson')
  const rj = rs.players.find(p => p.slug === 'jalen-brunson')
  assert.strictEqual(j.v[k], Math.round((pj.v[po.labels.indexOf('BPM')] - rj.v[rs.labels.indexOf('BPM')]) * 1000) / 1000)
  assert.strictEqual(j.mp, pj.mp)
  // The biggest rise in BPM holds the top percentile among the changes; changes are signed.
  const best = [...d.players].filter(p => p.v[k] !== null).sort((a, b) => b.v[k] - a.v[k])[0]
  assert.strictEqual(best.p[k], Math.max(...d.players.map(p => p.p[k] ?? -1)))
  assert.strictEqual(d.stats.BPM.relative, true)
  // A run's 3yr shooting is set against his single season, and carries no window tag.
  const c = d.labels.indexOf('C&S 3%')
  assert.strictEqual(d.stats['C&S 3%'].years, null)
  const jc = rj.v[rs.labels.indexOf('1yr C&S 3%')]
  if (pj.v[po.labels.indexOf('C&S 3%')] !== null && jc !== null) assert.strictEqual(j.v[c], Math.round((pj.v[po.labels.indexOf('C&S 3%')] - jc) * 1000) / 1000)
  assert.ok(!d.labels.some(l => l.startsWith('1yr ')))
})

test('awards: his trophies by season, titles from the teams he finished seasons with', () => {
  const mj = buildProfile('michael-jordan').awards
  assert.strictEqual(mj.mvp.length, 5)
  assert.deepStrictEqual(mj.fmvp, ['1990-91', '1991-92', '1992-93', '1995-96', '1996-97', '1997-98'])
  assert.deepStrictEqual(mj.champion, mj.fmvp)
  // Titles for players who weren't Finals MVP, before and after the site's seasons began.
  assert.deepStrictEqual(buildProfile('robert-horry').awards.champion, ['1993-94', '1994-95', '1999-00', '2000-01', '2001-02', '2004-05', '2006-07'])
  assert.strictEqual(buildProfile('andre-iguodala').awards.champion.length, 4)
  assert.strictEqual(buildProfile('dikembe-mutombo').awards.dpoy.length, 4)
  // Keys in the case's order; none when he has none.
  assert.deepStrictEqual(Object.keys(mj), ['champion', 'fmvp', 'mvp', 'dpoy', 'allnba1', 'allnba2', 'alldef1', 'roy', 'allstar'])
  // All-NBA and All-Defensive by tier: Pippen's 3 / 2 / 2 and 8 / 2.
  const sp = buildProfile('scottie-pippen').awards
  assert.deepStrictEqual([sp.allnba1.length, sp.allnba2.length, sp.allnba3.length, sp.alldef1.length, sp.alldef2.length], [3, 2, 2, 8, 2])
  assert.strictEqual(buildProfile('paul-reed').awards, null)
  // All-Star selections, not games: Edwards was picked in 2024-25 and sat hurt, Edey played
  // there only as a Rising Star, and Davis's ten are there though the old source lost them.
  assert.ok(buildProfile('anthony-edwards').awards.allstar.includes('2024-25'))
  assert.ok(!(buildProfile('zach-edey').awards || {}).allstar)
  assert.strictEqual(buildProfile('anthony-davis').awards.allstar.length, 10)
})

test('season cards: each season but the depth chart\'s own has the team he played most for, its lineups and rotation', () => {
  const p = buildProfile('kevin-durant')
  assert.strictEqual(p.depth.season, '2026-27')
  assert.ok(p.seasons.every(s => s.card), 'every season has a card while the depth chart is next season\'s')
  const bySeason = Object.fromEntries(p.seasons.map(s => [s.season, s.card]))
  const gsw = bySeason['2016-17']
  assert.strictEqual(gsw.team, 'GSW')
  assert.strictEqual(gsw.lineups.season, '2016-17')
  assert.strictEqual(gsw.lineups.team, 'GSW')
  assert.strictEqual(bySeason['2013-14'].team, 'OKC')
  // The rotation's first row is the team's most-used five, PG to C; he's in it, and
  // the rest follow by minutes.
  const rows = gsw.rotation.rows
  assert.deepStrictEqual(rows.map(r => r.pos), ['PG', 'SG', 'SF', 'PF', 'C'])
  assert.ok(rows.some(r => r.players[0].slug === 'kevin-durant'))
  for (const r of rows) {
    assert.ok(r.players.length >= 1 && r.players.length <= 4, r.pos)
    for (let i = 2; i < r.players.length; i++) assert.ok(r.players[i - 1].minutes >= r.players[i].minutes, r.pos)
  }
  // Past seasons rank units in their own season's league pool.
  assert.strictEqual(lineupLeague('regular', '2016-17').season, '2016-17')
  // Each season names the jersey its card shows him in, and so does each teammate.
  assert.strictEqual(p.seasons.find(s => s.season === '2016-17').jersey, 'GSW')
  assert.strictEqual(p.seasons.find(s => s.season === '2013-14').jersey, 'OKC')
  // A season he was traded in names each team's, in the order he played for them.
  assert.deepStrictEqual(p.seasons.find(s => s.season === '2022-23').jerseys, ['BKN', 'PHX'])
  assert.strictEqual(p.seasons.find(s => s.season === '2016-17').jerseys, undefined)
  assert.strictEqual(gsw.lineups.self.jersey, 'GSW')
  assert.ok(gsw.lineups.mates.every(m => m.jersey === 'GSW'))
  assert.strictEqual(typeof p.jerseys, 'object')
  // Playoff runs too, from that postseason's lineups.
  const run = buildProfile('stephen-curry', { type: 'playoffs' }).seasons.find(s => s.season === '2015-16').card
  assert.strictEqual(run.team, 'GSW')
  assert.strictEqual(run.lineups.season, '2015-16')
  // Runs before 2013-14 from pbpstats' lineups: Kobe's 2000-01 Lakers, Shaq at center.
  const lal = buildProfile('kobe-bryant', { type: 'playoffs' }).seasons.find(s => s.season === '2000-01').card
  assert.strictEqual(lal.team, 'LAL')
  assert.strictEqual(lal.rotation.rows[4].players[0].name, 'Shaquille O\'Neal')
})
