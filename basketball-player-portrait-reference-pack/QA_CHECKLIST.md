# Generation QA / Regeneration Rules

Evaluate every generated portrait before accepting it.

## Must pass

- [ ] recognizable as the source player
- [ ] source expression and gaze are substantially preserved
- [ ] tight head-and-shoulders crop
- [ ] illustrated / simplified at first glance
- [ ] triangular/faceted planes similar to the McCain reference (medium facets that follow the facial structure)
- [ ] hair and facial hair simplified into masses
- [ ] skin is not orange/golden
- [ ] jersey base/trim colors remain faithful
- [ ] background is dark neutral charcoal
- [ ] no white haze, arena lights, or bokeh
- [ ] reads clearly at ~150–200 px tall

## Reject / regenerate if

- face becomes generic or identity drifts
- expression is neutralized or changed substantially
- skin becomes orange, bronze, amber, or heavily saturated
- portrait looks too photographic (smooth photo skin)
- there are visible pores/sweat/skin grain
- beard/hair has excessive strand-level detail
- model invents a different hairstyle
- model changes jersey color
- bright background spots/lights appear
- too much torso is visible
- player becomes front-facing when source is clearly angled
- image becomes anime, caricature, comic art, or a 3D low-poly render
- overprocessed / AI look: plastic gloss, HDR, oversharpening, halos, shard noise
- facets so small or chaotic that the face reads as mosaic

## Retry behavior

Allow up to 3 attempts.

Every retry MUST start from the original real source image and the fixed style references.

Never use a rejected generated result as the next generation's subject input. This prevents cumulative identity/style drift.

On retry, add only the failed constraint(s), e.g.:

- "Build the face from medium-sized flat triangular planes like the primary style reference; remove photographic skin."
- "Neutralize the orange skin cast."
- "Remove all bright background lights; use flat charcoal."
- "Preserve the original side-facing head angle."

Do not rewrite the entire aesthetic on each retry.
