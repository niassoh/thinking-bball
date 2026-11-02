// One stats.nba.com query for scripts/playoff-tracking-pull.py, printed as its first result
// set's JSON. stats.nba.com stalls Python's and curl's requests (from 2026-10-29, whatever
// the headers) but answers Node's fetch with lib/http's.
//   node scripts/nba-get.js <endpoint> '<params as JSON>'
const { fetchJson, NBA_HEADERS } = require('../lib/http')

const [endpoint, params] = process.argv.slice(2)
fetchJson(`https://stats.nba.com/stats/${endpoint}?${new URLSearchParams(JSON.parse(params))}`, { headers: NBA_HEADERS })
  .then(({ resultSets }) => process.stdout.write(JSON.stringify(Array.isArray(resultSets) ? resultSets[0] : resultSets)))
  .catch(err => {
    console.error(err.message)
    process.exit(1)
  })
