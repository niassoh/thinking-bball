const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// Overloaded/rate-limited responses get a longer back-off than other errors.
const THROTTLED = new Set([429, 502, 503, 504])

const fetchJson = async (url, { retries = 5, headers = {} } = {}) => {
  for (let attempt = 1; ; attempt++) {
    let status = null
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(60000) })
      status = res.status
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
      return await res.json()
    } catch (err) {
      if (attempt >= retries) throw err
      await sleep((THROTTLED.has(status) ? 10000 : 1000) * attempt)
    }
  }
}

// stats.nba.com stalls requests without browser-like headers.
const NBA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
  Origin: 'https://www.nba.com',
  Referer: 'https://www.nba.com/',
  Accept: 'application/json, text/plain, */*',
  'x-nba-stats-origin': 'stats',
  'x-nba-stats-token': 'true'
}

module.exports = { sleep, fetchJson, NBA_HEADERS }
