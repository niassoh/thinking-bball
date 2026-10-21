"""Five-man lineup totals per team-season from the rebuilt play-by-play, in the shape of
scripts/lineups.js's files (ids, seconds, offPoss, defPoss, plusMinus), for the seasons
the daily pbpstats pull doesn't cover: the profile's past seasons.

  python3 analysis/footprint/lineup_history.py [--playoffs] 2013-14 ... 2024-25
  python3 analysis/footprint/lineup_history.py --check [--playoffs] 2025-26

Writes data/history/lineups/<season>/<TEAM>.json (playoffs: data/history/playoffs/
lineups/<season>/), compact. Like pbpstats, every possession counts (garbage time too);
possessions where nothing happened before the period ended don't. --check compares a
season with the pbpstats files in data/lineups instead of writing.
"""
import glob
import json
import os
import sys
from collections import defaultdict

import pandas as pd

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
DATA = os.path.join(ROOT, 'data')
CACHE = os.path.join(DATA, 'cache', 'pbp')


def team_lineups(season, kind='regular'):
    """{team: [lineup, ...]} from a built season (most-played first)."""
    folder = os.path.join(CACHE, season + ('-po' if kind == 'playoffs' else ''))
    stints = pd.read_pickle(os.path.join(folder, 'stints.pkl'))
    poss = pd.read_pickle(os.path.join(folder, 'possessions.pkl'))
    per = defaultdict(lambda: {'seconds': 0.0, 'offPoss': 0, 'defPoss': 0, 'plusMinus': 0})
    for r in stints.itertuples():
        for team, five in ((r.team_a, r.a), (r.team_b, r.b)):
            if len(five) == 5:
                per[(team, five)]['seconds'] += r.seconds
    poss = poss[poss['excluded'] != 'empty']
    for off, dfn, o5, d5, pts in zip(poss['off'], poss['def'], poss['off5'], poss['def5'], poss['pts']):
        if o5 is None or d5 is None or len(o5) != 5 or len(d5) != 5:
            continue
        o, d = per[(off, tuple(sorted(o5)))], per[(dfn, tuple(sorted(d5)))]
        o['offPoss'] += 1
        o['plusMinus'] += int(pts)
        d['defPoss'] += 1
        d['plusMinus'] -= int(pts)
    teams = defaultdict(list)
    for (team, five), v in per.items():
        teams[team].append({'ids': list(five), 'seconds': round(v['seconds'], 1), 'offPoss': v['offPoss'],
                            'defPoss': v['defPoss'], 'plusMinus': v['plusMinus']})
    return {t: sorted(ls, key=lambda l: -l['seconds']) for t, ls in teams.items()}


def write(season, kind):
    folder = os.path.join(DATA, 'history', *(['playoffs'] if kind == 'playoffs' else []), 'lineups', season)
    os.makedirs(folder, exist_ok=True)
    teams = team_lineups(season, kind)
    for team, ls in teams.items():
        with open(os.path.join(folder, f'{team}.json'), 'w') as f:
            json.dump({'season': season, 'team': team, 'lineups': ls}, f, separators=(',', ':'))
            f.write('\n')
    print(f'{season}{" playoffs" if kind == "playoffs" else ""}: {len(teams)} teams, '
          f'{sum(len(v) for v in teams.values())} lineups')


def check(season, kind):
    """Ours vs the pbpstats lineup files for the same season."""
    folder = os.path.join(DATA, *(['playoffs'] if kind == 'playoffs' else []), 'lineups')
    ours = team_lineups(season, kind)
    sec_total = sec_matched = 0.0
    pm_rows = pm_equal = 0
    teams_off = []
    for f in glob.glob(os.path.join(folder, '*.json')):
        d = json.load(open(f))
        if d['season'] != season:
            continue
        mine = {tuple(l['ids']): l for l in ours.get(d['team'], [])}
        for l in d['lineups']:
            m = mine.get(tuple(l['ids']))
            sec_total += l['seconds']
            sec_matched += min(l['seconds'], m['seconds']) if m else 0
            if l['seconds'] >= 600:
                pm_rows += 1
                pm_equal += bool(m) and abs(m['plusMinus'] - l['plusMinus']) <= 2
        t_ref = sum(l['seconds'] for l in d['lineups'])
        t_mine = sum(l['seconds'] for l in ours.get(d['team'], []))
        if abs(t_ref - t_mine) > 60:
            teams_off.append((d['team'], round(t_ref / 60), round(t_mine / 60)))
    print(f'{season}{" playoffs" if kind == "playoffs" else ""} vs pbpstats: {100 * sec_matched / sec_total:.2f}% of lineup '
          f'seconds matched; lineups with 10+ min: plus-minus within 2 for {pm_equal} of {pm_rows} '
          f'({100 * pm_equal / max(pm_rows, 1):.1f}%); teams off by a minute+: {teams_off}')


if __name__ == '__main__':
    kind = 'playoffs' if '--playoffs' in sys.argv else 'regular'
    seasons = [s for s in sys.argv[1:] if not s.startswith('--')]
    for s in seasons:
        (check if '--check' in sys.argv else write)(s, kind)
