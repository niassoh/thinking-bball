const redis = require('redis')

const getKeyCache = async key => {
  const client = redis.createClient({
    url: process.env.REDIS_URL,      
    socket: {
      tls: true,
      rejectUnauthorized: false
    }
  })

  client.on('error', err => console.log('Redis Client Errorr', err))
  await client.connect()

  let json = await client.get(key)
  console.log('TREND REQ')

  if (!json) {
  } else {
    await client.quit()

    const restoredFromString = JSON.parse(json)

    console.log('TREND REQ')
    return restoredFromString
  }
}

console.log(process.env.REDIS_URL)

const postStat = async (key, data) => {
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

  let json = await client.get(key)
  console.log('TREND REQ', json)

  if (!json) {
    const first = []
    first.push(data)
    client.set(key, JSON.stringify([]))
  } else {
    const restoredFromString = JSON.parse(json)
    restoredFromString.push(data)
    client.set(key, JSON.stringify(restoredFromString))
    await client.quit()
  }
}

module.exports.getKeyCache = getKeyCache
module.exports.postStat = postStat
