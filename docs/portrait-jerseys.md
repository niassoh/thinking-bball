# Portrait jerseys

The bio card's season rail changes the player's team, so his portrait changes jersey
with it: every illustrated portrait can wear any team's jersey, and the hero fades the
new jersey in when the team changes. Jerseys are plain colour (Icon) jerseys: team
colours and the collar/armhole binding, with no wordmark, maker mark or patch.

## How a portrait gets its jerseys

1. **Colour-key edit (Codex).** `node scripts/portraits/codex-queue.js --out <dir> --jersey-key [--slugs a,b]`
   queues approved portraits; Codex (the desktop app, per the folder's `CODEX_TASK.md`)
   repaints only the jersey: body magenta (lighter and darker planes kept), binding cyan,
   lettering removed. Always an edit of the approved portrait, never a regeneration.
2. **Import and extract.** `node scripts/portraits/codex-queue.js --import <dir>` hands each
   `out.png` to `scripts/portraits/jersey-key.js --import`, which aligns it to the approved
   portrait and lifts the jersey into a map (R = shade, G = body, B = trim) in the approved
   portrait's pixels, with metrics that name the retry fix when one fails (`--fix <key>`
   on the next queue: reframe, not-key, missed, overreach, logos, spill, flat, trim; three
   attempts at most).
3. **QA.** `jersey-key.js --sheet <file.jpg>` (approved | key edit | mask | shade | three
   loud test palettes | metrics), then `--qa <slug> pass|fail [--failed …]` and
   `--approve <slug>` (writes `assets/players/jersey/maps/<slug>.webp`).
4. **Build.** `node scripts/portraits/jersey-build.js [--slugs a,b]` paints each approved
   map with `data/jersey-palettes.json` (lib/jersey-color.js, lib/jersey-paint.js):
   - `assets/players/jersey/base/<slug>-{400,100}.webp`: the portrait in his current
     team's jersey, which becomes his headshot (`headshot: 'jersey'`);
   - `assets/players/jersey/<slug>-{400,100}.webp`: a sprite of his other career jerseys'
     bands (every team of every season, regular season and playoffs, in that season's era);
   - `assets/players/jersey/manifest.json`: per player `v` (content hash), `top`, `ids`
     (frame order), `current`, `base`, `shadeSource`.
   The build refuses a composite that changes the head and skips a map whose portrait has
   changed since (re-run the key edit). `--sheet <file.jpg>` shows every player in every
   jersey, with the lineup tile sizes.

## Who gets jerseys

Players whose portrait would change jersey on the site: more than one team, or more than
one palette era of one team, since 2013-14. Players who only ever wear one jersey keep
their approved portrait (and its real jersey, logos and all) with no colour-key edit;
queue one when he changes team (`codex-queue.js --jersey-key --slugs <slug>`).

## Palettes

`data/jersey-palettes.json`: per team, eras of `{ id, from, to?, body, trim: [{ color, to? }],
shade? }`; trim stripes run from the skin edge (0) to the jersey body (1). An era only
where the colours changed a lot since 2013-14; `check: true` marks colours still to
confirm. A new uniform is a new era entry and a rebuild, no Codex.

## On the site

The profile carries `jerseys` (layers by slug for him and his lineup teammates),
`seasons[i].jersey` and each lineup person's `jersey`. The frontend lays the season's
sprite frame over the base headshot (`JerseyOverlay`): a 360ms crossfade on the bio
card (none with reduced motion), static in lineup tiles. Players without layers (and the NBA.com fallbacks) keep
their portrait as it is.
