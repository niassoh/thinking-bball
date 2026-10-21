# Master Generation Prompt — `thinking-basketball-v3`

Use an image-edit / image-to-image model. The real player photograph is the **SUBJECT** reference.

If the model supports multiple image references:

- SUBJECT: the selected real player photograph
- STYLE: `references/style-primary-mccain.png`
- SECONDARY STYLE: `references/style-thumbnail-sheet.png`

The style references control simplification, crop, texture, contrast, and overall art direction only. Never transfer another player's identity, facial anatomy, hairstyle, skin tone, pose, or jersey.

---

## Prompt

Transform the supplied basketball-player photograph into a simplified premium sports editorial illustration for a basketball analytics website.

### IDENTITY / POSE

Preserve the subject's recognizable identity, facial proportions, expression, gaze direction, head angle, hairstyle, facial hair, and natural skin tone.

Do not beautify, reshape, age-shift, or rotate the subject into a different pose.

If the source has a dynamic or emotive expression, PRESERVE IT. Do not neutralize a focused gaze, reaction, open mouth, side glance, or game-time expression into a generic portrait smile.

### COMPOSITION

Create a very tight head-and-upper-shoulders portrait.

- face and head dominate the image
- hair reasonably close to the top edge
- shoulders visible only enough to establish the jersey
- minimal torso
- keep the source head orientation and gaze
- square 1:1 composition
- target output: 1024×1024

### STYLE

Match the supplied style references.

The image must read immediately as an **illustration**, not as a photograph with a filter.

Use:

- flat triangular/angular color planes (see SHADING below)
- graphic faceted facial planes
- clean matte sports-thumbnail finish
- clean silhouette
- strong but controlled contrast
- restrained painterly texture
- simplified hair masses
- simplified beard / facial-hair masses
- reduced micro-detail
- bold readability at 100–250 px display size

Think approximately:

**70–80% stylized illustration / 20–30% photographic realism**

When uncertain, SIMPLIFY.

### DETAIL LEVEL — VERY IMPORTANT

Do not render photographic micro-detail.

Avoid:

- pores
- sweat droplets
- realistic skin grain
- individual beard hairs
- excessive individual hair strands
- highly detailed irises
- tiny wrinkles and blemishes
- photographic specular reflections
- hyperreal lighting
- hard comic-book ink outlines
- anime/cartoon exaggeration

Facial volume should come from a moderate number of flat, medium-sized triangular/angular planes (see SHADING), not from photographic gradients, pores or brush marks.

The style references are intentionally more simplified than realism. Match that simplification.

### SHADING — MATCH THE PRIMARY STYLE REFERENCE

Build facial volume and hair from visible flat triangular/angular planes, a faceted vector-portrait look like the primary style reference.

- Use medium-sized facets that follow the facial structure: forehead, brow ridge, cheekbones, nose bridge, jaw, chin, neck.
- Each facet is a flat or near-flat tone. Light and shadow come from the arrangement of facets, not from smooth gradients.
- Hair and facial hair are built from the same angular planes, as clustered faceted masses.
- Facet edges are crisp but soft-contrast: no outlines, no glowing seams.
- The result must read clearly as an illustration, not as a filtered photograph.

Do NOT overprocess:

- no swarm of tiny shards, mosaic noise or stained-glass fragmentation
- no glossy, HDR or plastic "AI render" look
- no over-sharpened edges, halos or rim glows
- no airbrushed, porcelain-smooth skin
- no extra glow, bloom or lens effects
- no busy texture in the background

### COLOR

Maintain neutral, believable skin color.

Do NOT apply a global orange, amber, bronze, or golden cast.

Use:

- neutral tan/brown skin values appropriate to the subject
- neutral-to-slightly-cool brown shadows
- cream/neutral highlights rather than yellow highlights
- restrained saturation
- localized red/pink mainly around lips, ears, and natural facial warmth

If the result begins looking orange or sunlit, neutralize it.

### JERSEY

Preserve the source jersey's actual base color and recognizable trim colors.

Do not recolor the uniform.

Small logos, numbers, sponsors, and lettering may be simplified or omitted if needed; accurate facial identity and color are more important.

### BACKGROUND

Use a quiet, dark, neutral charcoal backdrop similar to the primary style reference.

Target range: approximately `#202020` to `#282725`.

A very subtle dark vignette / tonal falloff is acceptable.

Do NOT add:

- arena lights
- white haze
- white bokeh dots
- glowing circles
- crowd detail
- blue atmospheric haze
- smoky white patches
- text
- logos
- graphics
- scenery

The background should register as a simple premium dark charcoal field, not an arena.

### FINAL RESULT

The final image should feel like a Thinking Basketball-style illustrated player cutout adapted into a clean square profile asset: expressive source pose, recognizable likeness, aggressively simplified rendering, strong silhouette, neutral dark background, accurate jersey colors, and no photorealistic micro-detail.
