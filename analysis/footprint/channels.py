"""The footprint channels: what each measures, on which unit of play, and what one unit
is worth in points.

Possession-level outcomes are regressed once and give both sides: a player's offensive
coefficient on 'rim' is his team's rim-attempt change with him on offense (Rim
pressure); his defensive coefficient, the opponents' change with him defending (Rim
deterrence).

Points per unit, all from league data in the window (garbage time and excluded
possessions left out):
- a shot: its zone's league points per attempt (expected points, xPTS);
- an extra rim attempt or three: its xPTS minus the average attempt's (it replaces an
  average shot);
- a free-throw trip: its average points, less the average attempt's xPTS for the share
  of trips that came instead of a shot (fouls on missed shots);
- a turnover: the points a possession that doesn't end in one averages, plus for a live
  ball the extra the opponent scores off a steal;
- an offensive rebound: the points per possession (it gives the possession another life);
- a three's expected value: 3 × the shooter's three-point percentage (shrunk toward the
  league's by 250 attempts, corner and above-the-break kept apart), so what goes in is
  set aside as luck, the Thinking Basketball way.
"""
import numpy as np
import pandas as pd

ZONE_ORDER = ('rim', 'short_mid', 'long_mid', 'corner3', 'above_break3')
SHRINK_3PA = 250
SHRINK_FTA = 100


def shooter_rates(d):
    """Each shooter's shrunk three-point and free-throw percentages."""
    s = d['shots']
    three = s[s['value'] == 3]
    lg3 = three['made'].mean()
    g = three.groupby('shooter')['made'].agg(['sum', 'count'])
    p3 = (g['sum'] + SHRINK_3PA * lg3) / (g['count'] + SHRINK_3PA)
    f = d['fts'][d['fts']['kind'] != 'technical']
    lgft = f['ftm'].sum() / f['fta'].sum()
    gf = f.groupby('shooter')[['ftm', 'fta']].sum()
    pft = (gf['ftm'] + SHRINK_FTA * lgft) / (gf['fta'] + SHRINK_FTA)
    return {'p3': p3.to_dict(), 'lg3': lg3, 'pft': pft.to_dict(), 'lgft': lgft}


def league_values(d, counts):
    """Points per unit for each channel (see module docstring)."""
    s = d['shots']
    xpts = s.groupby('zone')['pts'].mean().to_dict()
    fga = float(s['pts'].mean())
    f = d['fts'][d['fts']['kind'] != 'technical']
    trip = float(f['ftm'].sum() / len(f))
    shooting_share = float(f['kind'].isin(['shooting']).mean())
    p = d['possessions']
    no_tov = counts['tov'] == 0
    ppp = float(p['pts'].mean())
    ppp_no_tov = float(p['pts'][no_tov].mean())
    after_steal = float(p['pts'][p['start_reason'] == 'steal'].mean())
    three_zone = s[s['value'] == 3].groupby('zone')['made'].mean().to_dict()
    return {
        'xpts': xpts, 'fga': fga, 'ppp': ppp,
        'rim': xpts['rim'] - fga,
        'three': float(s[s['value'] == 3]['pts'].mean()) - fga,
        'trip': trip - fga * shooting_share,
        'tov_dead': -ppp_no_tov,
        'tov_live_extra': -(after_steal - ppp),
        'oreb': ppp,
        'three_zone': three_zone,
    }


def possession_outcomes(d, counts, values, rates):
    """Per-possession outcome columns (index = possession id)."""
    p = d['possessions']
    s = d['shots']
    out = pd.DataFrame(index=p.index)
    out['rim'] = counts['rim']
    out['three'] = counts['three']
    out['trips'] = counts['trips']
    out['tov'] = counts['tov']
    out['tov_pts'] = values['tov_dead'] * counts['tov'] + values['tov_live_extra'] * counts['tov_live']
    out['duration'] = counts['duration']
    # Expected points of the threes taken: 3 x the shooter's shrunk percentage, moved by
    # his zone (corner threes go in more often for everyone).
    lg3 = rates['lg3']
    three = s[s['value'] == 3].copy()
    shift = three['shooter'].map(rates['p3']).fillna(lg3) - lg3
    three['x'] = 3 * (three['zone'].map(values['three_zone']).fillna(lg3) + shift)
    out['three_x'] = three.groupby('poss')['x'].sum().reindex(p.index).fillna(0.0)
    # What the threes add over the average attempts they replace: more threes by good
    # shooters is worth points, more by poor ones costs them.
    out['three_val'] = out['three_x'] - values['fga'] * counts['three']
    # Luck-adjusted points: twos as they went, threes and free throws at the shooter's
    # expected percentage.
    two = s[s['value'] == 2].groupby('poss')['pts'].sum().reindex(p.index).fillna(0.0)
    f = d['fts'][d['fts']['kind'] != 'technical'].copy()
    f['x'] = f['fta'] * f['shooter'].map(rates['pft']).fillna(rates['lgft'])
    fx = f.groupby('poss')['x'].sum().reindex(p.index).fillna(0.0)
    out['pts_la'] = two + out['three_x'] + fx
    out['pts'] = p['pts'].astype(float)
    # Shot locations: what the possession's attempts are worth by where they were taken
    # (league points per attempt from each zone) over as many average attempts, and the
    # attempts by zone. Who takes the shots is part of it: getting the ball to a big at
    # the rim instead of a guard pulling up from mid-range counts.
    xv = s['zone'].map(values['xpts']) - values['fga']
    out['loc'] = xv.groupby(s['poss']).sum().reindex(p.index).fillna(0.0)
    for name, zones in LOC_ZONES.items():
        out[name] = s[s['zone'].isin(zones)].groupby('poss').size().reindex(p.index).fillna(0.0)
    return out


LOC_ZONES = {'z_rim': ['rim'], 'z_corner3': ['corner3'], 'z_ab3': ['above_break3'], 'z_mid': ['short_mid', 'long_mid']}


def own_shots(d, values, games=None):
    """Each player's usual own share of the shot-location outcomes: per offensive
    possession he played (optionally over a subset of games)."""
    p = d['possessions']
    s = d['shots']
    if games is not None:
        p = p[p['g'].isin(games)]
        s = s[s['poss'].isin(p.index)]
    poss = pd.Series([pid for five in p['off5'] for pid in five]).value_counts()
    xv = s['zone'].map(values['xpts']) - values['fga']
    out = pd.DataFrame(index=poss.index)
    out['loc'] = xv.groupby(s['shooter']).sum()
    for name, zones in LOC_ZONES.items():
        out[name] = s[s['zone'].isin(zones)].groupby('shooter').size()
    return out.fillna(0.0).div(poss, axis=0)


def net_of_usual(d, outcomes, own):
    """The shot-location outcomes with the five shooters' usual contributions taken off:
    what's left on a possession is how its shooters did against their own norms, shot
    volume included. Regressed on who is on the floor, a player's offensive coefficient is
    then what changes for his teammates' shots (more of them going to a big at the rim
    counts; his own usual shooting doesn't), and his defensive one, what changes for the
    opponents' (columns 'loc_m', 'z_rim_m', ...)."""
    p = d['possessions']
    rows = pd.DataFrame({'poss': np.repeat(p.index.to_numpy(), 5), 'pid': [pid for five in p['off5'] for pid in five]})
    out = pd.DataFrame(index=p.index)
    for col in ['loc', *LOC_ZONES]:
        usual = rows['pid'].map(own[col]).fillna(0.0).groupby(rows['poss']).sum().reindex(p.index).fillna(0.0)
        out[f'{col}_m'] = outcomes[col] - usual
    return out


def chance_rows(d):
    """Rebound chances with their possession's fives (y = offensive rebound)."""
    r = d['rebs'].copy()
    p = d['possessions']
    r = r[r['poss'].isin(p.index)]
    cols = ['off5', 'def5', 'season', 'home', 'margin', 'g', 'off', 'def']
    r = r.join(p[cols], on='poss')
    return r.reset_index(drop=True)


def rim_shot_rows(d):
    """Rim attempts with their possession's fives (y = made minus the league rate)."""
    s = d['shots']
    p = d['possessions']
    s = s[(s['zone'] == 'rim') & s['poss'].isin(p.index)].copy()
    cols = ['off5', 'def5', 'season', 'home', 'margin', 'g', 'off', 'def']
    s = s.join(p[cols], on='poss')
    s['y'] = s['made'].astype(float) - s['made'].mean()
    return s.reset_index(drop=True)
