# Source Photo Rules (refined 2026-10-01)

These rules are applied **on top of**
`basketball-player-portrait-reference-pack/SOURCE_SELECTION.md`. They come from
user feedback on the first selection round ("the candidates are awful": the
Jokić source was an All-Star warmup, and the SGA source was far too intense).
Where the two documents disagree, this file wins. The energy band stays
SOURCE_SELECTION.md's 6–8/10, calibrated against the McCain reference.

Target look: `references/style-primary-mccain.png`. He is alert and engaged in the
moment, looking up and off-camera, mouth open mid-reaction or mid-breath, with
real game concentration, in game uniform. `references/source-example-dynamic.png`
shows a natural in-game look-off.

## Hard requirements (reject if any fail)

1. **Real in-game moment in the regular game uniform.** No warmup or
   shooting shirts, All-Star, national-team, media day, practice, or
   bench-in-street-clothes photos.
2. **McCain-level energy, about 6–8/10.** Alert, engaged, looking up or
   off-camera, mouth open mid-reaction or mid-breath, real game concentration.
   - **Too low (reject):** neutral, calm or passive faces, blank stares, ID-photo looks.
   - **Too high (reject):** past the band, like the rejected SGA drive
     (wide-eyed, mouth agape, straining or charging), and shouting, screaming,
     grimacing, flexing, extreme celebration or mid-dunk faces.
   - **Calibration:** McCain reference = 7/10; rejected SGA pick = 9–10/10;
     rejected Haliburton-style neutral stare = 3–4/10.
3. **Face large, sharp and unobstructed.** The head is roughly frontal to 3/4,
   and the face is at least ~250 px tall in the source.
4. **No watermark.** Getty, AP or other watermarked previews are rejected.

## Strong preferences

- **Current team jersey** (2025-26 or 2026-27). An older team is acceptable
  only if nothing usable exists, and the record must flag it.
- Source priority: (1) official team site or NBA.com game galleries;
  (2) editorial wire or sports-photo pages; (3) other high-quality game photos.
  Wikimedia Commons is still acceptable when a photo meets every rule above.

## Scoring

Score with SOURCE_SELECTION.md's 16-point table, with two changes:

- **Expression / game energy (0–3)** is scored against McCain (7/10):
  3 = 6–8/10, comparable to McCain; 2 = just outside the band (5 or 8.5);
  1 = clearly off (4 or 9); 0 = violates hard requirement 2.
- **Current jersey/team relevance (0–1)**: 1 only for the 2025-26 or 2026-27 team.

Also record per pick: `energy` (1–10, McCain = 7), `energyVsMcCain`
(e.g. "slightly lower", "matches", "slightly higher"), `jersey` (team +
season), and `concerns`.

## Recording

Every pick records `sourceUrl`, `sourcePage`, `license` (`"unknown"` when not
clearly licensed) and `author` if known. All choices live in `selections.sh`.
Earlier picks move to `rejectedCandidates` with reason
`"user feedback 2026-10-01"`.
