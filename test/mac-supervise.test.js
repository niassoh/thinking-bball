const test = require('node:test')
const assert = require('node:assert')
const { failedSteps } = require('../scripts/mac-supervise')

// Lines as `gh run view --log` prints them: job, step, timestamp and text, tab-separated.
const log = (...lines) => lines.map(l => `nightly\tUNKNOWN STEP\t2026-11-10T15:04:45.0Z ${l}`).join('\n')

test('mac-supervise: the step each ##[error] follows, by name for the ones it acts on', () => {
  assert.deepStrictEqual(failedSteps(log(
    '##[group]Run node scripts/backfill-seasons.js "$SEASON"',
    'Error: Sheet did not settle for 2026-27 within 20 minutes',
    '##[error]Process completed with exit code 1.',
    '##[group]Run node sheets-teamcat.js --season="$SEASON"',
    'ok',
    '##[group]Run npm run pull:games',
    "##[error]The action 'Run npm run pull:games' has timed out after 40 minutes.",
    '##[group]Run node scripts/games-check.js "$SEASON"',
    '##[error]Process completed with exit code 1.',
    '##[group]Run exit 1',
    '##[error]Process completed with exit code 1.'
  )), ['season', 'npm run pull:games', 'games-check'])
})

test('mac-supervise: a clean run, and a failure before any step, as setup', () => {
  assert.deepStrictEqual(failedSteps(log('##[group]Run npm ci', 'added 812 packages')), [])
  assert.deepStrictEqual(failedSteps(log('##[error]No runner available')), ['setup'])
})
