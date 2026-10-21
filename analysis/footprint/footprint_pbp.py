"""The footprint's lineup totals per team-season from the possession cache (build.py), in
the shape of scripts/lineups.js's files: each five-man lineup's seconds, possessions,
plus-minus and lib/footprint.js's FIELDS counts for the team (t) and its opponent (o),
the season in chunks of games split where traded players came and went, so a traded
player's on/off covers only his time there (lib/stints.js lineupsDuring). Also the
season's stints, and every player's own rates for the footprint's teammate checks
(scripts/player-totals.js's fields).

  python3 analysis/footprint/footprint_pbp.py 1996-97 ... 2025-26
  python3 analysis/footprint/footprint_pbp.py --check 2024-25

Needs data/footprint/<season>/games.json (scripts/footprint-games.js): the cache has no
dates, and game ids don't run in date order. Writes data/footprint/<season>/{lineups/
<TEAM>.json, stints.json, player-totals.json} (as data/seasons/<season>/ holds a pbpstats
season), compact. --check compares each team's season totals
with the pbpstats files of that season (data/seasons/<season>/lineups, or data/lineups)
instead of writing.

Possessions count as pbpstats counts them (wowy.py): those with a shot, a free throw or a
turnover. So do rebounds: every rebound but a team rebound on a possession that ends the
period (the placeholder after a last-second miss).

Each lineup also keeps its players' own counts (`p`, a row per id in `ids`' order, OWN's
fields, trailing zeros dropped, 0 for a player with none, left out when no one has any), so
lib/footprint.js can take a player's teammates as the team less him.
"""
import json
import math
import os
import sys

import numpy as np
import pandas as pd

from wowy import AT_RIM_FT

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
DATA = os.path.join(ROOT, 'data')
CACHE = os.path.join(DATA, 'cache', 'pbp')
# lib/footprint.js FIELDS, in its order: pbpstats' 22 (BASE_FIELDS), then the Footprint's
# own zones: twos under RIM_FT (Rim) and from there to SHORT_MID_FT (Paint, "paint
# extended"), and the made free throws that count with each (zone_fts; fractions for the
# trips split between them).
FIELDS = ['Points', 'FG2M', 'FG2A', 'FG3M', 'FG3A', 'AtRimFGM', 'AtRimFGA',
          'ShortMidRangeFGM', 'ShortMidRangeFGA', 'LongMidRangeFGM', 'LongMidRangeFGA',
          'Corner3FGM', 'Corner3FGA', 'FTA', 'Turnovers', 'LiveBallTurnovers',
          'OffRebounds', 'DefRebounds', 'Assists', 'Steals', 'Blocks', 'Fouls',
          'RimFTM', 'RimFGM', 'RimFGA', 'PaintFGM', 'PaintFGA', 'PaintFTM',
          'RunoutPoss', 'RunoutRimFGM', 'RunoutRimFTM', 'RunoutPaintFGM', 'RunoutPaintFTM']
# The fields that can hold fractions (zone_fts' split trips), kept to two decimals.
SPLIT = {'RimFTM', 'PaintFTM', 'RunoutRimFTM', 'RunoutPaintFTM'}
# lib/footprint.js OWN: a player's own counts per lineup.
OWN = ['Points', 'FG2M', 'FG2A', 'FG3M', 'FG3A', 'FTA', 'RimFGM', 'RimFTM']
# pbpstats' short mid-range: twos from AT_RIM_FT out to 14 ft; long mid-range beyond.
SHORT_MID_FT = 14
# The Footprint's rim: twos under 5 ft (pbpstats' at-rim stops at AT_RIM_FT).
RIM_FT = 5
# How much a league's split of fouled twos weighs against a shooter's own and-ones (as if
# he had this many more), when his fouled misses are split between the zones.
PRIOR = 10
# A runout: a possession that began with a steal (a live-ball turnover) and saw its first
# shot or shooting foul within this many seconds, mostly an undefended break. Each is
# counted (RunoutPoss) with its rim and paint makes and free throws, so rim protection and
# paint extended can leave them out, points and possession.
RUNOUT_S = 6
# Fouls as pbpstats counts a team's: personal fouls, not technicals, and offensive fouls,
# which the cache keeps as turnovers.
TECHNICAL = {'Technical', 'Double Technical', 'Delay Technical', 'Non-Unsportsmanlike Technical', 'Hanging Technical'}


def five(f):
    return tuple(sorted(f)) if isinstance(f, tuple) and len(f) == 5 else None


def load(season):
    d = os.path.join(CACHE, season)
    t = {name: pd.read_pickle(os.path.join(d, f'{name}.pkl')) for name in ['possessions', 'stints', 'shots', 'fts', 'tovs', 'rebs', 'fouls']}
    t['date'] = json.load(open(os.path.join(DATA, 'footprint', season, 'games.json')))['games']
    t['possessions']['off5'] = t['possessions']['off5'].map(five)
    t['possessions']['def5'] = t['possessions']['def5'].map(five)
    for side in ('a', 'b'):
        t['stints'][side] = t['stints'][side].map(five)
    return t


def stints_of(t):
    """{player: {team: {from, to}}} for players who played for more than one team: the
    dates of his first and last game for each, the first team's from and the last's to
    open, as lib/stints.js stintsOf has them."""
    st = t['stints']
    rows = pd.concat([pd.DataFrame({'g': st['g'], 'team': st['team_a'], 'five': st['a']}),
                      pd.DataFrame({'g': st['g'], 'team': st['team_b'], 'five': st['b']})])
    rows = rows[rows['five'].notna()].explode('five').rename(columns={'five': 'pid'})
    rows['d'] = rows['g'].map(t['date'])
    span = rows.groupby(['pid', 'team'])['d'].agg(['min', 'max']).reset_index()
    out = {}
    for pid, g in span.groupby('pid'):
        if len(g) < 2:
            continue
        g = g.sort_values('min')
        s = {r.team: {'from': r.min, 'to': r.max} for r in g.itertuples()}
        s[g.iloc[0]['team']]['from'] = None
        s[g.iloc[-1]['team']]['to'] = None
        out[pid] = s
    return out


def chunks_of(dates, stints, team):
    """The team's game dates (sorted) cut where a traded player joined or left it, as
    lib/stints.js chunkDates cuts them: {date: chunk index}."""
    cuts = set()
    for s in stints.values():
        st = s.get(team)
        if not st:
            continue
        if st['from']:
            cuts.add(st['from'])
        after = next((d for d in dates if st['to'] and d > st['to']), None)
        if after:
            cuts.add(after)
    out, k = {}, -1
    for d in dates:
        if k < 0 or d in cuts:
            k += 1
        out[d] = k
    return out


def zones(s):
    """Each shot's 2-pt zone masks, as pbpstats draws them: at the rim within AT_RIM_FT, short
    mid-range out to SHORT_MID_FT (straight-line distance)."""
    two = s['value'] == 2
    dist = (s['x'] ** 2 + s['y'] ** 2) ** 0.5
    rim = two & (dist <= 10 * AT_RIM_FT)
    short = two & ~rim & (dist <= 10 * SHORT_MID_FT)
    return two, rim, short


def fp_zones(s):
    """Each shot's Footprint zone: 'rim' (a two under RIM_FT), 'paint' (a two out to
    SHORT_MID_FT), 'long' (a longer two) or 'three'."""
    dist = (s['x'] ** 2 + s['y'] ** 2) ** 0.5
    return np.where(s['value'] != 2, 'three', np.where(dist < 10 * RIM_FT, 'rim', np.where(dist <= 10 * SHORT_MID_FT, 'paint', 'long')))


def runouts(t):
    """The runout possessions' ids (RUNOUT_S): begun by a steal, with a shot or a free throw
    trip, the first of them (the possession's first action) within RUNOUT_S seconds."""
    p = t['possessions']
    tried = set(t['shots']['poss']) | set(t['fts']['poss'])
    fast = (p['start_reason'] == 'steal') & (p['start'] - p['first_act'] <= RUNOUT_S)
    return set(p.loc[fast & p['id'].isin(tried), 'id'])


def rebounds(t):
    """The rebounds pbpstats counts: all but a team rebound on a possession that ends the
    period, a placeholder after a last-second miss (keeping it put OREB 8% over pbpstats;
    dropping every team rebound, 18% under)."""
    rb = t['rebs']
    end = t['possessions'].set_index('id')['end']
    return rb[~((rb['rebounder'] == '') & (rb['poss'].map(end) == 0))]


def zone_fts(t):
    """The made free throws of each trip (aligned with t['fts']) that count with the rim and
    with paint extended. An and-one goes with its make's zone (the same shooter's last make
    in the trip's possession or, failing that, the one before). A two-shot shooting-foul
    trip fouled a missed two, which has no location: its makes are split by where the
    shooter's and-ones (fouled twos that do) were that season, blended with the league's
    (PRIOR). Bonus, flagrant, clear-path and three-shot trips count with neither. Also
    (rim, paint, (and-ones tied to a make, and-ones), the league's split of fouled twos)."""
    s, f = t['shots'], t['fts']
    zone = fp_zones(s)
    made = s['made'].astype(bool).values
    last = (s[made].assign(zone=zone[made]).sort_values('t', ascending=False)
            .drop_duplicates(['poss', 'shooter'], keep='last').set_index(['poss', 'shooter'])['zone'].to_dict())
    and1 = (f['kind'] == 'and1').values
    hit = [last.get((p, sh), last.get((p - 1, sh))) if a else None for a, p, sh in zip(and1, f['poss'], f['shooter'])]
    fouled = pd.DataFrame({'shooter': f['shooter'].values, 'zone': hit})
    fouled = fouled[fouled['zone'].isin(['rim', 'paint', 'long'])]
    league = fouled['zone'].value_counts(normalize=True).reindex(['rim', 'paint', 'long'], fill_value=0)
    own = fouled.groupby(['shooter', 'zone']).size().unstack(fill_value=0).reindex(columns=['rim', 'paint', 'long'], fill_value=0)
    share = own.add(PRIOR * league, axis=1).div(own.sum(axis=1) + PRIOR, axis=0)
    two_shot = ((f['kind'] == 'shooting') & (f['fta'] == 2)).values

    def part(z):
        split = f['shooter'].map(share[z]).fillna(league[z]).values
        return pd.Series(f['ftm'].values * np.where(two_shot, split, np.array([h == z for h in hit], dtype=float)), index=f.index)
    return part('rim'), part('paint'), (sum(h is not None for h in hit), int(and1.sum())), league.round(3).to_dict()


def events(t, rimft, paintft):
    """Every counted event as (poss, team credited, field, n); `rimft`, `paintft` from
    zone_fts."""
    s, f, tv, rb, fo = t['shots'], t['fts'], t['tovs'], rebounds(t), t['fouls']
    poss = t['possessions'].set_index('id')

    def other(team, p):
        off, dfn = poss.loc[p.values, 'off'].values, poss.loc[p.values, 'def'].values
        return np.where(off == team.values, dfn, off)
    made = s['made'].astype(bool)
    two, rim, short = zones(s)
    long_ = two & ~rim & ~short
    corner = s['zone'] == 'corner3'
    zone = fp_zones(s)
    parts = []

    def add(p, team, field, n):
        parts.append(pd.DataFrame({'poss': p.values, 'team': team, 'field': field, 'n': n.values if hasattr(n, 'values') else n}))
    for field, mask, ok in [('FG2', two, True), ('FG3', ~two, True), ('AtRimFG', rim, True), ('ShortMidRangeFG', short, True),
                            ('LongMidRangeFG', long_, True), ('Corner3FG', corner, True),
                            ('RimFG', zone == 'rim', True), ('PaintFG', zone == 'paint', True)]:
        add(s['poss'][mask], s['team'][mask].values, field + 'A', 1)
        add(s['poss'][mask & made], s['team'][mask & made].values, field + 'M', 1)
    add(s['poss'], s['team'].values, 'Points', s['pts'])
    a = made & s['assister'].notna()
    add(s['poss'][a], s['team'][a].values, 'Assists', 1)
    b = s['blocker'].notna()
    add(s['poss'][b], other(s['team'][b], s['poss'][b]), 'Blocks', 1)
    add(f['poss'], f['team'].values, 'Points', f['ftm'])
    add(f['poss'], f['team'].values, 'FTA', f['fta'])
    add(f['poss'], f['team'].values, 'RimFTM', rimft)
    add(f['poss'], f['team'].values, 'PaintFTM', paintft)
    # Runouts: the possessions, and their rim and paint makes and free throws.
    run = runouts(t)
    rp = poss.loc[sorted(run)]
    add(pd.Series(rp.index), rp['off'].astype(str).values, 'RunoutPoss', 1)
    ran = s['poss'].isin(run) & made
    for field, z in (('RunoutRimFGM', 'rim'), ('RunoutPaintFGM', 'paint')):
        add(s['poss'][ran & (zone == z)], s['team'][ran & (zone == z)].values, field, 1)
    fr = f['poss'].isin(run)
    add(f['poss'][fr], f['team'][fr].values, 'RunoutRimFTM', rimft[fr])
    add(f['poss'][fr], f['team'][fr].values, 'RunoutPaintFTM', paintft[fr])
    add(tv['poss'], tv['team'].values, 'Turnovers', 1)
    live = tv['live'] == 1
    add(tv['poss'][live], tv['team'][live].values, 'LiveBallTurnovers', 1)
    stolen = tv['stealer'].notna()
    add(tv['poss'][stolen], other(tv['team'][stolen], tv['poss'][stolen]), 'Steals', 1)
    add(rb['poss'], rb['team'].values, rb['oreb'].map({1: 'OffRebounds', 0: 'DefRebounds'}).values, 1)
    pf = ~fo['sub'].isin(TECHNICAL)
    add(fo['poss'][pf], fo['team'][pf].values, 'Fouls', 1)
    charge = tv['sub'] == 'Offensive Foul Turnover'
    add(tv['poss'][charge], tv['team'][charge].values, 'Fouls', 1)
    ev = pd.concat(parts, ignore_index=True)
    ev['team'] = ev['team'].astype(str)
    return ev


def own_events(t, rimft):
    """Each shooter's own counts (OWN's fields) as (poss, team, pid, field, n)."""
    s, f = t['shots'], t['fts']
    made = s['made'].astype(bool)
    two = s['value'] == 2
    rim = fp_zones(s) == 'rim'
    parts = []

    def add(df, field, n):
        parts.append(pd.DataFrame({'poss': df['poss'].values, 'team': df['team'].astype(str).values, 'pid': df['shooter'].astype(str).values,
                                   'field': field, 'n': n.values if hasattr(n, 'values') else n}))
    add(s[two], 'FG2A', 1)
    add(s[two & made], 'FG2M', 1)
    add(s[~two], 'FG3A', 1)
    add(s[~two & made], 'FG3M', 1)
    add(s[rim & made], 'RimFGM', 1)
    add(s, 'Points', s['pts'])
    add(f, 'Points', f['ftm'])
    add(f, 'FTA', f['fta'])
    add(f, 'RimFTM', rimft)
    ev = pd.concat(parts, ignore_index=True)
    return ev[ev['n'] != 0]


def own_rows(p):
    """A lineup's own-count rows, compact: trailing zeros dropped, 0 for a player with none,
    None when no one has any."""
    rows = []
    for r in p:
        while r and r[-1] == 0:
            r = r[:-1]
        rows.append(r or 0)
    return rows if any(rows) else None


def team_docs(season, t):
    """{team: doc} in scripts/lineups.js's chunked shape, and the season's stints."""
    p = t['possessions']
    counted = set(t['shots']['poss']) | set(t['fts']['poss']) | set(t['tovs']['poss'])
    stints = stints_of(t)
    date = t['date']
    games = {team: sorted({date[g] for g in p.loc[(p['off'] == team) | (p['def'] == team), 'g']}) for team in sorted(set(p['off']) | set(p['def']))}
    chunk = {team: chunks_of(ds, stints, team) for team, ds in games.items()}
    # Each possession's two sides: the team, its five, the opponent and its five.
    sides = pd.concat([
        pd.DataFrame({'poss': p['id'], 'g': p['g'], 'team': p['off'].astype(str), 'five': p['off5'], 'opp': p['def'].astype(str), 'opp5': p['def5'], 'off': 1, 'pts': p['pts']}),
        pd.DataFrame({'poss': p['id'], 'g': p['g'], 'team': p['def'].astype(str), 'five': p['def5'], 'opp': p['off'].astype(str), 'opp5': p['off5'], 'off': 0, 'pts': -p['pts']}),
    ], ignore_index=True)
    sides = sides[sides['five'].notna() & sides['opp5'].notna()]
    sides['k'] = [chunk[team][date[g]] for team, g in zip(sides['team'], sides['g'])]
    sides['ok'] = [chunk[opp][date[g]] for opp, g in zip(sides['opp'], sides['g'])]
    per = {}

    def row(team, k, f):
        key = (team, k, f)
        if key not in per:
            per[key] = {'seconds': 0.0, 'offPoss': 0, 'defPoss': 0, 'plusMinus': 0, 't': [0] * len(FIELDS), 'o': [0] * len(FIELDS),
                        'p': [[0] * len(OWN) for _ in range(5)]}
        return per[key]
    st = t['stints']
    for g, ta, a, tb, b, sec in zip(st['g'], st['team_a'], st['a'], st['team_b'], st['b'], st['seconds']):
        for team, f in ((str(ta), a), (str(tb), b)):
            if f is not None:
                row(team, chunk[team][date[g]], f)['seconds'] += sec
    c = sides[sides['poss'].isin(counted)]
    for team, k, f, off, pts in zip(c['team'], c['k'], c['five'], c['off'], c['pts']):
        r = row(team, k, f)
        r['offPoss' if off else 'defPoss'] += 1
        r['plusMinus'] += int(pts)
    rimft, paintft, (tied, and1s), league = zone_fts(t)
    print(f'{season}: and-ones tied to a make {tied}/{and1s}; fouled twos by zone {league}')
    ev = events(t, rimft, paintft).merge(sides[['poss', 'team', 'k', 'five', 'opp', 'ok', 'opp5']], on=['poss', 'team'])
    idx = {name: i for i, name in enumerate(FIELDS)}
    sums = ev.groupby(['team', 'k', 'five', 'field'])['n'].sum()
    for (team, k, f, field), n in sums.items():
        row(team, k, f)['t'][idx[field]] += float(n)
    sums = ev.groupby(['opp', 'ok', 'opp5', 'field'])['n'].sum()
    for (team, k, f, field), n in sums.items():
        row(team, k, f)['o'][idx[field]] += float(n)
    # Each shooter's own counts, in his row of the five he shot in. One credited to a player
    # not in the possession's five (a substitution before free throws) stays with the team
    # only; counted.
    own = own_events(t, rimft).merge(sides[['poss', 'team', 'k', 'five']], on=['poss', 'team'])
    oidx = {name: i for i, name in enumerate(OWN)}
    stray = 0
    for (team, k, f, pid, field), n in own.groupby(['team', 'k', 'five', 'pid', 'field'])['n'].sum().items():
        if pid in f:
            row(team, k, f)['p'][f.index(pid)][oidx[field]] += float(n)
        elif field == 'Points':
            stray += int(n)
    print(f'{season}: points not placed with their shooter {stray} of {int(own.loc[own["field"] == "Points", "n"].sum())}')
    lineups = {}

    def kept(names, xs):
        return [round(x, 2) if name in SPLIT else int(round(x)) for name, x in zip(names, xs)]
    for (team, k, f), v in per.items():
        l = {'ids': list(f), 'seconds': round(v['seconds'], 1), 'offPoss': v['offPoss'], 'defPoss': v['defPoss'],
             'plusMinus': v['plusMinus'], 't': kept(FIELDS, v['t']), 'o': kept(FIELDS, v['o'])}
        p = own_rows([kept(OWN, r) for r in v['p']])
        if p:
            l['p'] = p
        lineups.setdefault((team, k), []).append(l)
    docs = {}
    for team, ds in games.items():
        out = []
        for k in sorted(set(chunk[team].values())):
            days = [d for d in ds if chunk[team][d] == k]
            out.append({'from': days[0], 'to': days[-1], 'lineups': sorted(lineups.get((team, k), []), key=lambda l: -l['seconds'])})
        docs[team] = {'season': season, 'team': team, 'source': 'pbp', 'fields': FIELDS, 'own': OWN, 'chunks': out}
    return docs, stints


def player_totals(t):
    """Each player's own rates, as scripts/player-totals.js keeps them from pbpstats."""
    p = t['possessions']
    counted = set(t['shots']['poss']) | set(t['fts']['poss']) | set(t['tovs']['poss'])
    st = t['stints']
    secs = {}
    for a, b, sec in zip(st['a'], st['b'], st['seconds']):
        for f in (a, b):
            for pid in f or ():
                secs[pid] = secs.get(pid, 0.0) + sec
    c = p[p['id'].isin(counted) & p['def5'].notna()]
    def_poss = c['def5'].explode().value_counts().to_dict()
    # Rebound chances on missed field goals with him on the floor, at each end.
    rb = rebounds(t)
    rb = rb[rb['miss'] == 'fg'].merge(p[['id', 'off', 'off5', 'def5']], left_on='poss', right_on='id')
    rb = rb[rb['off5'].notna() & rb['def5'].notna()]
    chances_off = rb['off5'].explode().value_counts().to_dict()
    chances_def = rb['def5'].explode().value_counts().to_dict()
    oreb = rb[rb['oreb'] == 1]['rebounder'].astype(str).value_counts().to_dict()
    dreb = rb[rb['oreb'] == 0]['rebounder'].astype(str).value_counts().to_dict()
    s = t['shots']
    blocks = s['blocker'].dropna().astype(str).value_counts().to_dict()
    corner = s[s['zone'] == 'corner3']['shooter'].astype(str).value_counts().to_dict()
    fo = t['fouls']
    shooting = fo[fo['sub'] == 'Shooting']['fouler'].astype(str).value_counts().to_dict()
    out = {}
    for pid, sec in secs.items():
        minutes = sec / 60
        dp = def_poss.get(pid, 0)
        out[pid] = {
            'minutes': round(minutes),
            'blocksPer100': 100 * blocks.get(pid, 0) / dp if dp else 0,
            'orebPct': oreb.get(pid, 0) / chances_off[pid] if chances_off.get(pid) else 0,
            'drebPct': dreb.get(pid, 0) / chances_def[pid] if chances_def.get(pid) else 0,
            'shootingFoulsPer100': 100 * shooting.get(pid, 0) / dp if dp else 0,
            'corner3PAPer36': 36 * corner.get(pid, 0) / minutes if minutes else 0,
        }
    return out


def pbpstats_docs(season):
    for folder in (os.path.join(DATA, 'seasons', season, 'lineups'), os.path.join(DATA, 'lineups')):
        if not os.path.isdir(folder):
            continue
        docs = [json.load(open(os.path.join(folder, f))) for f in sorted(os.listdir(folder)) if f.endswith('.json')]
        if docs and docs[0]['season'] == season and docs[0].get('fields'):
            return {d['team']: d for d in docs}
    return None


def totals(doc):
    """A team's season totals by field name: its own counts, and possessions."""
    t = dict.fromkeys(doc['fields'], 0)
    poss = {'OffPoss': 0, 'DefPoss': 0}
    for c in doc.get('chunks') or [{'lineups': doc['lineups']}]:
        for l in c['lineups']:
            for name, n in zip(doc['fields'], l['t']):
                t[name] += n
            poss['OffPoss'] += l['offPoss']
            poss['DefPoss'] += l['defPoss']
    return {**t, **poss}


def check(season, docs, t):
    theirs = pbpstats_docs(season)
    if not theirs:
        sys.exit(f'no pbpstats lineups with counts for {season}')
    print(f'{season}: ours vs pbpstats, league totals and the largest team gap (team counts)')
    ours_t = {team: totals(d) for team, d in docs.items()}
    their_t = {team: totals(d) for team, d in theirs.items()}
    teams = sorted(set(ours_t) & set(their_t))
    shared = [f for f in FIELDS + ['OffPoss', 'DefPoss'] if f in their_t[teams[0]]]
    for field in shared:
        a = sum(ours_t[x][field] for x in teams)
        b = sum(their_t[x][field] for x in teams)
        worst = max(teams, key=lambda x: abs(ours_t[x][field] - their_t[x][field]))
        print(f'  {field:18} {a:8} {b:8} {100 * (a - b) / b if b else 0:+6.2f}%   worst {worst} {ours_t[worst][field] - their_t[worst][field]:+d}')
    # Rebounds under each rule, every rebound row in the season (pbpstats: the totals above).
    rb = t['rebs']
    rules = [('every row', rb), ('pbpstats rule (kept)', rebounds(t)), ('player-credited only', rb[rb['rebounder'] != ''])]
    for field, flag in (('OffRebounds', 1), ('DefRebounds', 0)):
        b = sum(their_t[x][field] for x in teams)
        print(f'  {field} by rule: ' + ', '.join(f'{name} {int((r["oreb"] == flag).sum())} ({100 * ((r["oreb"] == flag).sum() - b) / b:+.1f}%)' for name, r in rules))
    # Each lineup's players' own counts add up to the team's.
    exact = total = 0
    gap = dict.fromkeys(OWN, 0)
    for d in docs.values():
        for c in d['chunks']:
            for l in c['lineups']:
                total += 1
                rows = [r or [] for r in l.get('p', [0] * 5)]
                ok = True
                for i, name in enumerate(OWN):
                    mine = sum(r[i] if i < len(r) else 0 for r in rows)
                    team = l['t'][FIELDS.index(name)]
                    gap[name] += team - mine
                    ok = ok and abs(mine - team) < 0.05
                exact += ok
    print(f'  own counts add up to the team in {exact}/{total} lineups; team less own, summed: { {k: round(v, 2) for k, v in gap.items()} }')


def write(season, docs, stints, players):
    folder = os.path.join(DATA, 'footprint', season)
    os.makedirs(os.path.join(folder, 'lineups'), exist_ok=True)
    for team, doc in docs.items():
        with open(os.path.join(folder, 'lineups', f'{team}.json'), 'w') as f:
            json.dump(doc, f, separators=(',', ':'))
            f.write('\n')
    with open(os.path.join(folder, 'stints.json'), 'w') as f:
        json.dump({'season': season, 'players': stints}, f, separators=(',', ':'))
        f.write('\n')
    rounded = {pid: {k: (v if k == 'minutes' else round(v, 5)) for k, v in r.items()} for pid, r in players.items()}
    with open(os.path.join(folder, 'player-totals.json'), 'w') as f:
        json.dump({'season': season, 'source': 'pbp', 'players': rounded}, f, separators=(',', ':'))
        f.write('\n')
    n = sum(len(c['lineups']) for d in docs.values() for c in d['chunks'])
    print(f'{season}: {len(docs)} teams, {n} lineup chunks, {len(stints)} traded players, {len(players)} players')


def main():
    args = sys.argv[1:]
    checking = '--check' in args
    for season in [a for a in args if not a.startswith('--')]:
        t = load(season)
        docs, stints = team_docs(season, t)
        if checking:
            check(season, docs, t)
        else:
            write(season, docs, stints, player_totals(t))


if __name__ == '__main__':
    main()
