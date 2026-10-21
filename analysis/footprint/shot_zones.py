"""Each player's shots by zone in a season, from the possession cache, for the seasons the
stats sheet only has its historical tab for (lib/profile.js fills their rim, mid-range
and corner-three columns from these).

  python3 analysis/footprint/shot_zones.py 1996-97 ... 1999-00 [--out DIR]

Writes <DIR or data/history/shot-zones>/<season>.json: {season, fields, players: {nbaId:
[rim FGA, rim FGM, mid-range FGA, mid-range FGM, corner 3PA, 3PA]}}. The sheet's zones
(pbpstats'): the rim is a two within 4 ft, mid-range every other two; corner threes are
possessions.py's (from the straight part of the line). With these, 2024-25's rim and
mid-range attempts per 75 land within 0.03 of the sheet's at the median, their FG% within
0.2 (docs/data-pull-audit.md #129).
"""
import json
import math
import os
import sys

import pandas as pd

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
CACHE = os.path.join(ROOT, 'data', 'cache', 'pbp')
FIELDS = ['rimFGA', 'rimFGM', 'midFGA', 'midFGM', 'c3PA', 'fg3A']
RIM_FT = 4


def feet(x, y):
    """Distance from the basket; behind it only the sideways distance counts."""
    x, y = (0.0 if pd.isna(x) else x), (0.0 if pd.isna(y) else y)
    return (abs(x) if y < 0 else math.hypot(x, y)) / 10


def zones(season):
    s = pd.read_pickle(os.path.join(CACHE, season, 'shots.pkl'))
    s = s[s['shooter'] != ''].copy()
    s['rim'] = [v == 2 and feet(x, y) <= RIM_FT for x, y, v in zip(s['x'], s['y'], s['value'])]
    out = {}
    for pid, g in s.groupby('shooter'):
        twos = g[g['value'] == 2]
        rim, mid = twos[twos['rim']], twos[~twos['rim']]
        threes = g[g['value'] == 3]
        out[str(pid)] = [len(rim), int(rim['made'].sum()), len(mid), int(mid['made'].sum()),
                         int((threes['zone'] == 'corner3').sum()), len(threes)]
    return out


def main(args):
    out_dir = os.path.join(ROOT, 'data', 'history', 'shot-zones')
    if '--out' in args:
        out_dir = args[args.index('--out') + 1]
        args = [a for a in args if a not in ('--out', out_dir)]
    os.makedirs(out_dir, exist_ok=True)
    for season in args:
        players = zones(season)
        with open(os.path.join(out_dir, f'{season}.json'), 'w') as f:
            json.dump({'season': season, 'fields': FIELDS, 'players': players}, f, separators=(',', ':'))
            f.write('\n')
        print(f'{season}: {len(players)} players')


if __name__ == '__main__':
    main(sys.argv[1:])
