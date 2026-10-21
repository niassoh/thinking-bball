// Portrait generation, QA bookkeeping and output derivatives, following
// basketball-player-portrait-reference-pack/. One step per invocation so a
// person (or Claude) can review each attempt against QA_CHECKLIST.md between steps.
//
// 1. Generate one attempt (always from the original source photo + crop):
//    node --env-file=.env scripts/portraits/generate.js --slug nikola-jokic --attempt 1
//    node --env-file=.env scripts/portraits/generate.js --slug nikola-jokic --attempt 2 --fix too-photographic --fix orange-skin
//    (--fix <key> appends a standard retry constraint from RETRY_FIXES below;
//     --extra "<text>" appends free text and should be rare)
// 2. Record QA for that attempt:
//    node scripts/portraits/generate.js --slug nikola-jokic --attempt 1 --qa pass
//    node scripts/portraits/generate.js --slug nikola-jokic --attempt 1 --qa fail --failed "skin orange;too photographic"
//    (add --checklist 1,1,0,... for per-item pass/fail on QA_CHECKLIST.md "Must pass")
// 3. Finalize the passing attempt (master PNG + 400/200/100 WebPs, approved=true):
//    node scripts/portraits/generate.js --slug nikola-jokic --attempt 1 --finalize
//
// Per-player prompt additions: metadata.promptAdditions (array of strings, e.g. the
// opt-in TOP-LIGHT HIGHLIGHTS profile from GENERATION_PROMPT.md) are appended to
// every attempt for that player.
// Rounds: --new-round "<reason>" archives the current attempts to
// metadata.previousRounds and restarts at attempt 1 (same source photo).
// Extra QA checks: --extra-checks "item=pass;item=fail" alongside --qa.
// Codex/ChatGPT images: --import <png> records an image made elsewhere from the same
// inputs (codex-queue.js writes them) as this attempt instead of calling the API;
// QA and --finalize then work as usual.
// Transparent: --background transparent swaps the prompt's BACKGROUND section for a
// transparent one; imports must then be PNGs with real alpha (corners clear), which
// catches a painted checkerboard.
// Jersey edits (codex-queue.js --rejersey): --jersey "<team> (...)" on an import records
// the new jersey on the attempt; --finalize copies it to metadata.jersey.
// Options: --dry-run <file> (no API call), --model (default gpt-image-2), --quality (default high),
// --input-fidelity high, --confirm-review (needed when metadata.needsReview is set).
// Each OpenAI call is appended to docs/portrait-audit.md.
const fs = require('fs')
const path = require('path')
const sharp = require('sharp')

const ROOT = path.join(__dirname, '..', '..')
const PACK = path.join(ROOT, 'basketball-player-portrait-reference-pack')
const METADATA = path.join(ROOT, 'assets', 'players', 'metadata')
const ATTEMPTS = path.join(ROOT, 'assets', 'players', 'attempts')
const PLAYERS = path.join(ROOT, 'assets', 'players')
const WEBP = path.join(PLAYERS, 'webp')
const AUDIT = path.join(ROOT, 'docs', 'portrait-audit.md')
const MAX_ATTEMPTS = 3
// 1024 is the committed full-size copy (PNG masters are gitignored).
const WEBP_SIZES = [1024, 400, 200, 100]
const webpQuality = size => (size === 1024 ? 90 : 85)
const STYLE_REFS = ['references/style-primary-mccain.png', 'references/style-thumbnail-sheet.png']

// Standard retry constraints, worded to match GENERATION_PROMPT.md v3 and
// QA_CHECKLIST.md: faceted McCain-style shading without the overprocessed look.
const RETRY_FIXES = {
  'too-photographic': 'Build the face from medium-sized flat triangular planes like the primary style reference; remove photographic skin and smooth gradients.',
  'facets-too-small': 'Use fewer, larger facets that follow the facial structure; no mosaic, shard noise or stained-glass fragmentation.',
  'overprocessed': 'Remove the glossy/HDR/plastic AI-render finish, over-sharpened edges, halos and glow; keep a clean matte finish.',
  'orange-skin': 'Neutralize the orange skin cast; keep natural skin tone with neutral-to-cool shadows and restrained saturation.',
  'background-lights': 'Remove all bright background lights; use flat charcoal.',
  'head-angle': 'Preserve the original head angle and gaze direction from the source photo.',
  'expression': 'Preserve the source expression exactly; do not neutralize or exaggerate it.',
  'identity': 'Preserve the subject\'s facial proportions and likeness exactly.',
  'crop': 'Tighter head-and-upper-shoulders crop; minimal torso.',
  'jersey': 'Preserve the source jersey base and trim colors exactly.'
}

const args = process.argv.slice(2)
const arg = name => {
  const i = args.indexOf(name)
  return i === -1 ? null : args[i + 1]
}
const all = name => args.flatMap((a, i) => (a === name ? [args[i + 1]] : []))
const has = name => args.includes(name)

const readMeta = slug => JSON.parse(fs.readFileSync(path.join(METADATA, `${slug}.json`), 'utf8'))
const writeMeta = (slug, meta) => fs.writeFileSync(path.join(METADATA, `${slug}.json`), JSON.stringify(meta, null, 2) + '\n')

const audit = (type, target, what) => {
  const text = fs.readFileSync(AUDIT, 'utf8')
  const last = Math.max(0, ...[...text.matchAll(/^\| (\d+) \|/gm)].map(m => Number(m[1])))
  const time = new Date().toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit', hour12: false })
  fs.appendFileSync(AUDIT, `| ${last + 1} | ${time} | ${type} | ${target} | ${what} | n/a |\n`)
}

// The prompt is the "## Prompt" section of GENERATION_PROMPT.md, verbatim,
// preceded by the image-role instructions from the same file.
const TRANSPARENT_BACKGROUND = `### BACKGROUND

Output a PNG with a fully transparent background (alpha channel). Everything that is not the player (head, hair, beard, neck, shoulders, jersey) must be 100% transparent.

Do NOT paint any backdrop behind the player: no charcoal, no colour field, no vignette, no glow, no shadow, and never a checkerboard pattern standing in for transparency. The style references' dark backgrounds are not part of the requested output.

Keep the silhouette edges clean and crisp, with hair and beard as simplified masses, no halo or fringe of background colour. The crop's bottom and side edges may cut through the shoulders and jersey.

`

const buildPrompt = (extras, additions = [], background = 'charcoal') => {
  const doc = fs.readFileSync(path.join(PACK, 'GENERATION_PROMPT.md'), 'utf8')
  let body = doc.slice(doc.indexOf('## Prompt') + '## Prompt'.length).trim()
  if (background === 'transparent') {
    body = body.slice(0, body.indexOf('### BACKGROUND')) + TRANSPARENT_BACKGROUND + body.slice(body.indexOf('### FINAL RESULT'))
    body = body.replace('neutral dark background', 'fully transparent background')
  }
  const roles = [
    'Image 1 is the SUBJECT: the real player photograph. Preserve this person\'s identity.',
    'Image 2 (primary) and image 3 (secondary) are STYLE references only. They control simplification, crop, texture, contrast and art direction. Never transfer their identity, facial anatomy, hairstyle, skin tone, pose or jersey.'
  ].join('\n')
  const player = additions.length ? `\n\n### PLAYER-SPECIFIC ADDITIONS\n\n${additions.map(e => `- ${e}`).join('\n')}` : ''
  const retry = extras.length ? `\n\n### RETRY CORRECTIONS\n\n${extras.map(e => `- ${e}`).join('\n')}` : ''
  return `${roles}\n\n${body}${player}${retry}`
}

const promptVersion = () => JSON.parse(fs.readFileSync(path.join(PACK, 'reference_manifest.json'), 'utf8')).promptVersion

const generate = async (slug, attempt) => {
  const dryRun = arg('--dry-run')
  const imported = arg('--import')
  if (!dryRun && !imported && !process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY missing: run with node --env-file=.env')
  if (attempt < 1 || attempt > MAX_ATTEMPTS) throw new Error(`--attempt must be 1..${MAX_ATTEMPTS}`)
  const meta = readMeta(slug)
  if (arg('--new-round')) {
    if (!meta.attempts.length) throw new Error('--new-round: no attempts to archive')
    meta.previousRounds = [...(meta.previousRounds || []), { round: meta.round || 1, reason: arg('--new-round'), archivedAt: new Date().toISOString(), attempts: meta.attempts }]
    meta.round = (meta.round || 1) + 1
    meta.attempts = []
    writeMeta(slug, meta)
  }
  if (meta.needsReview && !has('--confirm-review')) throw new Error(`${slug} needs review first: ${meta.needsReview} (pass --confirm-review once checked)`)
  if (meta.attempts.some(a => a.attempt === attempt)) throw new Error(`attempt ${attempt} already exists for ${slug}`)
  // Attempt files are keyed by source photo so a new source never overwrites
  // attempts made from an earlier one.
  const sourceKey = require('crypto').createHash('sha1').update(meta.sourceUrl).digest('hex').slice(0, 8)
  const round = meta.round || 1
  const file = `assets/players/attempts/${slug}-${sourceKey}-${round > 1 ? `r${round}-` : ''}${attempt}.png`
  // Also check superseded/, where archived attempts keep their file names.
  if (fs.existsSync(path.join(ROOT, file)) || fs.existsSync(path.join(ATTEMPTS, 'superseded', path.basename(file)))) throw new Error(`${file} already exists (or is archived in superseded/)`)

  // Always start from the original source photo, never a previous result.
  const c = meta.crop
  let subject = sharp(path.join(ROOT, meta.sourceFile))
  if (c) subject = subject.extract({ left: c.x, top: c.y, width: c.size, height: c.size })
  subject = await subject.resize(1024, 1024, { fit: 'cover' }).png().toBuffer()

  const model = arg('--model') || 'gpt-image-2'
  const unknown = all('--fix').filter(k => !RETRY_FIXES[k])
  if (unknown.length) throw new Error(`unknown --fix ${unknown.join(', ')}; use one of ${Object.keys(RETRY_FIXES).join(', ')}`)
  const extras = [...all('--fix').map(k => RETRY_FIXES[k]), ...all('--extra')]
  const additions = meta.promptAdditions || []
  const background = arg('--background') || 'charcoal'
  if (!['charcoal', 'transparent'].includes(background)) throw new Error('--background must be charcoal or transparent')
  const prompt = buildPrompt(extras, additions, background)
  const form = new FormData()
  form.append('model', model)
  form.append('prompt', prompt)
  form.append('size', '1024x1024')
  form.append('quality', arg('--quality') || 'high')
  form.append('n', '1')
  if (arg('--input-fidelity')) form.append('input_fidelity', arg('--input-fidelity'))
  if (background === 'transparent') form.append('background', 'transparent')
  form.append('image[]', new Blob([subject], { type: 'image/png' }), `${slug}-subject.png`)
  for (const ref of STYLE_REFS) {
    form.append('image[]', new Blob([fs.readFileSync(path.join(PACK, ref))], { type: 'image/png' }), path.basename(ref))
  }

  // --dry-run <file>: write the prepared subject image and print the prompt; no API call.
  if (dryRun) {
    fs.writeFileSync(dryRun, subject)
    console.log(`model=${model}\n--- prompt (${prompt.length} chars) ---\n${prompt}`)
    return
  }

  if (imported) {
    if (background === 'transparent') {
      const img = sharp(imported)
      const { width, height, hasAlpha } = await img.metadata()
      const alpha = hasAlpha ? await img.extractChannel('alpha').raw().toBuffer() : null
      // Top corners must be clear (the bottom ones can be shoulders and jersey), and a
      // real cutout leaves a good share of the frame transparent.
      const corners = alpha && [0, width - 1].map(i => alpha[i])
      const clear = alpha ? alpha.filter(a => a < 8).length / alpha.length : 0
      if (!alpha || corners.some(a => a > 8) || clear < 0.15) throw new Error(`${slug}: ${imported} has no real transparency (${hasAlpha ? `top corners ${corners.join(',')}, ${Math.round(clear * 100)}% clear` : 'no alpha'})`)
    }
    fs.mkdirSync(ATTEMPTS, { recursive: true })
    fs.copyFileSync(imported, path.join(ROOT, file))
    meta.promptVersion = promptVersion()
    meta.latestAttempt = attempt
    meta.attempts.push({ attempt, round, model: 'codex (ChatGPT image tool)', startedAt: new Date().toISOString(), promptAdditions: additions, extras, background, ...(arg('--jersey') ? { jersey: arg('--jersey') } : {}), file, importedFrom: imported, usage: null, qa: null })
    writeMeta(slug, meta)
    audit('OUTPUT', `\`${file}\``, `${slug} attempt ${attempt} imported from Codex (\`${path.basename(path.dirname(imported))}/${path.basename(imported)}\`), extras: ${extras.length ? extras.join(' / ') : 'none'}; awaiting QA`)
    console.log(`${slug}: attempt ${attempt} imported to ${file}`)
    return
  }

  const started = new Date().toISOString()
  // Back off on rate limits and server errors; every call is logged. An empty
  // balance also returns 429 but won't clear by waiting, so it stops at once.
  let res, json
  for (let call = 1; call <= 4; call++) {
    res = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form
    })
    json = await res.json().catch(() => ({ error: { message: 'non-JSON response' } }))
    const noCredits = /insufficient_quota/.test((json.error && json.error.code) || '') || /no credits remaining|exceeded your current quota/i.test((json.error && json.error.message) || '')
    if (res.ok || noCredits || !(res.status === 429 || res.status >= 500) || call === 4) break
    audit('WRITE-EXT', '`api.openai.com/v1/images/edits`', `${slug} attempt ${attempt}: HTTP ${res.status} (${json.error && json.error.message}); backing off, retry ${call}/3`)
    await new Promise(r => setTimeout(r, 15000 * 2 ** (call - 1)))
  }
  audit('WRITE-EXT', '`api.openai.com/v1/images/edits`', `${slug} ${round > 1 ? `round ${round} ` : ''}attempt ${attempt}, model \`${model}\`, promptAdditions: ${additions.length}, extras: ${extras.length ? extras.join(' / ') : 'none'}. Result: ${res.ok ? 'image returned' : `error ${res.status}: ${json.error && json.error.message}`}`)
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${json.error && json.error.message}`)

  fs.mkdirSync(ATTEMPTS, { recursive: true })
  fs.writeFileSync(path.join(ROOT, file), Buffer.from(json.data[0].b64_json, 'base64'))
  meta.promptVersion = promptVersion()
  meta.latestAttempt = attempt // generationAttempt stays the finalized attempt
  meta.attempts.push({ attempt, round, model, startedAt: started, promptAdditions: additions, extras, file, usage: json.usage || null, qa: null })
  writeMeta(slug, meta)
  audit('OUTPUT', `\`${file}\``, `${slug} attempt ${attempt}, awaiting QA`)
  console.log(`${slug}: attempt ${attempt} saved to ${file}`)
}

const recordQa = (slug, attempt, verdict) => {
  const meta = readMeta(slug)
  const a = meta.attempts.find(x => x.attempt === attempt)
  if (!a) throw new Error(`no attempt ${attempt} for ${slug}`)
  if (!['pass', 'fail'].includes(verdict)) throw new Error('--qa must be pass or fail')
  // --checklist "1,1,1,0,..." gives pass(1)/fail(0) per "Must pass" item, in QA_CHECKLIST.md order.
  const doc = fs.readFileSync(path.join(PACK, 'QA_CHECKLIST.md'), 'utf8')
  const items = doc.slice(doc.indexOf('## Must pass'), doc.indexOf('## Reject')).match(/- \[ \] .+/g).map(s => s.slice(6))
  let checklist = null
  if (arg('--checklist')) {
    const marks = arg('--checklist').split(',').map(Number)
    if (marks.length !== items.length) throw new Error(`--checklist needs ${items.length} values`)
    checklist = Object.fromEntries(items.map((item, i) => [item, marks[i] ? 'pass' : 'fail']))
  }
  const extraChecks = arg('--extra-checks') ? Object.fromEntries(arg('--extra-checks').split(';').map(x => x.split('=').map(t => t.trim()))) : null
  a.qa = { verdict, checklist, extraChecks, failed: (arg('--failed') || '').split(';').map(s => s.trim()).filter(Boolean), checkedAt: new Date().toISOString(), checklistFile: 'QA_CHECKLIST.md' }
  writeMeta(slug, meta)
  console.log(`${slug}: attempt ${attempt} QA ${verdict}`)
}

const finalize = async (slug, attempt) => {
  const meta = readMeta(slug)
  const a = meta.attempts.find(x => x.attempt === attempt)
  if (!a || !a.qa || a.qa.verdict !== 'pass') throw new Error(`attempt ${attempt} for ${slug} has not passed QA`)
  const master = `assets/players/${slug}.png`
  // A live portrait made from a different (replaced) source is archived first.
  if (meta.approved && meta.approvedFromSource && meta.approvedFromSource !== meta.sourceUrl && fs.existsSync(path.join(ROOT, master))) {
    const tag = require('crypto').createHash('sha1').update(meta.approvedFromSource).digest('hex').slice(0, 8)
    const archived = [master, ...(meta.webp || [])].filter(f => fs.existsSync(path.join(ROOT, f))).map(f => {
      const dest = `assets/players/attempts/superseded/prev-${tag}-${path.basename(f)}`
      fs.renameSync(path.join(ROOT, f), path.join(ROOT, dest))
      return dest
    })
    const h = (meta.supersededHistory || []).find(x => x.sourceUrl === meta.approvedFromSource)
    if (h) h.supersededFiles = [...(h.supersededFiles || []), ...archived]
    audit('OUTPUT', archived.map(f => `\`${f}\``).join(', '), `${slug}: previous live portrait archived before replacement`)
  }
  fs.copyFileSync(path.join(ROOT, a.file), path.join(ROOT, master))
  fs.mkdirSync(WEBP, { recursive: true })
  const webp = []
  for (const size of WEBP_SIZES) {
    const out = `assets/players/webp/${slug}-${size}.webp`
    await sharp(path.join(ROOT, master)).resize(size, size).webp({ quality: webpQuality(size) }).toFile(path.join(ROOT, out))
    webp.push(out)
  }
  Object.assign(meta, { masterFile: master, webp, generationAttempt: attempt, approved: true, approvedAt: new Date().toISOString(), approvedFromSource: meta.sourceUrl, background: a.background || 'charcoal', ...(a.jersey ? { jersey: a.jersey } : {}) })
  writeMeta(slug, meta)
  audit('OUTPUT', `\`${master}\` + ${webp.length} WebPs`, `${slug} approved from attempt ${attempt}`)
  console.log(`${slug}: approved; ${master} and ${webp.join(', ')}`)
}

const main = async () => {
  const slug = arg('--slug')
  const attempt = Number(arg('--attempt'))
  if (!slug || !attempt) throw new Error('--slug and --attempt are required')
  if (has('--finalize')) return finalize(slug, attempt)
  if (arg('--qa')) return recordQa(slug, attempt, arg('--qa'))
  return generate(slug, attempt)
}

main().catch(err => {
  console.error(err.message)
  process.exit(1)
})
