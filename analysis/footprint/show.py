"""Prints players' footprints from data/footprint/footprint.json.

  python3 analysis/footprint/show.py "Draymond Green" "Stephen Curry"
"""
import json
import os
import sys

PATH = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'footprint', 'footprint.json')


def show(players, name):
    hits = [p for p in players.values() if p['name'].lower() == name.lower()]
    if not hits:
        print(f'\n{name}: no footprint')
        return
    p = hits[0]
    e = p['entangled']
    print(f"\n{p['name']}  O {p['total']['off']:+.1f}  D {p['total']['def']:+.1f}  "
          f"(poss {p['poss']['off']}/{p['poss']['def']}; most with {e['mate']} {e['share']:.0%}, prior weight {e['prior_weight']:.0%})")
    for t in p['tiles']:
        mark = '●' if t['status'] == 'notable' else '·'
        how = f"  — {t['how']}" if t.get('how') else ''
        tier = '' if t['tier'] == 'full' else ' [tentative]'
        print(f"  {mark} {t['side']} {t['effect']:20s} {t['pts']:+5.2f} pts/100 (z {t['z']:+.1f})  "
              f"{t['label']}: {t['change']:+.2f} vs lg {t['league']}{tier}{how}")
        c = t.get('context')
        if c:
            mates = ', '.join(f"{m['name']} {m['v']:+.2f}" for m in c['top'])
            print(f"      raw {c['raw']:+.2f} = his {c['own']:+.2f} + {mates} + others {c['others']:+.2f} "
                  f"+ opp {c['opponents']:+.2f} + schedule {c['schedule']:+.2f} + rest {c['rest']:+.2f}")


if __name__ == '__main__':
    data = json.load(open(PATH))
    for n in sys.argv[1:]:
        show(data['players'], n)
