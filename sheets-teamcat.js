const redis = require('redis')
const https = require('https')
const { google } = require('googleapis')
const { compress, decompress } = require('compress-json')
const auth = new google.auth.GoogleAuth({
  keyFile: './privatekey.json', // generated from Ben's Google API Account
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
})

const total = 10

// node sheets-teamcat.js --season=2026-27 caches the team sheet as teamcat-27. --sheet=<id>
// reads another copy of it instead of the production sheet: the backfill of past seasons
// uses one so the production sheet stays on the season being played.
const season = (process.argv.find(a => a.startsWith('--season=')) || '').slice('--season='.length)
const SHEET = (process.argv.find(a => a.startsWith('--sheet=')) || '').slice('--sheet='.length) || '1_MOhMxiijKUt31qscH08z2aCMnb0uE18pJLEp6NWJIg'
// --settle (the backfill): read only once every import has loaded (see settle below).
const SETTLE = process.argv.includes('--settle')
if (!/^\d{4}-\d{2}$/.test(season)) throw new Error('give the season the team sheet holds: --season=2026-27')
const KEY = 'teamcat-' + season.slice(5)

const getDate = () => {
  function formatAMPM (date) {
    let hours = date.getHours()
    let minutes = date.getMinutes()
    const ampm = hours >= 12 ? 'PM' : 'AM'
    hours = hours % 12
    hours = hours ? hours : 12 // 12-hour clock
    minutes = minutes < 10 ? '0' + minutes : minutes
    return hours + ':' + minutes + ' ' + ampm
  }

  function formatDate (date) {
    const options = {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }
    return new Intl.DateTimeFormat('en-US', options).format(date)
  }

  function formatDateTimePST (date) {
    const pstDateTime = date.toLocaleString('en-US', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: 'numeric',
      minute: 'numeric',
      hour12: true,
      timeZoneName: 'short'
    })
    return pstDateTime.replace(',', '') // Remove comma between date and time
  }

  const today = new Date()
  return formatDateTimePST(today)
}

async function sendToSlack (message, success = false) {
  return
  const result = success ? '[SUCCESS] ' : '[FAIL] '

  const resM = result + '[' + getDate() + '] ' + message

  const webhookUrl =
    'https://hooks.slack.com/services/REMOVED' // Replace with your webhook URL
  const channel = '	Prottush' // Replace with your channel name
  const data = JSON.stringify({
    channel: channel,
    attachments: [
      {
        text: '```' + resM + '```',
        color: success ? '#36a64f' : '#FF0000' // You can change the color if needed
      }
    ]
  })

  const options = {
    hostname: 'hooks.slack.com',
    path: webhookUrl.substring(webhookUrl.indexOf('/services')),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data.length
    }
  }

  const req = https.request(options, res => {
    let responseData = ''

    res.on('data', chunk => {
      responseData += chunk
    })

    res.on('end', () => {
      console.log('Message sent to Slack:', responseData)
    })
  })

  req.on('error', error => {
    console.error('Error sending message to Slack:', error)
  })

  req.write(data)
  req.end()
}

const fs = require('fs');
const path = require('path');

// Define data directory path
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'cached-data.json');

// Create an in-memory store for your JSON data
let dataStore = {
  // Initialize with default values or empty objects
  'dailycat-24': null
};

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log('Data directory created');
}

// Function to save data to disk - automatically called after data changes
const saveDataToDisk = (key) => {
  try {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(dataStore, null, 0)
    );
    console.log(`Data saved to disk after updating '${key}'`);
  } catch (error) {
    console.error('Error saving data to disk:', error);
    throw new Error('Failed to persist data');
  }
};

// Load data from disk on module initialization
try {
  if (fs.existsSync(DATA_FILE)) {
    const fileData = fs.readFileSync(DATA_FILE, 'utf8');
    dataStore = JSON.parse(fileData);
    console.log('Data loaded from disk on startup');
  } else {
    console.log('No existing data file found, starting with empty store');
    // Save the initial empty structure
    saveDataToDisk('initialization');
  }
} catch (error) {
  console.error('Error loading data from disk:', error);
  // Continue with empty dataStore if load fails
}

// Refactored function to store data with mandatory disk persistence
const cacheSheet = async (data, attempt, year) => {
  try {
    // Parse JSON data
    const parsedData = JSON.parse(data);
    // Store in memory
    dataStore[KEY] = parsedData;

    // Immediately persist to disk
    saveDataToDisk(KEY);
    
    console.log('Data cached and saved to disk successfully');
    return true;
  } catch (error) {
    console.error('Error in cacheSheet:', error);
    process.exitCode = 1;
    return false;
  }
};

// Set up process handlers to ensure data is saved before shutdown
process.on('SIGINT', () => {
  console.log('Server shutting down, ensuring data is saved...');
  saveDataToDisk('shutdown');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Server terminating, ensuring data is saved...');
  saveDataToDisk('shutdown');
  process.exit(0);
});

// Fetch data from TB daily stat sheet, with a 10 second buffer between attempts to allow sheet to process
const pullSheet = attempt => {
  console.log('Starting attempt #' + attempt + '...')

  const spreadsheetId = SHEET
  const sheetName = 'Format'
  const sheets = google.sheets('v4')

  if (attempt > total) {
    console.error(`Team sheet still loading after ${total} attempts; ${KEY} not updated`)
    process.exitCode = 1
    return
  }
  sheets.spreadsheets.values.get(
    {
      auth: auth,
      spreadsheetId: spreadsheetId,
      range: sheetName
    },
    function (err, response) {
      if (err) {
        console.error(`Team sheet API error on attempt #${attempt}: ${err}`)
        process.exitCode = 1
      } else {
        const json = response.data
        if (
          !json ||
          typeof json === 'undefined' ||
          json.values[7][0] === '#N/A' ||
          !json.values[7][0].length
        ) {
          setTimeout(() => pullSheet(attempt + 1), 10000)
        } else {
          json.values = json.values.filter(j => j[0].length)
          console.log(json.values[19])
          for (let i = 0; i < json.values.length; i++) {
            console.log(json.values[i][0], json.values[i].length)
            for (let j = 0; j < json.values[i].length; j++) {
              if (
                json.values[i][j] === '#N/A' ||
                json.values[i][j].includes('!') ||
                typeof json.values[i][j] === 'undefined' ||
                (isNaN(parseInt(json.values[i][j])) &&
                  !json.values[i][j].length)
              ) {
                json.values[i][j] = ''
                // } else if (isNaN(parseInt(json.values[i][j])) && !json.values[i][j].length) {
                //   console.log("Pzh",json.values[i][j], json.values[i][j])
              }
              if (
                i !== 1 &&
                json.values[i][j].includes('%') &&
                json.values[i][j] != '-'
              ) {
                json.values[i][j] = json.values[i][j].replace('%', '')
              }
            }
          }

          const col = json.values[4]
          const cat = json.values[0]
          const len = col.length
          let newR = [...json.values]

          newR.shift()
          const gloss = newR.shift()
          const sorty = newR.shift()
          const roundy = newR.shift()
          const glossO = {}
          const roundO = {}
          const sortO = {}

          newR.shift()
          for (let i = 0; i < col.length; i++) {
            glossO[col[i]] = gloss[i]
            roundO[col[i]] = roundy[i] ? roundy[i] : ''
            sortO[col[i]] = sorty[i] ? sorty[i] : ''
          }

          console.log(glossO)

          // for (let i = 0; i<newR.length; i++) {
          //   if (newR[i].length === 37) {
          //     for (let p = 0; p<7; p++) {
          //       newR[i].push("-")
          //     }
          //   }

          //   if (newR[i].length === 40) {
          //     for (let p = 0; p<4; p++) {
          //       newR[i].push("-")
          //     }
          //   }
          // }

          for (let i = 0; i < newR.length; i++) {
            if (newR[i].length < col.length) {
              let og = col.length - newR[i].length
              for (let p = 0; p < og; p++) {
                newR[i].push('-')
              }
            }
          }
          for (let i = 1; i < len; i++) {
            col.push('perc' + [col[i]])

            const rows = newR.filter(
              s => s[0] != 'League Average' && !isNaN(parseFloat(s[i]))
            )
            const rows2 = newR.filter(
              s => s[0] == 'League Average' || isNaN(parseFloat(s[i]))
            )
            rows.sort((a, b) => a[i] - b[i])
            if (
              col[i].includes('DRTG') ||
              col[i].includes('Losses') ||
              col[i].includes('Opp ')
            ) {
              rows.sort((a, b) => b[i] - a[i])
            }
            let last = 0
            for (let j = 0; j < rows.length; j++) {
              if (rows[j][i] != rows[last][i]) {
                last = j
              }

              rows[j].push((last / rows.length).toFixed(2).toString())
              if (col[i] === 'BPM') {
                //console.log((j/rows.length).toFixed(2).toString())
              }
            }
            for (let j = 0; j < rows2.length; j++) {
              rows2[j].push('-')
            }

            newR = rows.concat(rows2)
          }
          const final = [col]
          final.push(cat)
          for (let i = 0; i < newR.length; i++) {
            final.push(newR[i])
          }

          json.values = final;
          json.glossy = glossO;
          cacheSheet(JSON.stringify(compress(json)), attempt)
          return json
        }
      }
    }
  )
}

// The sheet's pbpstats imports are ImportJSON on Instructions!A13 and only fetch again when
// it changes, so it's set to the season before and back first (as backfill-seasons.js does
// the stats sheet's), each time waiting for Format's records to change; then it's read.
const nudge = async () => {
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() })
  const spreadsheetId = SHEET
  const setYear = year => sheets.spreadsheets.values.update({ spreadsheetId, range: 'Instructions!A13', valueInputOption: 'RAW', requestBody: { values: [[year]] } })
  const records = async () => ((await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Format!A6:H36' })).data.values || []).map(r => r.join(':')).join('|')
  const change = async before => {
    for (let i = 0; i < 18; i++) {
      await new Promise(resolve => setTimeout(resolve, 10000))
      const now = await records()
      if (now !== before && !/Loading|#N\/A/.test(now)) return now
    }
    return before
  }
  const prior = `${+season.slice(0, 4) - 1}-${season.slice(2, 4)}`
  const start = await records()
  try {
    await setYear(prior)
    const detour = await change(start)
    await setYear(season)
    if (detour === start || (await change(detour)) === detour) console.error('Team sheet did not reload; reading it as it is')
  } finally {
    await setYear(season)
  }
  await standings(sheets, spreadsheetId)
}

// The win pace is mostly SRS this early, and SRS comes from an IMPORTHTML of
// Basketball-Reference's standings ('BBR standings', East at A37, West at A54), which Google
// refetches only now and then (the A13 nudge doesn't touch them): unattended, they can hold
// SRS from before the season. When their games trail Format's, the imports are entered again
// (the same formulas) to refetch them, waiting until they catch up; still behind, the sheet
// is read as it is.
const standings = async (sheets, spreadsheetId) => {
  const IMPORTS = ["'BBR standings'!A37", "'BBR standings'!A54"]
  const get = (range, valueRenderOption) => sheets.spreadsheets.values.get({ spreadsheetId, range, valueRenderOption }).then(r => r.data.values || [])
  const games = rows => rows.reduce((n, r) => n + (+r[0] || 0) + (+r[1] || 0), 0)
  const played = games(await get('Format!G6:H35'))
  const behind = async () => games(await get("'BBR standings'!Q3:R34")) < played
  if (!(await behind())) return
  for (const range of IMPORTS) {
    const formula = (await get(range, 'FORMULA'))[0][0]
    await sheets.spreadsheets.values.update({ spreadsheetId, range, valueInputOption: 'USER_ENTERED', requestBody: { values: [[formula]] } })
  }
  for (let i = 0; i < 18; i++) {
    await new Promise(resolve => setTimeout(resolve, 10000))
    if (!(await behind())) return console.log('Team sheet standings refetched for SRS')
  }
  console.error("Team sheet's Basketball-Reference standings still trail its records; SRS and the win pace read stale")
}

// A past season's imports (play types, opponents' shots, the season's games) load minutes
// after its records do, and the pull's own check sees only the first row: read early, whole
// columns come out blank (2015-16's play types, win pace and Adj rDRTG, the first backfill).
// So wait until no team row has a loading or error cell, but in the "last month" columns (a
// past season has no last month), and Format reads the same twice; never, and nothing is
// cached. Google's IMPORTDATA can stall on "Loading..." for good (2015-16's play types, 15
// minutes, the file fine), and pbpstats turns some of the sheet's dozen-odd simultaneous
// ImportJSON calls away with a 503 that nothing retries (2023-24's after-stop splits): still
// loading at 3 and 6.5 minutes, every import cell still loading or in error is entered
// again (the same formula), which refetches it.
const settle = async () => {
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() })
  const read = async () => (await sheets.spreadsheets.values.get({ spreadsheetId: SHEET, range: 'Format!A5:CZ36' })).data.values || []
  const pending = v => v.slice(1).flatMap(r => r.map((c, k) => (/Loading|#N\/A|#REF|#VALUE|#ERROR|#DIV|#NAME/.test(c) && !/last month/.test(v[0][k] || '') ? v[0][k] || k : null))).filter(x => x !== null)
  const reenter = async () => {
    const tabs = (await sheets.spreadsheets.get({ spreadsheetId: SHEET, fields: 'sheets.properties.title' })).data.sheets.map(t => `'${t.properties.title}'!A1:Z500`)
    const get = async render => (await sheets.spreadsheets.values.batchGet({ spreadsheetId: SHEET, ranges: tabs, valueRenderOption: render })).data.valueRanges
    const [formulas, values] = [await get('FORMULA'), await get('FORMATTED_VALUE')]
    const data = []
    formulas.forEach(({ values: f = [] }, t) => f.forEach((r, i) => r.forEach((c, k) => {
      const v = (values[t].values?.[i] || [])[k] || ''
      if (/^=(IMPORTDATA|ImportJSON)\(/i.test(c) && /Loading|#ERROR|#N\/A|#REF/.test(v)) {
        data.push({ range: `${tabs[t].split('!')[0]}!${String.fromCharCode(65 + k)}${i + 1}`, values: [[c]] })
      }
    })))
    if (data.length) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: SHEET, requestBody: { valueInputOption: 'USER_ENTERED', data } })
    console.log(`Team sheet imports entered again: ${data.map(d => d.range).join(', ') || 'none stuck'}`)
  }
  let last = null
  for (let i = 0; i < 40; i++) {
    if (i === 12 || i === 26) await reenter()
    await new Promise(resolve => setTimeout(resolve, 15000))
    const v = await read()
    const now = JSON.stringify(v)
    if (!pending(v).length && now === last) return
    last = now
  }
  throw new Error(`Team sheet still loading after 10 minutes (${[...new Set(pending(await read()))].join(', ')}); ${KEY} not updated`)
}

nudge().catch(e => console.error('Team sheet nudge failed:', e.message))
  .then(() => SETTLE && settle())
  .then(() => pullSheet(1), e => {
    console.error(e.message)
    process.exitCode = 1
  })
