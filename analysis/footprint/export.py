"""The footprint artifact for the site: every qualified player's adjusted channels over
the footprint window, in points per 100 possessions.

  python3 analysis/footprint/export.py 2024-25,2025-26

Reads the calibration windows (data/cache/pbp/calibration) for each channel's ridge
penalty and reliability and for the box-score prior models, fits the window, and writes
data/footprint/footprint.json.
"""
import glob
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
from build import full_names  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
OUT = os.path.join(ROOT, 'data', 'footprint', 'footprint.json')
CALIB = os.path.join(M.CACHE, 'calibration')

MIN_OFF_POSS = 2000  # possessions on each side in the window for a footprint
Z_LIT = 2.5          # a tile lights when its points clear this many SDs ...
Z_TENTATIVE = 4.0    # ... or this many on a channel that is less reliable (r < R_FULL)
R_FULL = 0.5         # even/odd reliability of a full channel
PCT_ROLE = 75        # a box rate this high (percentile) names the mechanism

# The eight footprints shown (see docs/footprint-methodology.md for why these): key, side,
# channel, effect name (the teammate-shot tile is renamed by its mechanism), stat label,
# display scale for the stat.
TILES = [
    ('mates', 'off', 'loc_m', 'Teammate lift', "Teammates' shot locations, pts per 100", 100),
    ('trips', 'off', 'trips', 'Foul pressure', 'FT trips per 100', 100),
    ('tov', 'off', 'tov_pts', 'Ball security', 'Turnover cost, pts per 100', 100),
    ('oreb', 'off', 'oreb', 'Offensive glass', 'OREB% per chance', 100),
    ('shots_d', 'def', 'loc_m', 'Shot defense', "Opponents' shot locations, pts per 100", 100),
    ('tov_d', 'def', 'tov_pts', 'Turnover pressure', "Opponents' turnover cost, pts per 100", 100),
    ('trips_d', 'def', 'trips', 'Foul discipline', "Opponents' FT trips per 100", 100),
    ('oreb_d', 'def', 'oreb', 'Defensive glass', "Opponents' OREB% per chance", 100),
]
# Supporting numbers fit alongside: where the shots move, for and against (the shot
# tiles quote them), and luck-adjusted points (the header's overall impact).
ZONE_NAMES = {'z_rim_m': 'rim', 'z_corner3_m': 'corner threes', 'z_ab3_m': 'above-break threes', 'z_mid_m': 'mid-range'}
SUPPORT = ('pts_la', *ZONE_NAMES)


def calibration():
    """Average each channel's penalty and reliability over the calibration windows; the
    prior models fit on all windows' players."""
    tables = [json.load(open(f)) for f in sorted(glob.glob(os.path.join(CALIB, '*-*.json')))]
    zpath = os.path.join(CALIB, 'zsd.json')  # written by zcheck.py, which itself reads this calibration
    zsd = json.load(open(zpath))['z_sd'] if os.path.exists(zpath) else {}
    chans = {}
    for t in tables:
        for c in t['channels']:
            chans.setdefault(c['channel'], []).append(c)
    summary = {}
    for name, rows in chans.items():
        summary[name] = {
            'lam_off': float(np.exp(np.mean([np.log(r['lam_off']) for r in rows]))),
            'lam_def': float(np.exp(np.mean([np.log(r['lam_def']) for r in rows]))),
            'r_off': float(np.mean([r['r_off'] for r in rows])),
            'r_def': float(np.mean([r['r_def'] for r in rows])),
            'windows': [{'seasons': t['seasons'], **{k: c[k] for k in ('r_off', 'r_def', 'n_off', 'n_def')}}
                        for t in tables for c in t['channels'] if c['channel'] == name],
            # Error bars are widened by how much wider the even/odd gaps ran than they
            # predicted (zcheck.py), never narrowed.
            'widen_off': max(1.0, zsd.get(name, {}).get('off', 1.0)),
            'widen_def': max(1.0, zsd.get(name, {}).get('def', 1.0)),
        }
    coefs = pd.concat([pd.read_pickle(f) for f in sorted(glob.glob(os.path.join(CALIB, '*.coefs.pkl')))], ignore_index=True)
    return summary, coefs


def prior_vector(name, idx, box, coefs):
    """Each player's prior for a channel (offense and defense columns) from his box
    profile; the replacement column and players without a profile get 0."""
    prior = np.zeros(idx.width)
    n = idx.n
    feats = box.reindex(idx.players[:-1])
    have = feats[P.FEATURES].notna().all(axis=1).to_numpy()
    for side, off in (('off', 0), ('def', n)):
        col = f'{name}_{side}'
        if col not in coefs:
            continue
        train = coefs[coefs[col].notna() & coefs[P.FEATURES].notna().all(axis=1)]
        w = train['off_poss' if side == 'off' else 'def_poss']
        model = P.PriorModel().fit(train, train[col], w)
        pred = np.zeros(n - 1)
        pred[have] = model.predict(feats[have])
        prior[off:off + n - 1] = pred
    return prior


def mechanism(pts, own, rates):
    """The teammate-shot tile's one-word title and its evidence, from his own box profile
    (percentiles among qualified players):
    - better looks and an elite passer or scorer: Creation or Gravity, whichever of his
      assist and scoring-threat percentiles is higher (the other goes in the evidence);
    - worse looks and he barely shoots threes: Spacing (a cost);
    - otherwise: Teammate lift."""
    ast = (own['ast'], f"{rates['ast']} assists per 100 ({ordinal(own['ast'])} pct)")
    shoot = max((own['three_pa'], f"his own {rates['three_pa']} threes per 100 ({ordinal(own['three_pa'])} pct)"),
                (own['rim_fga'], f"his own {rates['rim_fga']} rim attempts per 100 ({ordinal(own['rim_fga'])} pct)"))
    if pts > 0 and max(ast[0], shoot[0]) >= PCT_ROLE:
        lead, other = (ast, shoot) if ast[0] >= shoot[0] else (shoot, ast)
        title = 'Creation' if lead is ast else 'Gravity'
        how = lead[1][0].upper() + lead[1][1:]
        if other[0] >= PCT_ROLE:
            how += f'; also {other[1]}'
        return title, how
    if pts < 0 and own['three_pa'] <= 100 - PCT_ROLE:
        return 'Spacing', f"Teammates get worse looks; his own {rates['three_pa']} threes per 100 ({ordinal(own['three_pa'])} pct)"
    return 'Teammate lift', None


def shifts(fits, col, mix, base):
    """Where the shots move, as the shot mix: each zone's change in attempts per
    possession (net of the shooters' usual) less its league share of the change in all
    attempts, over the shots those players usually take (base, per possession), so a
    player who takes many shots himself doesn't read as cutting every kind of shot. The
    three largest, e.g. 'mid-range −6.2%, rim +3.1%, corner threes +1.6% of shots'."""
    d = {z: float(fits[z]['beta'][col]) for z in ZONE_NAMES}
    total = sum(d.values())
    moves = sorted(((100 * (d[z] - mix[z] * total) / base, ZONE_NAMES[z]) for z in ZONE_NAMES), key=lambda m: -abs(m[0]))
    return ', '.join(f"{label} {'+' if v >= 0 else '−'}{abs(v):.1f}%" for v, label in moves[:3]) + ' of shots'


def what(key, change):
    """The tile's adjusted change in a sentence (change: the stat's adjusted coefficient,
    in the tile's display units; for defense, the opponents' change)."""
    a, up = abs(change), change > 0
    if key in ('mates', 'shots_d'):
        who = "teammates'" if key == 'mates' else "opponents'"
        return (f"With him on, {who} shots come from spots worth {a:.1f} {'more' if up else 'fewer'} points per 100 "
                f"possessions than those shooters usually get.")
    if key in ('trips', 'trips_d'):
        who = 'his team gets' if key == 'trips' else 'opponents get'
        return f"With him on, {who} {a:.1f} {'more' if up else 'fewer'} free-throw trips per 100 possessions."
    if key == 'tov':
        return f"With him on, his team's turnovers cost {a:.1f} {'fewer' if up else 'more'} points per 100."
    if key == 'tov_d':
        return f"With him on, opponents' turnovers cost them {a:.1f} {'fewer' if up else 'more'} points per 100."
    who = 'his team rebounds' if key == 'oreb' else 'opponents rebound'
    return f"With him on, {who} {a:.1f}% {'more' if up else 'fewer'} of {'its' if key == 'oreb' else 'their'} misses."


def ordinal(n):
    n = int(n)
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def percentiles(series, qualified):
    ref = np.sort(series[qualified].to_numpy())
    return series.map(lambda v: float(100 * np.searchsorted(ref, v, side='right') / len(ref)))


def context(fitter, y, beta, idx, pid, side, names):
    """Raw on-off for pid on one side split into his adjusted effect, his teammates',
    the opponents', the schedule (season, home, margin) and what's left. Over his
    team-seasons only: on = possessions he played, off = the rest of his teams'."""
    n = idx.n
    col = idx.of(pid) + (0 if side == 'off' else n)
    X, w = fitter.X, fitter.w
    if not hasattr(fitter, 'Xc'):
        fitter.Xc = X.tocsc()
    on = np.zeros(X.shape[0], bool)
    on[fitter.Xc.indices[fitter.Xc.indptr[col]:fitter.Xc.indptr[col + 1]]] = True
    team = (fitter.rows['off'] if side == 'off' else fitter.rows['def']) + '|' + fitter.rows['season']
    mine = team.isin(set(team[on])).to_numpy()
    # On teammate-shot rows his own shots are neither: they measure his teammates'
    # effect on him, not his on theirs.
    if side == 'off' and 'shooter' in fitter.rows:
        mine = mine & (fitter.rows["shooter"] != pid).to_numpy()
    off = mine & ~on
    if on.sum() < 50 or off.sum() < 50:
        return None
    xon = np.asarray(X[on].T @ w[on]).ravel() / w[on].sum()
    xoff = np.asarray(X[off].T @ w[off]).ravel() / w[off].sum()
    terms = beta * (xon - xoff)
    resid = y - X @ beta
    raw = float(np.average(y[on], weights=w[on]) - np.average(y[off], weights=w[off]))
    same = range(0, n) if side == 'off' else range(n, 2 * n)
    mates = sorted(((float(terms[c]), idx.players[c - same.start]) for c in same if c != col and terms[c] != 0),
                   key=lambda t: -abs(t[0]))
    top = [{'name': names.get(p, p), 'pid': p, 'v': v} for v, p in mates[:2] if p != M.REPLACEMENT]
    return {
        'raw': raw, 'own': float(terms[col]), 'top': top,
        'others': float(sum(v for v, _ in mates) - sum(t['v'] for t in top)),
        'opponents': float(terms[(n if side == 'off' else 0):(2 * n if side == 'off' else n)].sum()),
        'schedule': float(terms[2 * n:].sum()),
        'rest': float(np.average(resid[on], weights=w[on]) - np.average(resid[off], weights=w[off])),
    }


def main(seasons):
    t0 = time.time()
    summary, coefs = calibration()
    d = M.load(seasons)
    counts = M.per_possession(d)
    values = C.league_values(d, counts)
    rates = C.shooter_rates(d)
    outcomes = C.possession_outcomes(d, counts, values, rates)
    p = d['possessions']
    idx = M.Index(p)
    box = P.box(d, values)
    names = full_names()
    print(f'window {"/".join(seasons)}: {len(p)} possessions, {idx.n - 1} players  {time.time() - t0:.0f}s', flush=True)

    # League rates the tiles quote, and the volumes that turn rates into points.
    ch = C.chance_rows(d)
    own_shots = C.own_shots(d, values)
    outcomes = outcomes.join(C.net_of_usual(d, outcomes, own_shots))
    # League shot mix by zone and attempts per possession, for the shot tiles' mix line.
    zone_of = {z: label for label, zones in C.LOC_ZONES.items() for z in zones}
    mix = (d['shots']['zone'].map(zone_of).value_counts(normalize=True)).rename(lambda z: f'{z}_m').to_dict()
    fga_pp = len(d['shots']) / len(p)
    per100 = {'chances': 100 * len(ch) / len(p)}
    league = {
        'trips': 100 * outcomes['trips'].mean(), 'tov_pts': 100 * outcomes['tov_pts'].mean(),
        'oreb': 100 * ch['oreb'].mean(), 'loc_m': 0.0,
    }
    fitters = {'possession': M.Fitter(p, idx), 'chance': M.Fitter(ch, idx)}
    unit_of = {'oreb': 'chance'}
    ys = {'oreb': ch['oreb'].to_numpy(float)}
    fits = {}
    for name in sorted({t[2] for t in TILES} | set(SUPPORT)):
        fitter = fitters[unit_of.get(name, 'possession')]
        y = ys.get(name, outcomes[name].to_numpy(float) if name in outcomes else None)
        cal = summary[name]
        prior = prior_vector(name, idx, box, coefs)
        beta, sd = fitter.fit(y, cal['lam_off'], cal['lam_def'], prior=prior)
        fits[name] = {'beta': beta, 'sd': sd, 'prior': prior, 'y': y, 'fitter': fitter, 'cal': cal}
        print(f'  fit {name}  {time.time() - t0:.0f}s', flush=True)

    # Points per unit of each channel's coefficient (per possession / chance / shot).
    pts_per = {
        'trips': 100 * values['trip'], 'tov_pts': 100,
        'oreb': per100['chances'] * values['ppp'], 'loc_m': 100,
    }

    off_poss, def_poss = fits['pts_la']['fitter'].side_poss()
    n = idx.n
    qualified = pd.Series({pid: (off_poss[i] >= MIN_OFF_POSS and def_poss[i] >= MIN_OFF_POSS)
                           for i, pid in enumerate(idx.players[:-1])})
    box_q = box.reindex(qualified.index)
    pct = {c: percentiles(box_q[c].fillna(0), qualified) for c in ('rim_fga', 'three_pa', 'ast')}

    # Shared minutes: each player's largest share of his possessions with one teammate.
    shared = {}
    for five in p['off5']:
        for a in five:
            for b in five:
                if a != b:
                    shared[(a, b)] = shared.get((a, b), 0) + 1

    players = {}
    for i, pid in enumerate(idx.players[:-1]):
        if not qualified[pid]:
            continue
        tiles = []
        for key, side, name, effect, label, scale in TILES:
            f = fits[name]
            col = i + (0 if side == 'off' else n)
            beta = float(f['beta'][col])
            sd = float(f['sd'][col]) * f['cal']['widen_off' if side == 'off' else 'widen_def']
            sign = 1 if side == 'off' else -1  # defense: the opponents' change, so fewer is better
            pts = sign * beta * pts_per[name]
            pts_sd = abs(sd * pts_per[name])
            r = f['cal']['r_off' if side == 'off' else 'r_def']
            tier = 'full' if r >= R_FULL else 'tentative'
            z = pts / pts_sd if pts_sd else 0.0
            lit = abs(z) >= (Z_LIT if tier == 'full' else Z_TENTATIVE)
            tiles.append({
                'key': key, 'side': side, 'effect': effect, 'label': label,
                'pts': round(pts, 2), 'sd': round(pts_sd, 2), 'z': round(z, 2),
                # The shot-location tiles' change is their points: no separate stat.
                'change': None if name == 'loc_m' else round(beta * scale, 2), 'league': round(league[name], 2),
                'tier': tier, 'reliability': round(r, 2), 'status': 'notable' if lit else 'noise',
                'what': what(key, beta * scale),
            })
        own = {c: round(pct[c][pid]) for c in pct}
        rates_ = {c: round(float(box_q.loc[pid, c]), 1) for c in ('rim_fga', 'three_pa', 'ast')}
        for t in tiles:
            if t['key'] == 'mates':
                t['effect'], t['how'] = mechanism(t['pts'], own, rates_)
                own_fga = float(own_shots.loc[pid, list(C.LOC_ZONES)].sum()) if pid in own_shots.index else 0.0
                t['support'] = "Teammates' shot mix: " + shifts(fits, i, mix, fga_pp - own_fga)
            if t['key'] == 'shots_d':
                t['support'] = "Opponents' shot mix: " + shifts(fits, n + i, mix, fga_pp)
        for t in tiles:
            if t['status'] != 'notable':
                continue
            name = next(x[2] for x in TILES if x[0] == t['key'])
            f = fits[name]
            c = context(f['fitter'], f['y'], f['beta'], idx, pid, t['side'], names)
            if c:
                conv = (1 if t['side'] == 'off' else -1) * pts_per[name]
                t['context'] = {
                    'raw': round(c['raw'] * conv, 2), 'own': round(c['own'] * conv, 2),
                    'top': [{'name': m['name'], 'pid': m['pid'], 'v': round(m['v'] * conv, 2)} for m in c['top']],
                    'others': round(c['others'] * conv, 2), 'opponents': round(c['opponents'] * conv, 2),
                    'schedule': round(c['schedule'] * conv, 2), 'rest': round(c['rest'] * conv, 2),
                }
        top_mate = max(((shared.get((pid, m), 0), m) for (a, m) in shared if a == pid), default=(0, None))
        lam = fits['pts_la']['cal']['lam_off']
        G_ii = fits['pts_la']['fitter'].G[i, i]
        la_ = fits['pts_la']
        players[pid] = {
            'name': names.get(pid, pid),
            'poss': {'off': int(off_poss[i]), 'def': int(def_poss[i])},
            'total': {'off': round(100 * float(la_['beta'][i]), 2), 'def': round(-100 * float(la_['beta'][n + i]), 2)},
            'entangled': {'mate': names.get(top_mate[1], top_mate[1]), 'mate_pid': top_mate[1],
                          'share': round(top_mate[0] / max(off_poss[i], 1), 2),
                          'prior_weight': round(lam / (lam + G_ii), 2)},
            'tiles': tiles,
        }
    meta = {
        'seasons': seasons, 'generatedAt': pd.Timestamp.now('UTC').isoformat(),
        'possessions': int(len(p)), 'min_poss': MIN_OFF_POSS, 'z_lit': Z_LIT, 'z_tentative': Z_TENTATIVE,
        'r_full': R_FULL,
        'values': {k: v for k, v in values.items()}, 'per100': per100,
        'reliability': {t[0]: {'r': round(summary[t[2]]['r_off' if t[1] == 'off' else 'r_def'], 2),
                               'windows': [round(w['r_off' if t[1] == 'off' else 'r_def'], 2)
                                           for w in summary[t[2]]['windows']]} for t in TILES},
        'calibration': [w['seasons'] for w in summary['pts_la']['windows']],
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump({'meta': meta, 'players': players}, open(OUT, 'w'), indent=1, default=float)
    print(f'wrote {len(players)} players  {time.time() - t0:.0f}s', flush=True)


if __name__ == '__main__':
    main(sys.argv[1].split(',') if len(sys.argv) > 1 else ['2024-25', '2025-26'])
