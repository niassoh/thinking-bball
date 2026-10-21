"""Calibration on past seasons: for each channel, the ridge penalty (cross-validated over
games), the spread of the adjusted estimates, and their reliability (the correlation of
players' estimates between even and odd games, weighted by their playing time). Saves
each window's results and the players' zero-prior estimates with their box profiles
(the training data for the box-score priors).

  python3 analysis/footprint/calibrate.py 2017-18,2018-19 2020-21,2021-22 2022-23,2023-24
"""
import json
import os
import sys
import time

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
import channels as C  # noqa: E402
import model as M  # noqa: E402
import priors as P  # noqa: E402

GRID = [300, 1000, 3000, 9000, 27000, 81000]
HALF_MIN = 1500  # possessions on that side in each half (scaled for shot/chance units)
OUT = os.path.join(M.CACHE, 'calibration')

CHANNELS = ['pts', 'pts_la', 'rim', 'three', 'three_x', 'three_val', 'trips', 'tov_pts', 'duration']
# Shot locations net of the shooters' usual contributions (channels.net_of_usual).
NET = ['loc_m', *(f'{z}_m' for z in C.LOC_ZONES)]


def weighted_r(a, b, w):
    a, b, w = np.asarray(a), np.asarray(b), np.asarray(w, float)
    ma, mb = np.average(a, weights=w), np.average(b, weights=w)
    cov = np.average((a - ma) * (b - mb), weights=w)
    return float(cov / np.sqrt(np.average((a - ma) ** 2, weights=w) * np.average((b - mb) ** 2, weights=w)))


def reliability(fitter, ys, lo, ld, min_rows):
    """Even/odd-game correlation of the offense and defense coefficients, over players
    with min_rows rows on that side in both halves. ys holds each half's outcome (built
    from that half's games only, so shooter percentages and shooters' usual contributions
    don't leak between halves)."""
    n = fitter.idx.n
    fits = [fitter.fit(ys[h], lo, ld, half=h)[0] for h in (0, 1)]
    rows = [fitter.side_poss(h) for h in (0, 1)]
    out = {}
    for side, sl in (('off', slice(0, n)), ('def', slice(n, 2 * n))):
        k = 0 if side == 'off' else 1
        pe, po = rows[0][k], rows[1][k]
        keep = (pe >= min_rows) & (po >= min_rows)
        keep[-1] = False  # the replacement column
        out[side] = (weighted_r(fits[0][sl][keep], fits[1][sl][keep], np.minimum(pe, po)[keep]), int(keep.sum()))
    return out


def half(d, h):
    """The window's detail tables cut to one half of its games (0 even, 1 odd)."""
    games = d['possessions']['g'].map(lambda g: int(g[-5:]) % 2)
    keep = set(games.index[games == h])
    out = dict(d)
    for k in ('shots', 'fts'):
        out[k] = d[k][d[k]['poss'].isin(keep)]
    return out


def run(seasons):
    t0 = time.time()
    d = M.load(seasons)
    counts = M.per_possession(d)
    values = C.league_values(d, counts)
    rates = C.shooter_rates(d)
    outcomes = C.possession_outcomes(d, counts, values, rates)
    p = d['possessions']
    idx = M.Index(p)
    print(f'{"/".join(seasons)}: {len(p)} possessions, {idx.n - 1} players; design {time.time() - t0:.0f}s', flush=True)
    # Each half's outcomes with shooter rates (and shooter averages) from that half alone.
    halves = [C.possession_outcomes(d, counts, values, C.shooter_rates(half(d, h))) for h in (0, 1)]
    poss_fit = M.Fitter(p, idx)
    plans = [(c, 'possession', poss_fit, outcomes[c].to_numpy(float), [o[c].to_numpy(float) for o in halves])
             for c in CHANNELS]
    parity = p['g'].map(lambda g: int(g[-5:]) % 2)
    net = C.net_of_usual(d, outcomes, C.own_shots(d, values))
    net_halves = [C.net_of_usual(d, outcomes, C.own_shots(d, values, games=set(p['g'][parity == h]))) for h in (0, 1)]
    plans += [(c, 'possession', poss_fit, net[c].to_numpy(float), [o[c].to_numpy(float) for o in net_halves]) for c in NET]
    ch = C.chance_rows(d)
    y = ch['oreb'].to_numpy(float)
    plans.append(('oreb', 'chance', M.Fitter(ch, idx), y, [y, y]))
    rim = C.rim_shot_rows(d)
    y = rim['y'].to_numpy(float)
    plans.append(('rim_fg', 'rim shot', M.Fitter(rim, idx), y, [y, y]))
    table, coefs = [], {}
    n = idx.n
    big = np.array([idx.poss.get(pp, 0) for pp in idx.players]) >= 4000
    for name, unit, fitter, y, ys in plans:
        (lo, ld), _ = fitter.cv(y, GRID)
        beta, sd = fitter.fit(y, lo, ld)
        rel = reliability(fitter, ys, lo, ld, HALF_MIN * len(fitter.rows) / len(p))
        coefs[name] = (beta[:n], beta[n:2 * n])
        table.append({
            'channel': name, 'unit': unit, 'lam_off': lo, 'lam_def': ld,
            'spread_off': float(np.std(beta[:n][big])), 'spread_def': float(np.std(beta[n:2 * n][big])),
            'sd_off': float(np.median(sd[:n][big])), 'sd_def': float(np.median(sd[n:2 * n][big])),
            'r_off': rel['off'][0], 'r_def': rel['def'][0], 'n_off': rel['off'][1], 'n_def': rel['def'][1],
        })
        print(f'  {name:9s} λ {lo}/{ld}  r {rel["off"][0]:.2f}/{rel["def"][0]:.2f} '
              f'(n {rel["off"][1]}/{rel["def"][1]})  {time.time() - t0:.0f}s', flush=True)
    # Training rows for the box-score priors: every player with his own column.
    box = P.box(d, values)
    frame = pd.DataFrame({'pid': idx.players[:-1]})
    for name, (bo, bd) in coefs.items():
        frame[f'{name}_off'] = bo[:-1]
        frame[f'{name}_def'] = bd[:-1]
    frame = frame.join(box, on='pid')
    frame['window'] = '/'.join(seasons)
    os.makedirs(OUT, exist_ok=True)
    key = '_'.join(seasons)
    frame.to_pickle(os.path.join(OUT, f'{key}.coefs.pkl'))
    json.dump({'seasons': seasons, 'channels': table, 'values': {k: v for k, v in values.items()}},
              open(os.path.join(OUT, f'{key}.json'), 'w'), indent=1, default=float)
    return pd.DataFrame(table)


if __name__ == '__main__':
    for window in sys.argv[1:]:
        print(run(window.split(',')).round(4).to_string(), flush=True)
