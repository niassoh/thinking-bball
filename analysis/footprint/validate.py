"""Checks a built season against pbpstats' lineup totals (data/lineups, or
data/seasons/<season>/lineups for past seasons):
- floor minutes per (team, player): the rebuilt floor vs the pbpstats lineups;
- possessions per team: ours (garbage time included, nothing excluded) vs the sum of
  pbpstats' offensive possessions.

  python3 analysis/footprint/validate.py 2025-26
"""
import glob
import json
import os
import sys
from collections import defaultdict

import pandas as pd

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
DATA = os.path.join(ROOT, 'data')


def pbpstats(season):
    current = json.load(open(glob.glob(os.path.join(DATA, 'lineups', '*.json'))[0]))['season']
    folder = os.path.join(DATA, 'lineups') if current == season else os.path.join(DATA, 'seasons', season, 'lineups')
    seconds, poss = defaultdict(float), defaultdict(float)
    for f in glob.glob(os.path.join(folder, '*.json')):
        d = json.load(open(f))
        lineups = d.get('lineups') or [l for c in d['chunks'] for l in c['lineups']]
        for l in lineups:
            poss[d['team']] += l['offPoss']
            for pid in l['ids']:
                seconds[(d['team'], pid)] += l['seconds']
    return seconds, poss


def main(season):
    cache = os.path.join(DATA, 'cache', 'pbp', season)
    floor = pd.read_pickle(os.path.join(cache, 'floor.pkl'))
    ours = {(r.team, r.pid): r.seconds for r in floor.itertuples()}
    ref, ref_poss = pbpstats(season)
    total = matched = 0
    worst = []
    for k, s in ref.items():
        total += s
        matched += min(s, ours.get(k, 0))
        if s >= 300 * 60:
            worst.append((abs(ours.get(k, 0) - s) / s, k, s / 60, ours.get(k, 0) / 60))
    worst.sort(reverse=True)
    errs = sorted(w[0] for w in worst)
    print(f'{season} floor minutes: {100 * matched / total:.2f}% of pbpstats player-minutes matched; '
          f'players with 300+ min: median error {100 * errs[len(errs) // 2]:.2f}%, '
          f'90th pct {100 * errs[int(len(errs) * .9)]:.2f}%, worst {100 * errs[-1]:.2f}%')
    for w in worst[:5]:
        print(f'  {w[1]}: pbpstats {w[2]:.0f} min, rebuilt {w[3]:.0f} min')
    poss = pd.read_pickle(os.path.join(cache, 'possessions.pkl'))
    poss = poss[poss['excluded'] != 'empty']
    mine = poss.groupby('off').size()
    diffs = sorted((100 * (mine.get(t, 0) - p) / p, t) for t, p in ref_poss.items())
    print(f'  possessions per team vs pbpstats offPoss: {diffs[0][0]:+.2f}% ({diffs[0][1]}) to '
          f'{diffs[-1][0]:+.2f}% ({diffs[-1][1]}), league {100 * (len(poss) - sum(ref_poss.values())) / sum(ref_poss.values()):+.2f}%')


if __name__ == '__main__':
    for s in sys.argv[1:]:
        main(s)
