"""Adjusted footprint channels: ridge regression on possessions with both fives.

Every channel is an outcome measured on a unit of play (a possession, a rebound chance,
a shot) and regressed on who is on the floor: one column per player for the five on
offense and one per player for the five on defense, plus season intercepts, home court
and the score margin (trailing teams shoot more threes, leading teams slow down). A
player's offensive coefficient is how the outcome changes when he is on offense, given
the other nine players; his defensive coefficient, how the opponent's outcome changes
when he defends.

Coefficients are shrunk toward a prior (zero, or the box-score prior from priors.py)
with ridge penalties chosen by cross-validation over games, separately for the offense
and defense blocks (defense is noisier). Posterior SDs come from the ridge posterior
with the residual variance.
"""
import os

import numpy as np
import pandas as pd
import scipy.linalg as la
import scipy.sparse as sp

CACHE = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'cache', 'pbp')
MIN_POSS = 250  # possessions (offense + defense, in the window) for a player's own column
REPLACEMENT = '_replacement'


# ---------------------------------------------------------------------------------
# Data
# ---------------------------------------------------------------------------------

def load(seasons):
    """Possessions (kept: not garbage time, not excluded, both fives full) and the detail
    tables for a list of seasons, with possession ids made unique across seasons."""
    out = {k: [] for k in ('possessions', 'shots', 'fts', 'tovs', 'rebs', 'fouls')}
    offset = 0
    for s in seasons:
        folder = os.path.join(CACHE, s)
        for k in out:
            df = pd.read_pickle(os.path.join(folder, f'{k}.pkl'))
            if k == 'possessions':
                df['id'] += offset
            else:
                df['poss'] += offset
            out[k].append(df)
        offset = int(out['possessions'][-1]['id'].max()) + 1
    out = {k: pd.concat(v, ignore_index=True) for k, v in out.items()}
    p = out['possessions']
    full = p['off5'].map(lambda f: f is not None and len(f) == 5) & p['def5'].map(lambda f: f is not None and len(f) == 5)
    keep = full & ~p['garbage'] & (p['excluded'] == '')
    out['possessions'] = p[keep].set_index('id', drop=False)
    kept = set(out['possessions'].index)
    for k in ('shots', 'fts', 'tovs', 'rebs', 'fouls'):
        out[k] = out[k][out[k]['poss'].isin(kept)].reset_index(drop=True)
    return out


def per_possession(d):
    """Per-possession counts every possession-level channel is built from."""
    p = d['possessions']
    s = d['shots']
    first = s[s['putback'] == 0]
    cols = {}
    for name, mask in (('rim', first['zone'] == 'rim'), ('three', first['zone'].isin(['corner3', 'above_break3'])),
                       ('corner3', first['zone'] == 'corner3'), ('mid', first['zone'].isin(['short_mid', 'long_mid']))):
        cols[name] = first[mask].groupby('poss').size()
    cols['fga'] = s.groupby('poss').size()
    f = d['fts'][d['fts']['kind'] != 'technical']
    cols['trips'] = f.groupby('poss').size()
    cols['ftm'] = f.groupby('poss')['ftm'].sum()
    cols['fta'] = f.groupby('poss')['fta'].sum()
    t = d['tovs']
    cols['tov'] = t.groupby('poss').size()
    cols['tov_live'] = t[t['live'] == 1].groupby('poss').size()
    out = pd.DataFrame(index=p.index)
    for k, v in cols.items():
        out[k] = v.reindex(p.index).fillna(0.0)
    out['duration'] = (p['start'] - p['end']).clip(lower=0)
    return out


# ---------------------------------------------------------------------------------
# Design
# ---------------------------------------------------------------------------------

class Index:
    """Column index: players with enough possessions get their own offense and defense
    columns; the rest share a replacement column per side."""

    def __init__(self, possessions, min_poss=MIN_POSS):
        count = {}
        for col in ('off5', 'def5'):
            for five in possessions[col]:
                for pid in five:
                    count[pid] = count.get(pid, 0) + 1
        self.poss = count
        self.players = sorted(p for p, n in count.items() if n >= min_poss) + [REPLACEMENT]
        self.col = {p: i for i, p in enumerate(self.players)}
        self.n = len(self.players)
        self.seasons = sorted(possessions['season'].unique())

    def of(self, pid):
        return self.col.get(pid, self.col[REPLACEMENT])

    @property
    def width(self):
        # offense players, defense players, season intercepts, home, margin
        return 2 * self.n + len(self.seasons) + 2


def design(rows, idx):
    """Sparse design for rows carrying off5, def5, season, home, margin."""
    n = len(rows)
    # Offense sets may hold four (teammates of a shooter) or five players.
    off = [[idx.of(p) for p in five] for five in rows['off5']]
    dfn = [[idx.n + idx.of(p) for p in five] for five in rows['def5']]
    season = np.array([2 * idx.n + idx.seasons.index(s) for s in rows['season']], dtype=np.int64)
    home_col = 2 * idx.n + len(idx.seasons)
    r = np.concatenate([np.repeat(np.arange(n), [len(o) for o in off]), np.repeat(np.arange(n), [len(d) for d in dfn])])
    c = np.concatenate([np.fromiter((x for o in off for x in o), np.int64), np.fromiter((x for d in dfn for x in d), np.int64)])
    v = np.ones(len(c))
    # Pooled replacement players can appear more than once in a five; duplicates add up.
    X = sp.csr_matrix((v, (r, c)), shape=(n, idx.width))
    extra = sp.csr_matrix((np.concatenate([np.ones(n), rows['home'].to_numpy(float),
                                            np.clip(rows['margin'].to_numpy(float), -20, 20) / 10]),
                           (np.concatenate([np.arange(n)] * 3),
                            np.concatenate([season, np.full(n, home_col), np.full(n, home_col + 1)]))),
                          shape=(n, idx.width))
    return (X + extra).tocsr()


# ---------------------------------------------------------------------------------
# Ridge
# ---------------------------------------------------------------------------------

def penalties(idx, lam_off, lam_def):
    pen = np.zeros(idx.width)
    pen[:idx.n] = lam_off
    pen[idx.n:2 * idx.n] = lam_def
    return pen


def grams(X, y, w, groups=None):
    """X'WX and X'Wy, in total and per group (for cross-validation)."""
    Xw = X.multiply(w[:, None]).tocsr()
    G = (X.T @ Xw).toarray()
    b = Xw.T @ y
    parts = []
    if groups is not None:
        for g in np.unique(groups):
            m = groups == g
            Xg, Xwg = X[m], Xw[m]
            parts.append(((Xg.T @ Xwg).toarray(), Xwg.T @ y[m], m))
    return G, b, parts


def solve(G, b, pen, prior):
    A = G + np.diag(pen)
    rhs = b + pen * prior
    c = la.cho_factor(A, lower=True, check_finite=False)
    return la.cho_solve(c, rhs, check_finite=False), c


def cross_validate(X, y, w, idx, prior, groups, grid):
    """Weighted out-of-fold MSE for each (lam_off, lam_def); returns the best pair and
    the table."""
    G, b, parts = grams(X, y, w, groups)
    table = []
    for lo in grid:
        for ld in grid:
            pen = penalties(idx, lo, ld)
            err = tot = 0.0
            for Gf, bf, m in parts:
                beta, _ = solve(G - Gf, b - bf, pen, prior)
                resid = y[m] - X[m] @ beta
                err += float(np.sum(w[m] * resid ** 2))
                tot += float(np.sum(w[m]))
            table.append((lo, ld, err / tot))
    best = min(table, key=lambda r: r[2])
    return best[:2], table


def fit(X, y, w, idx, lam_off, lam_def, prior=None):
    """Posterior mean and SD of every column."""
    prior = np.zeros(idx.width) if prior is None else prior
    G, b, _ = grams(X, y, w)
    pen = penalties(idx, lam_off, lam_def)
    beta, c = solve(G, b, pen, prior)
    resid = y - X @ beta
    sigma2 = float(np.sum(w * resid ** 2) / max(np.sum(w) - idx.width, 1))
    cov_diag = np.diag(la.cho_solve(c, np.eye(len(beta)), check_finite=False))
    return beta, np.sqrt(sigma2 * cov_diag), sigma2


class Fitter:
    """One design over a set of rows, reused for many outcomes: cross-validation folds
    (by game) and the even/odd-game halves are precomputed once."""

    def __init__(self, rows, idx, w=None, k=5):
        self.rows, self.idx = rows, idx
        self.X = design(rows, idx)
        self.w = np.ones(len(rows)) if w is None else w
        self.Xw = self.X.multiply(self.w[:, None]).tocsr()
        self.G = (self.X.T @ self.Xw).toarray()
        self.folds = game_folds(rows, k)
        self.parity = game_parity(rows)
        self.fold_parts = [self._part(self.folds == f) for f in range(k)]
        self.halves = [self._part(self.parity == h) for h in (0, 1)]

    def _part(self, m):
        Xm, Xwm = self.X[m], self.Xw[m]
        return {'m': m, 'X': Xm, 'Xw': Xwm, 'w': self.w[m], 'G': (Xm.T @ Xwm).toarray()}

    def cv(self, y, grid, prior=None):
        prior = np.zeros(self.idx.width) if prior is None else prior
        b = self.Xw.T @ y
        folds = [(part, part['Xw'].T @ y[part['m']], y[part['m']]) for part in self.fold_parts]
        table = []
        for lo in grid:
            for ld in grid:
                pen = penalties(self.idx, lo, ld)
                err = tot = 0.0
                for part, bf, yf in folds:
                    beta, _ = solve(self.G - part['G'], b - bf, pen, prior)
                    resid = yf - part['X'] @ beta
                    err += float(np.sum(part['w'] * resid ** 2))
                    tot += float(np.sum(part['w']))
                table.append((lo, ld, err / tot))
        return min(table, key=lambda r: r[2])[:2], table

    def fit(self, y, lam_off, lam_def, prior=None, half=None):
        """Posterior mean and SD; half=0/1 fits the even/odd games only."""
        prior = np.zeros(self.idx.width) if prior is None else prior
        if half is None:
            G, X, Xw, w, yy = self.G, self.X, self.Xw, self.w, y
        else:
            h = self.halves[half]
            G, X, Xw, w, yy = h['G'], h['X'], h['Xw'], h['w'], y[h['m']]
        beta, c = solve(G, Xw.T @ yy, penalties(self.idx, lam_off, lam_def), prior)
        resid = yy - X @ beta
        sigma2 = float(np.sum(w * resid ** 2) / max(np.sum(w) - self.idx.width, 1))
        cov_diag = np.diag(la.cho_solve(c, np.eye(len(beta)), check_finite=False))
        return beta, np.sqrt(sigma2 * cov_diag)

    def side_poss(self, half=None):
        """Possessions (rows' weight) per player as offense and as defense, optionally in
        one half."""
        Xw = self.Xw if half is None else self.halves[half]['Xw']
        cnt = np.asarray(Xw.sum(axis=0)).ravel()
        n = self.idx.n
        return cnt[:n], cnt[n:2 * n]


def game_folds(rows, k=5, seed=0):
    games = rows['g'].to_numpy()
    uniq = np.unique(games)
    rng = np.random.default_rng(seed)
    fold_of = dict(zip(uniq, rng.integers(0, k, len(uniq))))
    return np.array([fold_of[g] for g in games])


def game_parity(rows):
    """0 for even games, 1 for odd (by the game id's number)."""
    return rows['g'].map(lambda g: int(g[-5:]) % 2).to_numpy()


def player_frame(idx, beta, sd):
    n = idx.n
    return pd.DataFrame({'pid': idx.players, 'off': beta[:n], 'off_sd': sd[:n], 'def': beta[n:2 * n],
                         'def_sd': sd[n:2 * n], 'poss': [idx.poss.get(p, 0) for p in idx.players]})


def decompose(rows, X, y, w, beta, idx, pid, side, team_seasons):
    """Raw on-off for player pid on one side ('off' or 'def'), split exactly into his own
    adjusted effect, each teammate's, the opponents', the covariates' and the residual:
    raw = Σ_columns beta_c (mean x_c on − mean x_c off) + (mean residual on − off).
    On and off are his team-seasons' possessions on that side, weighted equally to the
    on minutes' mix of team-seasons."""
    five = rows['off5'] if side == 'off' else rows['def5']
    team = rows['off'] if side == 'off' else rows['def']
    mine = (team + '|' + rows['season']).isin(team_seasons).to_numpy()
    on = mine & five.map(lambda f: pid in f).to_numpy()
    off = mine & ~on
    if on.sum() == 0 or off.sum() == 0:
        return None
    def mean(m, v):
        return float(np.sum(w[m] * v[m]) / np.sum(w[m]))
    resid = y - X @ beta
    xon = np.asarray(X[on].multiply(w[on][:, None]).sum(axis=0)).ravel() / np.sum(w[on])
    xoff = np.asarray(X[off].multiply(w[off][:, None]).sum(axis=0)).ravel() / np.sum(w[off])
    terms = beta * (xon - xoff)
    own = idx.of(pid) + (0 if side == 'off' else idx.n)
    same = slice(0, idx.n) if side == 'off' else slice(idx.n, 2 * idx.n)
    other = slice(idx.n, 2 * idx.n) if side == 'off' else slice(0, idx.n)
    mates = {idx.players[c - same.start]: float(terms[c]) for c in range(same.start, same.stop) if c != own and terms[c]}
    return {
        'raw': mean(on, y) - mean(off, y),
        'own': float(terms[own]),
        'mates': mates,
        'opponents': float(terms[other].sum()),
        'covariates': float(terms[2 * idx.n:].sum()),
        'residual': mean(on, resid) - mean(off, resid),
    }
