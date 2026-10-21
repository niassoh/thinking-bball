# Basketball Player Portrait Reference Pack

This folder is the source of truth for generating the site's stylized player portraits.

## How to use it with Claude Code

Tell Claude Code:

> Use `basketball-player-portrait-reference-pack/` as the visual and procedural reference for finding source photos and generating player portrait assets. Read `CLAUDE_CODE_TASK.md`, `SOURCE_SELECTION.md`, `GENERATION_PROMPT.md`, and `QA_CHECKLIST.md` before generating anything. Treat `references/style-primary-mccain.png` as the primary crop/simplification reference and `references/style-thumbnail-sheet.png` as the broader style reference. Always generate from the original real source photo, never from a previous generated result.

## Reference files

- `references/style-primary-mccain.png` — primary reference for tight crop, broad simplified facial planes, silhouette, and dark neutral background. Use its structure/style, **not its warm/orange color cast**.
- `references/style-thumbnail-sheet.png` — broader reference for the target Thinking Basketball-like illustrated thumbnail aesthetic: simplified faces, smooth/glossy blocks, limited detail, strong silhouettes.
- `references/source-example-emotive.png` — example of a source photo with strong emotion. The exact player/photo is not the target; it demonstrates desirable source-photo energy.
- `references/source-example-dynamic.png` — example of a source photo with a natural game expression / off-axis pose instead of a static media-day portrait.

## Non-negotiables

1. Find a **real source photograph** first.
2. Prefer a photo that is **somewhat emotive or dynamic**—focused, reacting, shouting/talking, celebrating, looking off-camera, or otherwise showing game energy.
3. Avoid lifeless media-day/passport-style source images when a strong game/editorial image is available.
4. Keep the face unobstructed and large enough to support a tight crop.
5. Generate from the original real source photo on every attempt.
6. Portraits should be clearly illustrated and simplified, not photorealistic.
7. Use a dark neutral charcoal background with no arena lights or white haze.
8. Preserve the real jersey base color and trim colors.
9. Avoid orange/golden skin casts.

See the other files for the exact workflow and prompt.
