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
    url: process.env.REDIS_URL,
    socket: {
      tls: true,
      rejectUnauthorized: false
    }
  })

  client.on('error', err => console.log('Redis Client Error', err))
  await client.connect()

  await client.set('series-stats', data)

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

  const spreadsheetId = '1miAzefRzb9W71w4g3H3Fbxd4t27Xu5VJSkEg3i54S5o'
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
          json.values[1][0] === '#N/A' ||
          !json.values[1][0].length
        ) {
          pullSheet(attempt + 1), 10000
        } else {
          json.values = json.values.filter(j => j[0].length)
          for (let i = 0; i < json.values.length; i++) {
            for (let j = 0; j < json.values[i].length; j++) {
              if (
                json.values[i][j] === '#N/A' ||
                typeof json.values[i][j] === 'undefined'
              ) {
                json.values[i][j] = '-'
              }
              if (i > 0 && json.values[i][j].includes('%')) {
                json.values[i][j] = json.values[i][j].replace('%', '')
              }
            }
          }
          const fir = json.values[0].map(a => a.replace('"', ''))
          const col = fir.map(a => a.replace('"', ''))

          const len = col.length
          let newR = [...json.values]

          newR.shift()
          console.log(col)
          // for (let i = 0; i<newR.length; i++) {
          //   newR[i].push("-")
          //   newR[i].push("-")
          // }

          for (let i = 4; i < len; i++) {
            const rows = newR.filter(s => !isNaN(parseFloat(s[i])))
            const rows2 = newR.filter(s => isNaN(parseFloat(s[i])))
            rows.sort((a, b) => parseFloat(a[i]) - parseFloat(b[i]))
            if (col[i].includes('DRTG') || col[i].includes('Def')) {
              rows.sort((a, b) => parseFloat(b[i]) - parseFloat(a[i]))
            }
            col[i] = col[i].replace('_desc', '')
            col.push('perc' + [col[i]])

            for (let j = 0; j < rows.length; j++) {
              rows[j].push((j / rows.length).toFixed(2).toString())
            }
            for (let j = 0; j < rows2.length; j++) {
              rows2[j].push('-')
            }

            newR = rows.concat(rows2)
          }
          const final = [col]
          for (let i = 0; i < newR.length; i++) {
            final.push(newR[i])
          }

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
