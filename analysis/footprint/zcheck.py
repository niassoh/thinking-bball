"""Are the posterior SDs honest? For each channel, fit even and odd games separately and
compare: (estimate_even − estimate_odd) / sqrt(sd_even² + sd_odd²) should have SD ≈ 1
across players. A larger SD means the error bars are too narrow; its value is the factor
to widen them by.

  python3 analysis/footprint/zcheck.py 2022-23,2023-24
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import calibrate as K  # noqa: E402
import channels as C  # noqa: E402
import model as M  # noqa: E402
from export import calibration  # noqa: E402


def main(seasons):
    summary, _ = calibration()
    d = M.load(seasons)
    counts = M.per_possession(d)
    values = C.league_values(d, counts)
    halves = [C.possession_outcomes(d, counts, values, C.shooter_rates(K.half(d, h))) for h in (0, 1)]
    p = d['possessions']
    idx = M.Index(p)
    n = idx.n
    out = {}
    plans = [(c, M.Fitter(p, idx), [o[c].to_numpy(float) for o in halves])
             for c in ('pts_la', 'rim', 'three_val', 'trips', 'tov_pts')]
    ch = C.chance_rows(d)
    plans.append(('oreb', M.Fitter(ch, idx), [ch['oreb'].to_numpy(float)] * 2))
    rim = C.rim_shot_rows(d)
    plans.append(('rim_fg', M.Fitter(rim, idx), [rim['y'].to_numpy(float)] * 2))
    outcomes = C.possession_outcomes(d, counts, values, C.shooter_rates(d))
    parity = p['g'].map(lambda g: int(g[-5:]) % 2)
    net = [C.net_of_usual(d, outcomes, C.own_shots(d, values, games=set(p['g'][parity == h]))) for h in (0, 1)]
    plans.append(('loc_m', plans[0][1], [o['loc_m'].to_numpy(float) for o in net]))
    for name, fitter, ys in plans:
        cal = summary[name]
        fits = [fitter.fit(ys[h], cal['lam_off'], cal['lam_def'], half=h) for h in (0, 1)]
        rows = [fitter.side_poss(h) for h in (0, 1)]
        res = {}
        for side, sl, k in (('off', slice(0, n), 0), ('def', slice(n, 2 * n), 1)):
            keep = (rows[0][k] >= 1500 * len(fitter.rows) / len(p)) & (rows[1][k] >= 1500 * len(fitter.rows) / len(p))
            keep[-1] = False
            z = (fits[0][0][sl] - fits[1][0][sl]) / np.sqrt(fits[0][1][sl] ** 2 + fits[1][1][sl] ** 2)
            res[side] = float(np.std(z[keep]))
        out[name] = res
        print(f'{name:9s} z-SD off {res["off"]:.2f} def {res["def"]:.2f}', flush=True)
    return out


if __name__ == '__main__':
    import json
    result = main(sys.argv[1].split(','))
    json.dump({'seasons': sys.argv[1].split(','), 'z_sd': result},
              open(os.path.join(K.OUT, 'zsd.json'), 'w'), indent=1)
