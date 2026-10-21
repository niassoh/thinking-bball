const redis = require('redis')
const { google } = require('googleapis')
const { compress, decompress } = require('compress-json')
const auth = new google.auth.GoogleAuth({
  keyFile: './privatekey.json', // generated from Ben's Google API Account
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
})

const total = 10

getDate = () => {
  var today = new Date()
  return today
}

const cacheSheet = async (data, attempt) => {
  const client = redis.createClient({
    url: process.env.REDIS_URL
      ? process.env.REDIS_URL
      : 'REMOVED',
    socket: {
      tls: true,
      rejectUnauthorized: false
    }
  })

  client.on('error', err => console.log('Redis Client Error', err))
  await client.connect()

  await client.set('pzhteamcat-24', data)

  console.log(
    'Sheet cached of size ' +
      data.length +
      ' on ' +
      getDate() +
      ' on attempt #' +
      attempt +
      ':'
  )

  await client.quit()
}

// Fetch data from TB daily stat sheet, with a 10 second buffer between attempts to allow sheet to process
const pullSheet = attempt => {
  console.log('Starting attempt #' + attempt + '...')

  const spreadsheetId = '1F773iJysjhU8k-z6qCIIop9E2hQvPCnDGteRaX-slBI'
  const sheetName = 'Format'
  const sheets = google.sheets('v4')

  if (attempt > total) {
    console.log(
      'Sheet cache failed on ' + getDate() + ' after ' + total + ' attempts'
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
        console.log('The API returned an error: ' + err)
        setTimeout(pullSheet(attempt + 1), 10000)
      } else {
        const json = response.data
        if (
          !json ||
          typeof json === 'undefined' ||
          json.values[3][0] === '#N/A' ||
          !json.values[3][0].length
        ) {
          pullSheet(attempt + 1), 10000
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

          const col = json.values[1]
          const cat = json.values[0]
          const len = col.length
          let newR = [...json.values]

          newR.shift()
          newR.shift()

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
          console.log(final[0], final[1])
          json.values = final
          cacheSheet(JSON.stringify(compress(json)), attempt)
          return json
        }
      }
    }
  )
}

//Execute
pullSheet(1)
