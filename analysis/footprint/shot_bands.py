"""Each player's shots by the shot map's bands in a season, from the possession cache, for the
bio card's historical view (a past season's shot profile against the rest of his career,
lib/profile.js careerShift). The bands are the map's (lib/court.js): rim within 6 ft, short
mid within 14 ft, long mid beyond, and threes (corner and above the break together), the
cache's zones (possessions.py zone).

  analysis/footprint/.venv/bin/python analysis/footprint/shot_bands.py [1996-97 ...] [--out DIR]

Writes <DIR or data/history/shot-bands>/<season>.json: {season, bands, league: [rim FGA,
rim FGM, short mid FGA, FGM, long mid FGA, FGM, 3PA, 3PM], players: {nbaId: [the same]}}.
Default seasons: every season the cache has (1996-97 on).

And data/history/shot-dots/<season>.json: {season, players: {nbaId: dots}}, each player's
every shot for the map's dots, packed three base64url characters a shot (18 bits: x and y
in half feet from the basket, offset to stay positive (x + 64, y + 10, clamped), made, band
index), so a career's shots stay a few KB. src/lib/shot.js decodes them.
"""
import base64
import json
import os
import sys

import pandas as pd

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
CACHE = os.path.join(ROOT, 'data', 'cache', 'pbp')
BANDS = ['rim', 'short_mid', 'long_mid', 'three']
BAND_OF = {'rim': 'rim', 'short_mid': 'short_mid', 'long_mid': 'long_mid', 'corner3': 'three', 'above_break3': 'three'}


def counts(shots):
    """[FGA, FGM] per band, in BANDS order, flattened."""
    by = shots.groupby('band')['made'].agg(['size', 'sum'])
    return [int(by.loc[b, x]) if b in by.index else 0 for b in BANDS for x in ('size', 'sum')]


def pack(shots):
    """Three base64url characters a shot: x (7 bits) y (8) made (1) band (2)."""
    qx = ((shots['x'].fillna(0) / 5).round() + 64).clip(0, 127).to_numpy(dtype='int64')
    qy = ((shots['y'].fillna(0) / 5).round() + 10).clip(0, 255).to_numpy(dtype='int64')
    made = shots['made'].to_numpy(dtype='int64')
    band = shots['band'].map(BANDS.index).to_numpy(dtype='int64')
    v = (qx << 11) | (qy << 3) | (made << 2) | band
    raw = b''.join(int(x).to_bytes(3, 'big') for x in v)
    # 3 bytes -> 4 characters; the top 6 bits of each 24 are always zero (18 used), so drop that character.
    b64 = base64.urlsafe_b64encode(raw).decode()
    return ''.join(b64[i + 1:i + 4] for i in range(0, len(b64), 4))


def season_bands(season):
    shots = pd.read_pickle(os.path.join(CACHE, season, 'shots.pkl'))
    shots = shots.assign(band=shots['zone'].map(BAND_OF), made=shots['made'].astype(bool))
    if shots['band'].isna().any():
        raise ValueError(f'{season}: shots with an unknown zone: {sorted(shots.loc[shots.band.isna(), "zone"].unique())}')
    players = {str(pid): counts(g) for pid, g in shots.groupby('shooter')}
    dots = {str(pid): pack(g) for pid, g in shots.groupby('shooter')}
    return {'season': season, 'bands': BANDS, 'league': counts(shots), 'players': players}, {'season': season, 'players': dots}


def main(argv):
    out = os.path.join(ROOT, 'data', 'history', 'shot-bands')
    if '--out' in argv:
        out = argv[argv.index('--out') + 1]
        argv = [a for a in argv if a not in ('--out', out)]
    seasons = argv or sorted(s for s in os.listdir(CACHE) if len(s) == 7 and os.path.exists(os.path.join(CACHE, s, 'shots.pkl')))
    dots_out = os.path.join(os.path.dirname(out.rstrip('/')), 'shot-dots')
    os.makedirs(out, exist_ok=True)
    os.makedirs(dots_out, exist_ok=True)
    for season in seasons:
        doc, dots = season_bands(season)
        with open(os.path.join(out, f'{season}.json'), 'w') as f:
            json.dump(doc, f, separators=(',', ':'))
        with open(os.path.join(dots_out, f'{season}.json'), 'w') as f:
            json.dump(dots, f, separators=(',', ':'))
        lg = doc['league']
        print(f'{season}: {len(doc["players"])} players, {sum(lg[0::2])} FGA ({", ".join(f"{b} {lg[2 * i]}" for i, b in enumerate(BANDS))})')


if __name__ == '__main__':
    main(sys.argv[1:])
