const redis = require('redis')
const { google } = require('googleapis')
const https = require('https')
const { compress, decompress } = require('compress-json')
const auth = new google.auth.GoogleAuth({
  keyFile: './privatekey.json', // generated from Ben's Google API Account
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
})

const total = 10
let firstT = true
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
  const channel = '#technical' // Replace with your channel name
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
let year2 = '2021-22'
let i = 22
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
    newString = 'dailycat-playoffs-26';
    // Store in memory
    dataStore[newString] = parsedData;
    
    // Immediately persist to disk
    saveDataToDisk('dailycat-playoffs-26');
    
    console.log('Data cached and saved to disk successfully');
    return true;
  } catch (error) {
    console.error('Error in cacheSheet:', error);
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
const pullSheet = (attempt, year) => {
  console.log('Starting PULL attempt #' + attempt + '...')

  const spreadsheetId = '1v8vHxHLw94KgsPCZ5s4BLfYygZFRFQ0Tr4wrThZPq_g'
  const sheetName = 'Format'
  const sheets = google.sheets('v4')

  if (attempt > total) {
    sendToSlack(
      '[PLAYERS DAILY] Sheet cached of size ' +
        data.length +
        ' on attempt #' +
        attempt +
        false
    )
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
        sendToSlack(
          '[PLAYERS DAILY] API Error: "' +
            err +
            '" (on attempt #' +
            attempt +
            ')',
          false
        )
      } else {
        const json = response.data
        console.log(json)
        if (
          !json ||
          typeof json === 'undefined' ||
          json.values[15][0] === '#N/A' ||
          !json.values[15][0].length
        ) {
          console.log('It appears the sheet is still loading, repulling!')
          pullSheet(attempt + 1, year), 10000
        } else if (firstT) {
          firstT = false
          pullSheet(attempt + 1, year), 10000
        } else {
          json.values = json.values.filter(j => j[0].length)

          for (let i = 0; i < json.values.length; i++) {
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
                i !== 4 &&
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

            const rows = newR.filter(s => !isNaN(parseFloat(s[i])))
            const rows2 = newR.filter(s => isNaN(parseFloat(s[i])))
            rows.sort((a, b) => a[i] - b[i])
            console.log(sorty, sortO)
            if (
              col[i].includes('Team Def') ||
              col[i].includes('DRTG') ||
              col[i].includes('cTOV') ||
              col[i].includes('Diff%') ||
              sortO[col[i]] === 'ASC'
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

          json.values = final
          json.glossy = glossO
          json.roundy = roundO
          json.sorty = sortO

          cacheSheet(JSON.stringify(compress(json)), attempt, year)
          return json
        }
      }
    }
  )
}

const changeYear = (attempt, year) => {
  console.log('Starting WRITE attempt #' + attempt + '...')

  const spreadsheetId = '1v8vHxHLw94KgsPCZ5s4BLfYygZFRFQ0Tr4wrThZPq_g'
  const sheetName = 'Format'
  const sheets = google.sheets('v4')

  if (attempt > total) {
    console.log(
      'Sheet cache failed on ' + getDate() + ' after ' + total + ' attempts'
    )
    return
  }
  const values = [[year]]
  const resource = {
    values
  }
  sheets.spreadsheets.values.update(
    {
      auth: auth,
      spreadsheetId: spreadsheetId,
      range: 'Instructions!A13:A13',
      resource,
      valueInputOption: 'RAW'
    },
    function (err, response) {
      if (err) {
        console.log('The API returned an error: ' + err)
        setTimeout(pullSheet(attempt + 1, year), 10000)
      } else {
        console.log('Done write to cell A13 with season: ' + year)
        pullSheet(1, year)
      }
    }
  )
}




pullSheet(1, '2025-26')
