"""Box-score priors: what a player's own box profile says each channel should be.

Ridge shrinks every player toward a prior. With a zero prior, two players who almost
always share the floor (Curry and Green) split their joint effect about evenly, so the
non-shooter inherits the shooter's spacing. Shrinking toward what each one's own box
profile predicts breaks the tie the way the box score does: the one who takes the
threes is expected to move the team's three-point rate.

box() builds per-100 profiles from the possession tables; the prior model for a channel
(and side) is a weighted ridge from those features to the zero-prior adjusted estimates,
fit on past seasons (calibrate.py) and applied in the footprint window.
"""
import json
import os

import numpy as np
import pandas as pd

DATA = os.path.join(os.path.dirname(__file__), '..', '..', 'data')
FEATURES = ['rim_fga', 'three_pa', 'mid_fga', 'trips', 'tov', 'ast', 'ast_rim', 'ast_three',
            'oreb', 'dreb', 'blk', 'stl', 'sfoul', 'make', 'guard', 'big']


def positions():
    pos = {}
    for b in json.load(open(os.path.join(DATA, 'bio.json'))).values():
        if b.get('nbaId') and b.get('position'):
            pos[b['nbaId']] = b['position']
    return pos


def box(d, values):
    """Per-player box profile over the loaded window (index = player id)."""
    p = d['possessions']
    off_n = pd.Series([pid for f in p['off5'] for pid in f]).value_counts()
    def_n = pd.Series([pid for f in p['def5'] for pid in f]).value_counts()
    s = d['shots']
    f = pd.DataFrame(index=off_n.index.union(def_n.index))
    f['off_poss'] = off_n.reindex(f.index).fillna(0)
    f['def_poss'] = def_n.reindex(f.index).fillna(0)
    first = s[s['putback'] == 0]
    f['rim_fga'] = first[first['zone'] == 'rim'].groupby('shooter').size()
    f['three_pa'] = s[s['value'] == 3].groupby('shooter').size()
    f['mid_fga'] = s[s['zone'].isin(['short_mid', 'long_mid'])].groupby('shooter').size()
    fts = d['fts'][d['fts']['kind'] != 'technical']
    f['trips'] = fts.groupby('shooter').size()
    f['tov'] = d['tovs'].groupby('pid').size()
    made = s[s['made']]
    f['ast'] = made.groupby('assister').size()
    f['ast_rim'] = made[made['zone'] == 'rim'].groupby('assister').size()
    f['ast_three'] = made[made['value'] == 3].groupby('assister').size()
    r = d['rebs']
    f['oreb'] = r[r['oreb'] == 1].groupby('rebounder').size()
    f['dreb'] = r[r['oreb'] == 0].groupby('rebounder').size()
    f['blk'] = s.groupby('blocker').size()
    f['stl'] = d['tovs'].groupby('stealer').size()
    fo = d['fouls']
    f['sfoul'] = fo[fo['sub'].str.lower().str.startswith('shooting')].groupby('fouler').size()
    xp = s['zone'].map(values['xpts'])
    s2 = s.assign(over=s['pts'] - xp)
    f['make_sum'] = s2.groupby('shooter')['over'].sum()
    f['fga'] = s.groupby('shooter').size()
    f = f.fillna(0.0)
    per_off = 100 / f['off_poss'].clip(lower=1)
    per_def = 100 / f['def_poss'].clip(lower=1)
    for c in ('rim_fga', 'three_pa', 'mid_fga', 'trips', 'tov', 'ast', 'ast_rim', 'ast_three', 'oreb'):
        f[c] = f[c] * per_off
    for c in ('dreb', 'blk', 'stl', 'sfoul'):
        f[c] = f[c] * per_def
    # Points over expectation per shot, shrunk toward 0 by 300 attempts.
    f['make'] = f['make_sum'] / (f['fga'] + 300)
    pos = positions()
    p_ = f.index.map(lambda i: pos.get(i, ''))
    f['guard'] = [float('G' in x and 'F' not in x) for x in p_]
    f['big'] = [float('C' in x) for x in p_]
    return f


class PriorModel:
    """Weighted ridge from standardized box features to an adjusted coefficient."""

    def __init__(self, lam=10.0):
        self.lam = lam

    def fit(self, feats, target, weight):
        X = feats[FEATURES].to_numpy(float)
        self.mu, self.sd = X.mean(axis=0), X.std(axis=0) + 1e-9
        Z = np.column_stack([np.ones(len(X)), (X - self.mu) / self.sd])
        W = np.asarray(weight, float)
        A = Z.T @ (Z * W[:, None]) + self.lam * np.diag([0] + [1] * len(FEATURES))
        self.coef = np.linalg.solve(A, Z.T @ (W * np.asarray(target, float)))
        return self

    def predict(self, feats):
        X = feats[FEATURES].to_numpy(float)
        Z = np.column_stack([np.ones(len(X)), (X - self.mu) / self.sd])
        return Z @ self.coef
