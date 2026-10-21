"""WOWY rows from the possession cache (build.py), in the shape scripts/lonestar.js stores
from pbpstats' get-wowy-stats Type=Player: each player's own totals in a team's minutes
with a set of its players off, on (at least one of them) or all on. The Lonestar pull's
second source, for when pbpstats is down or slow (scripts/lonestar.js --source=pbp).

  python3 analysis/footprint/wowy.py <season> < spec.json > rows.json

spec: {"TEAM": [["id"], ["id", "id"], ...]}, the sets wanted per team ({} for none).
Prints {"fields", "league": {"ts", "ortg", "rimAstShare"}, "teams": {"TEAM": {"base",
"sets": {"id,id": {"off", "on", "both"}}}}}, where each rows object maps a player id to
his FIELDS values (a pair's "both": all of the set on; one player's set has none).

Possessions count as pbpstats counts them (those with a shot, a free throw or a
turnover), garbage time and heaves included. Checked against pbpstats (2024-25 Knicks):
minutes match exactly; field goals, threes, assists, turnovers, offensive rebounds and
opponents' points within one or two; free throws run low by the technicals, which the
cache leaves out (they belong to no possession: Brunson 428 vs 448). pbpstats' 2025-26
totals don't balance (1,850 more defensive possessions than offensive league-wide), so
that season differs from it where it is off.
"""
import json
import os
import sys

import pandas as pd

FIELDS = ['Minutes', 'OffPoss', 'DefPoss', 'PlusMinus', 'OpponentPoints', 'Points', 'Assists',
          'AtRimAssists', 'FG2A', 'FG3A', 'FG3M', 'FTA', 'FtPoints', 'OffRebounds', 'Turnovers', 'TsPct']
CACHE = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'cache', 'pbp')
# pbpstats' at-rim shots: within 4 ft reproduces its at-rim assists (2024-25 Knicks: Hart
# 180 vs 179, Brunson 221 vs 220, Towns 126 vs 124); the cache's rim zone (6 ft) runs 12% over.
AT_RIM_FT = 4


def load(season):
    """The season's tables, each row tied to a team and the five it had on the floor."""
    d = os.path.join(CACHE, season)
    p = pd.read_pickle(os.path.join(d, 'possessions.pkl'))
    st = pd.read_pickle(os.path.join(d, 'stints.pkl'))
    # A team's side of each possession: its five, whether it had the ball, the points.
    sides = pd.concat([
        pd.DataFrame({'poss': p['id'], 'team': p['off'].astype(str), 'five': p['off5'], 'off': 1, 'pts': p['pts']}),
        pd.DataFrame({'poss': p['id'], 'team': p['def'].astype(str), 'five': p['def5'], 'off': 0, 'pts': p['pts']}),
    ], ignore_index=True)
    stints = pd.concat([
        pd.DataFrame({'team': st['team_a'].astype(str), 'five': st['a'], 'seconds': st['seconds']}),
        pd.DataFrame({'team': st['team_b'].astype(str), 'five': st['b'], 'seconds': st['seconds']}),
    ], ignore_index=True)
    five_of = sides.set_index(['poss', 'team'])['five']

    # Each player event as (team, player, possession, counts), with the team's five.
    def events(t, pid, counts):
        e = t[t[pid].notna() & (t[pid].astype(str) != '')]
        out = pd.DataFrame({'poss': e['poss'].values, 'team': e['team'].astype(str).values, 'pid': e[pid].astype(str).values})
        for k, v in counts(e).items():
            out[k] = v.values if hasattr(v, 'values') else v
        return out

    shots = pd.read_pickle(os.path.join(d, 'shots.pkl'))
    fts = pd.read_pickle(os.path.join(d, 'fts.pkl'))
    tovs = pd.read_pickle(os.path.join(d, 'tovs.pkl'))
    rebs = pd.read_pickle(os.path.join(d, 'rebs.pkl'))
    ev = pd.concat([
        events(shots, 'shooter', lambda e: {
            'Points': e['pts'], 'FG2A': (e['value'] == 2).astype(int), 'FG3A': (e['value'] == 3).astype(int),
            'FG3M': ((e['value'] == 3) & e['made'].astype(bool)).astype(int)}),
        events(shots, 'assister', lambda e: {'Assists': 1, 'AtRimAssists': ((e['x'] ** 2 + e['y'] ** 2) ** 0.5 <= 10 * AT_RIM_FT).astype(int)}),
        events(fts, 'shooter', lambda e: {'Points': e['ftm'], 'FTA': e['fta'], 'FtPoints': e['ftm']}),
        events(tovs, 'pid', lambda e: {'Turnovers': 1}),
        events(rebs[rebs['oreb'] == 1], 'rebounder', lambda e: {'OffRebounds': 1}),
    ], ignore_index=True).fillna(0)
    ev['five'] = five_of.reindex(pd.MultiIndex.from_arrays([ev['poss'], ev['team']])).values
    ev = ev[ev['five'].notna()]
    # A possession counts as pbpstats counts it: one with a shot, a free throw or a
    # turnover. The rest (about 100 a team a season, nearly all running out a period's
    # last seconds, none scoring) would add 1-2% to possessions and pull every rating
    # down; without them each team's 2024-25 possessions match pbpstats' to a median of 0.
    counted = set(shots['poss']) | set(fts['poss']) | set(tovs['poss'])
    return sides[sides['poss'].isin(counted)], stints, ev


def rows(sides, stints, ev, keep):
    """Each player's FIELDS over the team-possessions, stints and events whose five passes
    `keep` (a boolean per five), as {pid: [values]}."""
    def on_floor(t, cols):
        t = t[keep(t['five'])]
        x = t.assign(pid=t['five']).explode('pid')
        return x.groupby('pid')[cols].sum()

    s = sides.assign(OffPoss=sides['off'], DefPoss=1 - sides['off'],
                     tp=sides['pts'] * sides['off'], op=sides['pts'] * (1 - sides['off']))
    a = on_floor(s, ['OffPoss', 'DefPoss', 'tp', 'op'])
    m = on_floor(stints, ['seconds'])
    counts = ['Points', 'Assists', 'AtRimAssists', 'FG2A', 'FG3A', 'FG3M', 'FTA', 'FtPoints', 'OffRebounds', 'Turnovers']
    e = ev[keep(ev['five'])].groupby('pid')[counts].sum()
    t = a.join(m, how='outer').join(e, how='left').fillna(0)
    out = {}
    for pid, r in t.iterrows():
        tsa = r['FG2A'] + r['FG3A'] + 0.44 * r['FTA']
        vals = {
            'Minutes': round(r['seconds'] / 60, 2), 'OffPoss': int(r['OffPoss']), 'DefPoss': int(r['DefPoss']),
            'PlusMinus': int(r['tp'] - r['op']), 'OpponentPoints': int(r['op']),
            'TsPct': round(r['Points'] / (2 * tsa), 4) if tsa else None,
            **{k: int(r[k]) for k in counts},
        }
        out[str(pid)] = [vals[f] for f in FIELDS]
    return out


def league(sides, ev):
    """The league values the pull writes to league.json: the teams' TS% averaged, ORTG, and
    the share of assists at the rim."""
    pts = ev.groupby('team')['Points'].sum()
    tsa = ev.groupby('team')[['FG2A', 'FG3A', 'FTA']].sum()
    ts = pts / (2 * (tsa['FG2A'] + tsa['FG3A'] + 0.44 * tsa['FTA']))
    off = sides[sides['off'] == 1]
    return {'ts': float(ts.mean()), 'ortg': float(100 * off['pts'].sum() / len(off)),
            'rimAstShare': float(ev['AtRimAssists'].sum() / ev['Assists'].sum())}


def main():
    season = sys.argv[1]
    spec = json.load(sys.stdin)
    sides, stints, ev = load(season)
    teams = {}
    for team in sorted(sides['team'].unique()):
        ts, tt, te = sides[sides['team'] == team], stints[stints['team'] == team], ev[ev['team'] == team]
        doc = {'base': rows(ts, tt, te, lambda fives: fives.map(lambda f: True)), 'sets': {}}
        for ids in spec.get(team, []):
            want = set(ids)
            # How many of the set the five has; a stretch with no five on record (-1)
            # passes no filter.
            n = lambda fives: fives.map(lambda f: len(want.intersection(f)) if isinstance(f, tuple) else -1)
            doc['sets'][','.join(ids)] = {
                'off': rows(ts, tt, te, lambda fives: n(fives) == 0),
                'on': rows(ts, tt, te, lambda fives: n(fives) > 0),
                **({'both': rows(ts, tt, te, lambda fives: n(fives) == len(want))} if len(ids) > 1 else {}),
            }
        teams[team] = doc
    json.dump({'fields': FIELDS, 'league': league(sides, ev), 'teams': teams}, sys.stdout)


if __name__ == '__main__':
    main()
