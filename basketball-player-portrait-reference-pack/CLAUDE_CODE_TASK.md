# Claude Code Task

Implement a repeatable player portrait pipeline using this reference pack as ground truth.

## Before coding

Inspect the current repository and determine:

- source of player IDs/names
- existing asset paths and naming conventions
- runtime/language
- existing image API configuration
- any current image-processing dependencies
- how the frontend currently resolves player images

Do not invent a parallel architecture if the repo already has a suitable pattern.

## Pipeline

For each requested player:

1. Resolve player ID / slug.
2. Gather several candidate **real photographs**.
3. Read `SOURCE_SELECTION.md` and rank candidates.
4. Prefer a somewhat emotive/dynamic game or editorial image over a sterile headshot when it remains technically usable.
5. Save the selected original source locally.
6. Generate a portrait using `GENERATION_PROMPT.md` and the reference images in `references/`.
7. Run the checks in `QA_CHECKLIST.md`.
8. If rejected, retry from the original source photo, maximum 3 attempts.
9. Save the accepted master portrait.
10. Create optimized WebP derivatives for the UI.
11. Record source/generation metadata.

## Suggested paths

```text
assets/player-sources/{player-id-or-slug}.{ext}
assets/players/{player-id-or-slug}.png
assets/players/webp/{player-id-or-slug}-400.webp
assets/players/webp/{player-id-or-slug}-200.webp
assets/players/webp/{player-id-or-slug}-100.webp
assets/players/metadata/{player-id-or-slug}.json
```

Adapt these to the repository's existing conventions when appropriate.

## Metadata

Record at minimum:

```json
{
  "player": "Player Name",
  "playerId": "...",
  "sourceUrl": "...",
  "sourceFile": "...",
  "sourceSelectionScore": 0,
  "promptVersion": "thinking-basketball-v2",
  "generationAttempt": 1,
  "masterFile": "...",
  "approved": true
}
```

## Source acquisition

Use only image sources the project is authorized to download/transform/publish. Preserve the source URL and attribution/license metadata where applicable.

## Critical behavior

Do not silently accept the first generated image.

The QA stage is part of the pipeline. A generated result that is too photorealistic, too orange, too detailed, too static compared with the source, or has bright arena/bokeh background elements should be regenerated automatically.
