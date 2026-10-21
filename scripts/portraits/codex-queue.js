// Hands portrait generation to Codex (ChatGPT image tool) and brings results back.
//
// Queue: one folder per player whose source is recorded and who has no approved
// portrait or attempt awaiting QA. Each holds the exact subject image and prompt
// generate.js would send (via --dry-run); the two style references are shared in
// <dir>/refs/. CODEX_TASK.md says what to make.
//   node scripts/portraits/codex-queue.js --out <dir>
//   node scripts/portraits/codex-queue.js --out <dir> --slug <slug> --fix crop --fix orange-skin   (retry bundle)
// Redo: --redo queues every approved portrait that was made through the API, from
// the same source and crop, as attempt 1 of a new round (generate.js --new-round
// archives the API attempts). The live portrait stays until a redo is finalized.
//   node scripts/portraits/codex-queue.js --out <dir> --redo
// Transparent: --transparent queues every live portrait not already transparent,
// from the same source and crop, with the transparent-background prompt
// (generate.js --background transparent) as a new round. Import rejects outputs
// without real alpha, leaving the folder for Codex to redo.
//   node scripts/portraits/codex-queue.js --out <dir> --transparent
//
// Re-jersey: --rejersey queues every approved portrait whose jersey (metadata.jersey,
// team code first) is a team the player has left (data/depth/_index.json). Each folder
// holds the live portrait, a reference portrait in the new team's jersey and an edit
// prompt that changes only the jersey; import makes it attempt 1 of a new round (or the
// next attempt, retrying a failed one), and finalize records the new jersey.
// --ref TEAM=slug overrides a team's reference. Players with no current team are skipped.
// --to TEAM (with --slug) asks for that team's jersey instead of his current one, e.g. to
// compare a full-detail edit with a jersey-key composite (don't import those).
//   node scripts/portraits/codex-queue.js --out <dir> --rejersey [--slug <slug>] [--ref PHI=tyrese-maxey]
//
// Jersey key: --jersey-key queues approved portraits for a colour-key edit: Codex
// repaints only the jersey in key colours (body magenta, collar and armhole binding
// cyan, no lettering), which scripts/portraits/jersey-key.js lifts into a jersey map
// that jersey-build.js recolours for any team. The edit is always of the approved
// portrait, and its attempts go to metadata.jerseyKey, never to the portrait (the site
// keeps the approved face pixels). --slugs a,b limits the queue and --limit N caps it;
// --slug <slug> --fix <key> queues a retry with one of KEY_FIXES.
//   node scripts/portraits/codex-queue.js --out <dir> --jersey-key [--slugs a,b] [--limit N]
//   node scripts/portraits/codex-queue.js --out <dir> --jersey-key --slug <slug> --fix reframe
//
// Import: every <dir>/<slug>/out.png not yet imported becomes that bundle's
// attempt (generate.js --import; jersey-key bundles through jersey-key.js --import);
// the file is renamed out-imported-<n>.png. QA and --finalize then run as usual
// (scripts/portraits/jersey-check.js for jerseys).
//   node scripts/portraits/codex-queue.js --import <dir>
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execFileSync } = require('child_process')
const sharp = require('sharp')

const ROOT = path.join(__dirname, '..', '..')
const PACK = path.join(ROOT, 'basketball-player-portrait-reference-pack', 'references')
const METADATA = path.join(ROOT, 'assets', 'players', 'metadata')
const TARGETS = path.join(ROOT, 'data', 'portrait-targets.json')
const GENERATE = path.join(__dirname, 'generate.js')
const JERSEY_KEY = path.join(__dirname, 'jersey-key.js')
const REFS = [['style-primary-mccain.png', 'ref-1-mccain.png'], ['style-thumbnail-sheet.png', 'ref-2-thumbnail-sheet.png']]

const args = process.argv.slice(2)
const arg = name => {
  const i = args.indexOf(name)
  return i === -1 ? null : args[i + 1]
}
const all = name => args.flatMap((a, i) => (a === name ? [args[i + 1]] : []))
const readMeta = slug => {
  const file = path.join(METADATA, `${slug}.json`)
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null
}

const TASK = `# Portrait queue for Codex

Each folder here (except refs/) is one player. For every folder that has no
out.png yet:

1. Use your built-in image generation / editing tool (GPT Image). Do not draw
   with code, SVG, canvas or PIL, and do not use any API key from the repo.
2. Make ONE image edit with these three images, in this order:
   - Image 1: <folder>/source.png (the SUBJECT, a real player photo)
   - Image 2: refs/ref-1-mccain.png (primary STYLE reference)
   - Image 3: refs/ref-2-thumbnail-sheet.png (secondary STYLE reference)
   and the contents of <folder>/prompt.txt as the prompt, verbatim.
3. Output 1024x1024 PNG at the highest quality available; save it as
   <folder>/out.png.

If a folder's prompt asks for a transparent background, the saved PNG must have
a real alpha channel (transparent pixels), not a painted checkerboard or colour.

Don't change any other file and don't run git. Work through ALL the folders in
name order, one after another, in this one run: don't stop between folders to
report, summarise or ask whether to continue, and don't split the work into
batches. Keep going until every folder has out.png. Stop early only if the image
tool itself refuses to make more images (a hard usage limit), and then say which
folders are done.
`

const JERSEY_TASK = `# Jersey queue for Codex

Each folder here is one player whose portrait shows a team he has left. For every
folder that has no out.png yet:

1. Use your built-in image generation / editing tool (GPT Image). Do not draw
   with code, SVG, canvas or PIL, and do not use any API key from the repo.
2. Make ONE image edit with these two images, in this order:
   - Image 1: <folder>/portrait.png (the player portrait to edit)
   - Image 2: <folder>/jersey-ref.png (the new team's jersey, on another player)
   and the contents of <folder>/prompt.txt as the prompt, verbatim.
3. Output a 1024x1024 PNG at the highest quality available with a real alpha
   channel (transparent pixels, never a painted checkerboard or colour); save it
   as <folder>/out.png.

Only the jersey may change. If the face, hair, skin or head angle comes out
different, make the edit again before saving.

Don't change any other file and don't run git. Work through the folders in
name order; if you hit a usage limit, stop and say which folders are done.
`

const KEY_TASK = `# Jersey colour-key queue for Codex

Each folder here is one player portrait. For every folder that has no out.png yet:

1. Use your built-in image generation / editing tool (GPT Image). Do not draw
   with code, SVG, canvas or PIL, and do not use any API key from the repo.
2. Make ONE image edit of <folder>/portrait.png, with the contents of
   <folder>/prompt.txt as the prompt, verbatim.
3. Output a 1024x1024 PNG at the highest quality available with a real alpha
   channel (transparent pixels, never a painted checkerboard or colour); save it
   as <folder>/out.png.

Before saving, check the result: only the jersey is magenta and cyan (no tint on
skin, beard or anything else), no letters, numbers, logos or patches remain on it,
and the head, shoulders and crop are the same size and in the same position as in
portrait.png. If not, make the edit again.

Don't change any other file and don't run git. Work through the folders in
name order; if you hit a usage limit, stop and say which folders are done.
`

const KEY_PROMPT = `Edit Image 1 (an illustrated basketball portrait). This is a colour-key edit for compositing: recolour ONLY the jersey fabric with two flat key colours, so a script can later paint in any team's colours.

1. JERSEY BODY -> MAGENTA. All jersey fabric except the binding trim (front, shoulder straps, side panels, and any stripes, piping or patterns on them) becomes magenta. Keep the jersey's existing faceted light and shadow planes, painted only as lighter and darker magenta: deep magenta (#8C008C) in the darkest planes, pure magenta (#FF00FF) for most of it, pale magenta (#FF8CFF) on the brightest planes. The hue stays magenta everywhere.
2. TRIM -> CYAN. The collar binding and both armhole bindings, including every stripe inside them, become ONE solid cyan band (#00FFFF, darker #008C8C in shadow) with the same outline, width and position as the current trim.
3. Remove every number, letter, wordmark, logo, maker mark and sponsor patch from the jersey; continue the magenta facets across where they were. The jersey must be plain.

Do not change anything else: face, features, expression, skin tone, hair, beard, ears, neck, shoulders, arms, hands, tattoos, headband, goggles, undershirt or T-shirt, arm sleeves, lighting and the transparent background stay exactly as in Image 1. No magenta or cyan tint, glow or outline on skin, beard or hair, and no magenta or cyan anywhere outside the jersey. Keep the jersey's outline exactly where it is now, with a crisp edge against skin and beard.

Keep the exact framing and scale of Image 1: the head, shoulders and crop edges must be the same size and in the same position. Do not zoom, crop, re-centre, extend or restyle the image. Output a 1024x1024 PNG with real transparency (alpha), saved as out.png.
`

// One sentence per failure, appended to a retry's prompt (one or two per retry).
const KEY_FIXES = {
  reframe: 'IMPORTANT: The previous attempt zoomed or moved the image. Keep the exact framing and scale of Image 1; do not zoom, crop or re-centre.',
  'not-key': 'IMPORTANT: The previous attempt left team colours on the jersey. Every part of the jersey must be magenta (body) or cyan (collar and armhole binding); no white, black, grey or team colour may remain on it.',
  missed: 'IMPORTANT: The previous attempt missed part of the jersey. Recolour ALL jersey fabric, including shoulder straps, side panels and fabric at the edges of the frame.',
  overreach: 'IMPORTANT: The previous attempt recoloured something that is not the jersey. Only the jersey changes; headband, undershirt, T-shirt sleeves, arm sleeves, tattoos, skin and hair keep their exact colours.',
  logos: 'IMPORTANT: The previous attempt left lettering or a logo. The jersey must be completely plain magenta with cyan trim: no letters, numbers, logos or patches, not even faint outlines.',
  spill: 'IMPORTANT: The previous attempt tinted the skin near the collar. Skin, neck and beard next to the jersey keep their exact colours; no pink or cyan glow.',
  flat: 'IMPORTANT: The previous attempt painted the jersey as one flat colour. Keep its faceted light and shadow planes as lighter and darker magenta.',
  trim: 'IMPORTANT: The previous attempt got the trim wrong. The whole collar binding and both armhole bindings are one cyan band, and nothing else in the image is cyan.'
}
// A source concern about something worn besides the jersey becomes a line in the prompt.
const ACCESSORY = /headband|sleeve|shirt|tattoo|goggles|mask|brace|band/i

// Team names for the jersey prompt.
const TEAM_NAMES = {
  ATL: 'Atlanta Hawks', BKN: 'Brooklyn Nets', BOS: 'Boston Celtics', CHA: 'Charlotte Hornets', CHI: 'Chicago Bulls',
  CLE: 'Cleveland Cavaliers', DAL: 'Dallas Mavericks', DEN: 'Denver Nuggets', DET: 'Detroit Pistons', GSW: 'Golden State Warriors',
  HOU: 'Houston Rockets', IND: 'Indiana Pacers', LAC: 'LA Clippers', LAL: 'Los Angeles Lakers', MEM: 'Memphis Grizzlies',
  MIA: 'Miami Heat', MIL: 'Milwaukee Bucks', MIN: 'Minnesota Timberwolves', NOP: 'New Orleans Pelicans', NYK: 'New York Knicks',
  OKC: 'Oklahoma City Thunder', ORL: 'Orlando Magic', PHI: 'Philadelphia 76ers', PHX: 'Phoenix Suns', POR: 'Portland Trail Blazers',
  SAC: 'Sacramento Kings', SAS: 'San Antonio Spurs', TOR: 'Toronto Raptors', UTA: 'Utah Jazz', WAS: 'Washington Wizards'
}

const jerseyPrompt = (team, transparent) => `Edit Image 1 (the player portrait). Change ONLY the jersey so it is the ${TEAM_NAMES[team]} jersey shown in Image 2: match its base colour, trim colours and stripes, neckline and armhole trim, and the wordmark, logo and sponsor-patch placement, as far as they fall inside Image 1's crop. Keep everything else exactly as in Image 1: face, features, expression, skin tone, hair, beard, head angle, ears, neck, shoulders, arms, tattoos, lighting, framing and the ${transparent ? 'transparent background' : 'player; replace the dark background with full transparency'}. Do not redraw, restyle or re-light the face. Take nothing from Image 2 except the jersey design (not its player, pose, body or skin). Paint the new jersey in the same flat, faceted illustration style as the rest of Image 1. Output a 1024x1024 PNG with real transparency (alpha), saved as out.png.
`

const REDO_REASON = 'redo via Codex: the user found Codex images better than the API ones'
const TRANSPARENT_REASON = 'redo with a transparent background (user)'

const bundle = (dir, slug, fixes, newRound = null, background = 'charcoal') => {
  const meta = readMeta(slug)
  // A round with no attempts yet (e.g. a redo queued but never made) is reused.
  const startRound = newRound && (meta.attempts || []).length > 0
  const attempt = startRound ? 1 : (meta.attempts || []).length + 1
  if (attempt > 3) throw new Error(`${slug} already has 3 attempts this round`)
  const out = path.join(dir, slug)
  fs.rmSync(out, { recursive: true, force: true })
  fs.mkdirSync(out, { recursive: true })
  const round = startRound ? ['--new-round', newRound] : []
  const printed = execFileSync('node', [GENERATE, '--slug', slug, '--attempt', String(attempt), '--dry-run', path.join(out, 'source.png'), '--confirm-review', '--background', background, ...round, ...fixes.flatMap(f => ['--fix', f])]).toString()
  fs.writeFileSync(path.join(out, 'prompt.txt'), printed.split('\n').slice(2).join('\n').trim() + '\n')
  fs.writeFileSync(path.join(out, 'bundle.json'), JSON.stringify({ slug, attempt, fixes, background, createdAt: new Date().toISOString() }, null, 2) + '\n')
  return attempt
}

// The live portrait as a 1024 PNG: the master if it's here (masters are gitignored),
// else the committed 1024 WebP.
const portraitPng = async (slug, dest) => {
  const master = path.join(ROOT, 'assets', 'players', `${slug}.png`)
  if (fs.existsSync(master)) return fs.copyFileSync(master, dest)
  await sharp(path.join(ROOT, 'assets', 'players', 'webp', `${slug}-1024.webp`)).png().toFile(dest)
}

const jerseyTeam = meta => (meta.jersey || '').slice(0, 3)

// The reference for a team's jersey: a portrait of a player still on that team wearing
// it, a 2025-26 jersey and a transparent portrait first; failing that, any portrait in
// that team's jersey (e.g. one of a player who has since left).
const jerseyRef = (team, metas, current) => {
  const override = all('--ref').map(r => r.split('=')).find(([t]) => t === team)
  if (override) return override[1]
  const wearing = metas.filter(([, m]) => m.approved && jerseyTeam(m) === team)
  const score = ([slug, m]) => (current[slug] === team ? 4 : 0) + (/2025-26/.test(m.jersey) ? 2 : 0) + (m.background === 'transparent' ? 1 : 0)
  const best = wearing.sort((a, b) => score(b) - score(a) || a[0].localeCompare(b[0]))[0]
  return best ? best[0] : null
}

const queueJerseys = async dir => {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'CODEX_TASK.md'), JERSEY_TASK)
  const current = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'depth', '_index.json'), 'utf8'))
  const metas = fs.readdirSync(METADATA).filter(f => f.endsWith('.json')).map(f => [f.slice(0, -5), readMeta(f.slice(0, -5))])
  const only = arg('--slug')
  const made = []
  const skipped = []
  for (const [slug, meta] of metas) {
    if (only && slug !== only) continue
    if (!meta.approved || !meta.jersey) continue
    const from = jerseyTeam(meta)
    const to = (only && arg('--to')) || current[slug]
    if (!to) { skipped.push(`${slug}: no current team`); continue }
    if (from === to) continue
    if (fs.existsSync(path.join(dir, slug, 'bundle.json'))) continue // already queued
    if ((meta.attempts || []).some(a => !a.qa)) { skipped.push(`${slug}: an attempt is awaiting QA`); continue }
    const ref = jerseyRef(to, metas, current)
    if (!ref) { skipped.push(`${slug}: no ${to} jersey reference`); continue }
    // A jersey round already under way (its last attempt failed QA) gets the next attempt.
    const lastRound = (meta.previousRounds || []).slice(-1)[0]
    const inRound = lastRound && /^jersey:/.test(lastRound.reason) && (meta.attempts || []).length > 0 && meta.attempts.every(a => a.qa && a.qa.verdict === 'fail')
    const attempt = inRound ? meta.attempts.length + 1 : 1
    if (attempt > 3) { skipped.push(`${slug}: 3 jersey attempts already`); continue }
    const out = path.join(dir, slug)
    fs.rmSync(out, { recursive: true, force: true })
    fs.mkdirSync(out, { recursive: true })
    await portraitPng(slug, path.join(out, 'portrait.png'))
    await portraitPng(ref, path.join(out, 'jersey-ref.png'))
    // A retry follows a failed attempt; so far every failure was the image reframed
    // (head zoomed and moved), so the retry spells framing out.
    const retry = inRound ? `\nIMPORTANT: The previous attempt zoomed in and moved the head. Keep the exact framing and scale of Image 1: the head, shoulders and crop edges must be the same size and in the same position as in Image 1. Do not zoom, crop or re-centre.\n` : ''
    fs.writeFileSync(path.join(out, 'prompt.txt'), jerseyPrompt(to, meta.background === 'transparent') + retry)
    fs.writeFileSync(path.join(out, 'bundle.json'), JSON.stringify({ slug, mode: 'jersey', from, to, reference: ref, attempt, newRound: !inRound, fixes: [], background: 'transparent', createdAt: new Date().toISOString() }, null, 2) + '\n')
    made.push(`${slug} ${from}->${to} (ref ${ref}${inRound ? `, attempt ${attempt}` : ''})`)
  }
  console.log(`queued ${made.length}:\n  ${made.join('\n  ')}`)
  if (skipped.length) console.log(`not queued ${skipped.length}:\n  ${skipped.join('\n  ')}`)
}

// The committed 1024 WebP identifies the approved portrait a jersey map was made for
// (masters are gitignored); a map made for an earlier portrait is stale.
const baseSha1 = slug => crypto.createHash('sha1').update(fs.readFileSync(path.join(ROOT, 'assets', 'players', 'webp', `${slug}-1024.webp`))).digest('hex')

const queueKeys = async dir => {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'CODEX_TASK.md'), KEY_TASK)
  const fixes = all('--fix')
  for (const f of fixes) if (!KEY_FIXES[f]) throw new Error(`unknown --fix ${f}: one of ${Object.keys(KEY_FIXES).join(', ')}`)
  const only = arg('--slug') ? [arg('--slug')] : arg('--slugs') ? arg('--slugs').split(',') : null
  const limit = arg('--limit') ? Number(arg('--limit')) : Infinity
  const slugs = only || fs.readdirSync(METADATA).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort()
  const made = []
  const skipped = []
  for (const slug of slugs) {
    if (made.length >= limit) break
    const meta = readMeta(slug)
    if (!meta || !meta.approved) { skipped.push(`${slug}: no approved portrait`); continue }
    const key = meta.jerseyKey || {}
    if (key.approvedAttempt && !only) continue
    if (fs.existsSync(path.join(dir, slug, 'bundle.json'))) { skipped.push(`${slug}: already queued`); continue }
    const attempts = key.attempts || []
    if (attempts.some(a => !a.qa)) { skipped.push(`${slug}: an attempt is awaiting QA`); continue }
    const attempt = attempts.length + 1
    if (attempt > 3) { skipped.push(`${slug}: 3 attempts already`); continue }
    const out = path.join(dir, slug)
    fs.rmSync(out, { recursive: true, force: true })
    fs.mkdirSync(out, { recursive: true })
    await portraitPng(slug, path.join(out, 'portrait.png'))
    const note = ACCESSORY.test(meta.concerns || '') ? `\nNote on this portrait: ${meta.concerns}. Leave that exactly as it is.\n` : ''
    fs.writeFileSync(path.join(out, 'prompt.txt'), KEY_PROMPT + note + fixes.map(f => `\n${KEY_FIXES[f]}\n`).join(''))
    fs.writeFileSync(path.join(out, 'bundle.json'), JSON.stringify({ slug, mode: 'jersey-key', attempt, fixes, base: baseSha1(slug), createdAt: new Date().toISOString() }, null, 2) + '\n')
    made.push(`${slug} (attempt ${attempt}${fixes.length ? `, fixes ${fixes.join(' ')}` : ''})`)
  }
  console.log(`queued ${made.length}:\n  ${made.join('\n  ')}`)
  if (skipped.length) console.log(`not queued ${skipped.length}:\n  ${skipped.join('\n  ')}`)
}

const queue = dir => {
  if (args.includes('--rejersey')) return queueJerseys(dir)
  if (args.includes('--jersey-key')) return queueKeys(dir)
  fs.mkdirSync(path.join(dir, 'refs'), { recursive: true })
  for (const [from, to] of REFS) fs.copyFileSync(path.join(PACK, from), path.join(dir, 'refs', to))
  fs.writeFileSync(path.join(dir, 'CODEX_TASK.md'), TASK)
  const slug = arg('--slug')
  const transparent = args.includes('--transparent')
  if (slug) {
    // With --fix it's a retry in the current round; without, a fresh transparent round.
    const retry = all('--fix').length > 0
    console.log(`${slug}: bundle for attempt ${transparent ? bundle(dir, slug, all('--fix'), retry ? null : TRANSPARENT_REASON, 'transparent') : bundle(dir, slug, all('--fix'))}`)
    return
  }
  const made = []
  const failed = []
  const redo = args.includes('--redo')
  const targets = JSON.parse(fs.readFileSync(TARGETS, 'utf8'))
  const batchSlugs = new Set(((targets.batches || []).find(b => b.batch === arg('--batch')) || {}).slugs || [])
  for (const t of targets.targets) {
    const meta = readMeta(t.slug)
    if (transparent) {
      if (!meta || meta.background === 'transparent' || fs.existsSync(path.join(dir, t.slug, 'bundle.json'))) continue
      // --batch <name> limits the queue to one target batch (e.g. new players only): its
      // targets and the earlier ones it picked again (its `slugs`).
      if (arg('--batch') && t.batch !== arg('--batch') && !batchSlugs.has(t.slug)) continue
      // Live portraits get a new transparent round; sourced players without one start transparent.
      const fresh = !meta.approved
      if (fresh && (!meta.sourceUrl || meta.needsReview || (meta.attempts || []).some(a => !a.qa))) continue
      try {
        made.push(`${t.slug} (attempt ${bundle(dir, t.slug, [], fresh ? null : TRANSPARENT_REASON, 'transparent')})`)
      } catch (err) {
        fs.rmSync(path.join(dir, t.slug), { recursive: true, force: true })
        failed.push(`${t.slug}: ${String(err.stderr || err.message).trim().split('\n')[0]}`)
      }
      continue
    }
    if (redo) {
      const live = meta && meta.approved && (meta.attempts || []).find(a => a.attempt === meta.generationAttempt)
      if (!live || /codex/i.test(live.model) || fs.existsSync(path.join(dir, t.slug, 'bundle.json'))) continue
      try {
        made.push(`${t.slug} (new round, attempt ${bundle(dir, t.slug, [], REDO_REASON)})`)
      } catch (err) {
        fs.rmSync(path.join(dir, t.slug), { recursive: true, force: true })
        failed.push(`${t.slug}: ${String(err.stderr || err.message).trim().split('\n')[0]}`)
      }
      continue
    }
    if (!meta || !meta.sourceUrl || meta.approved) continue
    if ((meta.attempts || []).some(a => !a.qa)) continue // awaiting QA
    if (fs.existsSync(path.join(dir, t.slug, 'bundle.json'))) continue // already queued
    try {
      made.push(`${t.slug} (attempt ${bundle(dir, t.slug, [])})`)
    } catch (err) {
      fs.rmSync(path.join(dir, t.slug), { recursive: true, force: true })
      failed.push(`${t.slug}: ${String(err.stderr || err.message).trim().split('\n')[0]}`)
    }
  }
  console.log(`queued ${made.length}: ${made.join(', ')}`)
  if (failed.length) console.log(`not queued ${failed.length}:\n  ${failed.join('\n  ')}`)
}

// Imported bundles move to <dir>-done/ so Codex (which works on every folder
// without an out.png) never sees them again.
const importAll = dir => {
  const done = []
  const rejected = []
  const archive = `${dir.replace(/\/$/, '')}-done`
  fs.mkdirSync(archive, { recursive: true })
  // A re-sourced player can be redone more than once, so never overwrite an earlier retired bundle.
  const retire = (slug, attempt) => {
    let dest = path.join(archive, `${slug}-a${attempt}`)
    for (let n = 2; fs.existsSync(dest); n++) dest = path.join(archive, `${slug}-a${attempt}-${n}`)
    fs.renameSync(path.join(dir, slug), dest)
  }
  for (const slug of fs.readdirSync(dir).filter(d => fs.existsSync(path.join(dir, d, 'bundle.json')))) {
    const png = path.join(dir, slug, 'out.png')
    if (!fs.existsSync(png)) continue
    const { attempt, fixes, background = 'charcoal', mode, from, to, reference, newRound } = JSON.parse(fs.readFileSync(path.join(dir, slug, 'bundle.json'), 'utf8'))
    // A jersey edit starts a new round on its first attempt and records the new jersey.
    const jersey = mode === 'jersey' ? [...(newRound && attempt === 1 ? ['--new-round', `jersey: ${from} -> ${to}`] : []), '--jersey', `${to} (jersey edit from ${reference}'s)`, '--confirm-review'] : []
    if (fs.existsSync(path.join(dir, slug, `out-imported-${attempt}.png`))) {
      // Made twice before this folder was retired; keep the extra but don't import it.
      fs.renameSync(png, path.join(dir, slug, `out-repeat-${attempt}.png`))
      retire(slug, attempt)
      continue
    }
    // A colour-key edit is a jersey map attempt, not a portrait attempt.
    const command = mode === 'jersey-key'
      ? [JERSEY_KEY, '--import', path.join(dir, slug)]
      : [GENERATE, '--slug', slug, '--attempt', String(attempt), '--import', png, '--background', background, ...jersey, ...fixes.flatMap(f => ['--fix', f])]
    try {
      execFileSync('node', command, { stdio: ['ignore', 'inherit', 'pipe'] })
    } catch (err) {
      // e.g. no real transparency: keep the image for inspection and leave the folder for Codex to redo.
      const kept = path.join(dir, slug, `out-rejected-${Date.now()}.png`)
      fs.renameSync(png, kept)
      rejected.push(`${slug}: ${String(err.stderr || err.message).trim().split('\n')[0]}`)
      continue
    }
    fs.renameSync(png, path.join(dir, slug, `out-imported-${attempt}.png`))
    retire(slug, attempt)
    done.push(`${slug}:${attempt}`)
  }
  // Bundles imported before this change.
  for (const slug of fs.readdirSync(dir).filter(d => fs.existsSync(path.join(dir, d, 'bundle.json')))) {
    const { attempt } = JSON.parse(fs.readFileSync(path.join(dir, slug, 'bundle.json'), 'utf8'))
    if (fs.existsSync(path.join(dir, slug, `out-imported-${attempt}.png`))) retire(slug, attempt)
  }
  console.log(`imported ${done.length}: ${done.join(' ')}`)
  if (rejected.length) console.log(`rejected ${rejected.length} (left for Codex to redo):\n  ${rejected.join('\n  ')}`)
}

if (arg('--import')) importAll(arg('--import'))
else if (arg('--out')) queue(arg('--out'))
else throw new Error('usage: --out <dir> [--slug <slug> --fix <key>...] | --import <dir>')
