const fs = require('fs')
const path = require('path')
const { slugify, loadSheet, regularSeasonKeys } = require('./players')

const DATA_DIR = path.join(__dirname, '..', 'data')

// Writes data/<dir>/<name>.json, skipping the write when nothing but
// generatedAt changed so nightly runs only produce real diffs. With
// inlineNumberArrays, arrays of plain numbers (shot coordinates) stay on one line.
const writeArtifact = (dir, name, doc, { inlineNumberArrays = false } = {}) => {
  const file = path.join(DATA_DIR, dir, `${name}.json`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const strip = d => JSON.stringify({ ...d, generatedAt: null })
  if (fs.existsSync(file) && strip(JSON.parse(fs.readFileSync(file, 'utf8'))) === strip(doc)) return false
  let text = JSON.stringify(doc, null, 2)
  if (inlineNumberArrays) text = text.replace(/\[\n\s*((?:-?[\d.]+,\n\s*)*-?[\d.]+)\n\s*\]/g, (m, body) => `[${body.replace(/,\n\s*/g, ',')}]`)
  fs.writeFileSync(file, text + '\n')
  return true
}

const loadBio = () => JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'bio.json'), 'utf8'))

const latestSeasonRows = () => {
  const keys = regularSeasonKeys()
  return loadSheet(keys[keys.length - 1]).rows
}

// Players that get the heavier per-player pulls (shot shift, WOWY, last 15):
// --slugs a,b on the command line, else data/profile-targets.json.
const targetSlugs = () => {
  const arg = process.argv.find(a => a.startsWith('--slugs='))
  if (arg) return arg.slice('--slugs='.length).split(',').filter(Boolean)
  const file = path.join(DATA_DIR, 'profile-targets.json')
  if (!fs.existsSync(file)) throw new Error('No --slugs= given and data/profile-targets.json is missing')
  return JSON.parse(fs.readFileSync(file, 'utf8')).slugs
}

const activeSlugs = () => latestSeasonRows().map(r => slugify(r.Player))

module.exports = { writeArtifact, loadBio, latestSeasonRows, targetSlugs, activeSlugs }
