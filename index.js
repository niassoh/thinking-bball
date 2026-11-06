const express = require('express');
const redis = require('redis');
const scraper = require('./scraper');
const app = express();
const url = require('url');
const ip = process.env.IP || '0.0.0.0';
var cors = require('cors');
const puppeteer = require('puppeteer');
var timeout = require('connect-timeout');
const fs = require('fs');
const path = require('path');
const profile = require('./lib/profile');
const { teamboard } = require('./lib/teamboard');

const port = process.env.PORT || 8080;

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'cached-data.json');

app.use(cors());
app.use(express.json());

function delay(time) {
  return new Promise(function (resolve) {
    setTimeout(resolve, time);
  });
}

app.use(function (req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Credentials', true);
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin,X-Requested-With,Content-Type,Accept,content-type,application/json'
  );
  next();
});

// New endpoint to get player data from the JSON file
// New endpoint to get player data from the JSON file (case-insensitive)
app.get('/api/player', (req, res) => {
  // Ensure the player parameter is provided
  if (!req.query.player) {
    return res.status(400).send({ message: 'Player name is required' });
  }

  // Parse the player name (expected format: first_last)
  const playerName = req.query.player.replace('_', ' ').toLowerCase(); // Convert to lowercase and replace underscore with space

  // Load the JSON data (ensure your JSON file is in the same directory or provide the correct path)
  fs.readFile('final_corrected_player_data.json', 'utf8', (err, data) => {
    if (err) {
      return res.status(500).send({ message: 'Error reading the JSON file' });
    }

    // Parse the JSON data
    const playersData = JSON.parse(data);

    // Iterate through the JSON data and compare each player's name in lowercase
    const player = Object.keys(playersData).find(key => key.toLowerCase() === playerName);

    if (player) {
      // If player is found, return the data as JSON
      return res.json({ [player]: playersData[player] });
    } else {
      // If player is not found
      return res.status(404).send({ message: 'Player not found' });
    }
  });
});

// Existing snapshot endpoint
app.get('/api/snapshot', async (req, res) => {
  if (!req.query.player) {
    res.status(400).send({ message: 'Invalid input' });
    return;
  }
  // Create a snapshot and send it back
  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox'],
    });

    let page = await browser.newPage();
    await page.setDefaultNavigationTimeout(0);
    await page.setViewport({
      width: parseInt('1040'),
      height: parseInt('725'),
    });

    await page.goto(
      'https://pscreen--elastic-boyd-da0d43.netlify.app/?player=' +
        req.query.player +
        (req.query.season ? '&season=' + req.query.season : '') +
        (req.query.type ? '&type=' + req.query.type : '')
    );
    await delay(20000);

    const buffer = await page.screenshot({ type: 'png' });
    // Send it back
    res.setHeader('content-type', 'image/png');
    res.write(buffer, 'binary');
    res.end(null, 'binary');
    // Close browser and page
    await page.close();
    browser.close();
  } catch (error) {
    res.status(500).send({ message: 'Failed to create snapshot' });
    browser.close();
  }
});

// Existing teamsnapshot endpoint
app.get('/api/teamsnapshot', async (req, res) => {
  if (!req.query.Tm) {
    res.status(400).send({ message: 'Invalid input' });
    return;
  }
  // Create a snapshot and send it back
  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox'],
    });

    let page = await browser.newPage();
    await page.setViewport({ width: parseInt('968'), height: parseInt('728') });

    await page.goto(
      'https://teamimg-server--elastic-boyd-da0d43.netlify.app/?Tm=' +
        req.query.Tm
    );
    await page.waitForSelector('.playerTitle', { timeout: 10000 });
    const buffer = await page.screenshot({ type: 'png' });
    // Send it back
    res.setHeader('content-type', 'image/png');
    res.write(buffer, 'binary');
    res.end(null, 'binary');
    // Close browser and page
    await page.close();
    browser.close();
  } catch (error) {
    res.status(500).send({ message: 'Failed to create snapshot' });
    await page.close();
    browser.close();
  }
});

// Function to get data by key and optionally update it with scraper

/**
 * Save data to file for a specific key
 * @param {string} key - The key to store data under
 * @param {Object|Array} data - The data to store
 * @returns {boolean} Success status
 */
const saveData = (key, data) => {
  try {
    // Read the current file
    const fileData = fs.existsSync(DATA_FILE) 
      ? JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) 
      : {};
    
    // Update just the specific key
    fileData[key] = data;
    
    // Write the entire object back to file
    fs.writeFileSync(DATA_FILE, JSON.stringify(fileData, null, 2));
    console.log(`Data saved to disk for key: ${key}`);
    return true;
  } catch (error) {
    console.error('Error saving data to disk:', error);
    return false;
  }
};

/**
 * Get data for a specific key from file
 * @param {string} key - The key to retrieve data for
 * @returns {Object|Array|null} The retrieved data or null if not found
 */
const getData = (key) => {
  try {
    // Read from file if it exists
    if (fs.existsSync(DATA_FILE)) {
      const fileData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      return fileData[key] || null;
    }
    return null;
  } catch (error) {
    console.error('Error reading data from file:', error);
    return null;
  }
};

/**
 * Get all stored data
 * @returns {Object} All data from the file
 */
const getAllData = () => {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
    return {};
  } catch (error) {
    console.error('Error reading all data from file:', error);
    return {};
  }
};

// Refactored function to store data with file persistence
const cacheSheet = async (data, attempt, year) => {
  try {
    // Parse JSON data if it's a string
    const parsedData = typeof data === 'string' ? JSON.parse(data) : data;
    
    // Save directly to file
    const success = saveData('dailycat-25', parsedData);
    
    if (success) {
      console.log('Data cached to file successfully');
      return true;
    } else {
      console.error('Failed to cache data to file');
      return false;
    }
  } catch (error) {
    console.error('Error in cacheSheet:', error);
    return false;
  }
};

// Express endpoint to get stats
app.get('/stats', (req, res) => {
  try {
    const key = req.query.key || 'dailycat-25';
    
    // Get data directly from file
    const data = getData(key);
    
    if (data) {
      res.json(data);
    } else {
      // If not found and we have a scraper, try to fetch it

    }
  } catch (error) {
    console.error('Error serving stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
// Add an endpoint to manually trigger cache update if needed
app.post('/update-cache', async (req, res) => {
  try {
    const { key, data } = req.body;
    
    if (!key || !data) {
      return res.status(400).json({ error: 'Both key and data are required' });
    }
    
    // Store the data
    dataStore[key] = typeof data === 'string' ? JSON.parse(data) : data;
    
    // Save to disk
    saveDataToDisk(key);
    
    res.json({ success: true, message: `Cache updated for key: ${key}` });
  } catch (error) {
    console.error('Error updating cache:', error);
    res.status(500).json({ error: 'Failed to update cache' });
  }
});

// Player profile page data (design_handoff_player_profile)
app.get('/api/profiles', (req, res) => {
  res.json(profile.playerIndex());
});

app.get('/api/teams', (req, res) => {
  res.json(profile.teamList());
});

// The Team board: every team's season from the team sheet (lib/teamboard.js).
app.get('/api/teamboard/:season', (req, res) => {
  const doc = /^\d{4}-\d{2}$/.test(req.params.season) ? teamboard(req.params.season) : null;
  if (!doc) {
    return res.status(404).json({ message: 'No team board for that season' });
  }
  res.json(doc);
});

// The team card's units: each team's most-played and best of each size (lib/profile.js).
app.get('/api/teamunits/:season', (req, res) => {
  const doc = /^\d{4}-\d{2}$/.test(req.params.season) ? profile.teamUnitsDoc(req.params.season) : null;
  if (!doc) {
    return res.status(404).json({ message: 'No lineup data for that season' });
  }
  res.json(doc);
});

// The Team board's units view: one team-season's units as counts (lib/profile.js unitsDoc).
app.get('/api/units/:season/:team', (req, res) => {
  const doc = /^\d{4}-\d{2}$/.test(req.params.season) && /^[A-Z]{3}$/.test(req.params.team) ? profile.unitsDoc(req.params.season, req.params.team) : null;
  if (!doc) {
    return res.status(404).json({ message: 'No units for that team and season' });
  }
  res.json(doc);
});

// Playoffs mode reads the same documents under /api/playoffs/ (built from the playoff
// sheet's runs); the player list and teams are shared.
const seasonType = req => (req.path.startsWith('/api/playoffs/') ? 'playoffs' : 'regular');

app.get(['/api/distribution', '/api/playoffs/distribution'], (req, res) => {
  const doc = profile.distribution(String(req.query.stat || ''), { type: seasonType(req) });
  if (!doc) {
    return res.status(404).json({ message: 'Unknown stat' });
  }
  res.json(doc);
});

app.get(['/api/lineups/league', '/api/playoffs/lineups/league'], (req, res) => {
  const season = /^\d{4}-\d{2}$/.test(req.query.season || '') ? req.query.season : null;
  const doc = profile.lineupLeague(seasonType(req), season);
  if (!doc) {
    return res.status(404).json({ message: 'No lineup data' });
  }
  res.json(doc);
});

app.get(['/api/profile/:slug', '/api/playoffs/profile/:slug'], (req, res) => {
  const doc = profile.buildProfile(req.params.slug, { type: seasonType(req) });
  if (!doc) {
    return res.status(404).json({ message: 'Player not found' });
  }
  res.json(doc);
});

// The Leaderboard page: its seasons, and one season's players with every stat.
app.get(['/api/leaderboard', '/api/playoffs/leaderboard'], (req, res) => {
  res.json({ seasons: profile.leaderboardSeasons(seasonType(req)) });
});

// Playoffs minus regular season, each playoff player's change in every stat.
app.get('/api/playoffs/leaderboard/delta/:season', (req, res) => {
  const doc = profile.leaderboardDelta(req.params.season);
  if (!doc) {
    return res.status(404).json({ message: 'No such season' });
  }
  res.json(doc);
});

// The last 30 days of the latest season (regular season only).
app.get('/api/leaderboard/recent', (req, res) => {
  const doc = profile.leaderboardRecent();
  if (!doc) {
    return res.status(404).json({ message: 'No 30-day window' });
  }
  res.json(doc);
});

// A season's board takes seconds to build (every player's Footprint that season), and the
// Leaderboard's eras ask for all thirty at once: each is kept once built, as the data
// behind it is (lib/profile.js reads it once).
const boards = new Map();
app.get(['/api/leaderboard/:season', '/api/playoffs/leaderboard/:season'], (req, res) => {
  const key = `${seasonType(req)}|${req.params.season}`;
  if (!boards.has(key)) boards.set(key, profile.leaderboard(req.params.season, { type: seasonType(req) }));
  const doc = boards.get(key);
  if (!doc) {
    return res.status(404).json({ message: 'No such season' });
  }
  res.json(doc);
});

// The Footprint tab's views (every season and span; regular season only), fetched when
// the tab opens rather than with the profile.
app.get('/api/footprint/:slug', (req, res) => {
  const doc = profile.footprintDoc(req.params.slug);
  if (!doc) {
    return res.status(404).json({ message: 'No footprint data' });
  }
  res.json(doc);
});

// The Lonestar tab's views (every season and span; regular season only), fetched when
// the tab opens rather than with the profile.
app.get('/api/lonestar/:slug', (req, res) => {
  const doc = profile.lonestarDoc(req.params.slug);
  if (!doc) {
    return res.status(404).json({ message: 'No Lonestar data' });
  }
  res.json(doc);
});

app.get('/api/shots/:slug', (req, res) => {
  const doc = profile.shotDotsOf(req.params.slug);
  if (!doc) {
    return res.status(404).json({ message: 'No shots' });
  }
  res.json(doc);
});

app.use('/assets/players', express.static(path.join(__dirname, 'assets', 'players')));

app.get('/postscore', (req, res) => {
  const score = req.query.score;
  const total = req.query.total;
  const device = req.query.device;
  const date = new Date();
  const data = {
    score,
    total,
    device,
    date,
  };
  const mediumArticles = new Promise((resolve, reject) => {
    scraper
      .postStat('quizScores', data)
      .then((data) => {
        resolve(data);
      })
      .catch((err) => reject('Medium scrape failed'));
  });

  Promise.all([mediumArticles])
    .then((data) => {
      res.json(data[0]);
    })
    .catch((err) => res.status(500).send(err));
});

const server = app.listen(port, ip);

