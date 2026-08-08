require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const bcrypt = require('bcrypt');

const app = express();

app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const MAX_BALANCE = parseInt(process.env.MAX_BALANCE) || 10000000;
const FOOTBALL_API_KEY = 'e22423a5c1344cbfb1899985d652ffed';

// Database Connection (Supports local setup and Aiven cloud with SSL)
const db = mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'marius',
  database: process.env.DB_NAME || 'betting',
  ssl: process.env.DB_HOST ? { rejectUnauthorized: false } : null
});

db.connect((err) => {
  if (err) {
    console.error('Database connection failed:', err);
    return;
  }
  console.log('Connected to MySQL successfully.');
  
  db.query(`
    CREATE TABLE IF NOT EXISTS custom_matches (
      id INT AUTO_INCREMENT PRIMARY KEY,
      home VARCHAR(255) NOT NULL,
      away VARCHAR(255) NOT NULL,
      home_odd DECIMAL(5,2) NOT NULL,
      draw_odd DECIMAL(5,2) NOT NULL,
      away_odd DECIMAL(5,2) NOT NULL,
      over_odd DECIMAL(5,2) DEFAULT 1.85,
      under_odd DECIMAL(5,2) DEFAULT 1.95,
      btts_yes DECIMAL(5,2) DEFAULT 1.80,
      btts_no DECIMAL(5,2) DEFAULT 1.90,
      dc_1x DECIMAL(5,2) DEFAULT 1.25,
      dc_12 DECIMAL(5,2) DEFAULT 1.35,
      dc_x2 DECIMAL(5,2) DEFAULT 1.45,
      dnb_home DECIMAL(5,2) DEFAULT 1.40,
      dnb_away DECIMAL(5,2) DEFAULT 2.10,
      cs_00 DECIMAL(5,2) DEFAULT 6.05,
      cs_10 DECIMAL(5,2) DEFAULT 7.28,
      cs_20 DECIMAL(5,2) DEFAULT 14.03,
      cs_30 DECIMAL(5,2) DEFAULT 40.83,
      cs_40 DECIMAL(5,2) DEFAULT 50.00,
      cs_01 DECIMAL(5,2) DEFAULT 5.79,
      cs_11 DECIMAL(5,2) DEFAULT 4.79,
      cs_21 DECIMAL(5,2) DEFAULT 10.93,
      cs_31 DECIMAL(5,2) DEFAULT 31.67,
      cs_41 DECIMAL(5,2) DEFAULT 50.00,
      cs_02 DECIMAL(5,2) DEFAULT 8.77,
      cs_12 DECIMAL(5,2) DEFAULT 8.65,
      cs_22 DECIMAL(5,2) DEFAULT 13.94,
      cs_32 DECIMAL(5,2) DEFAULT 48.82,
      cs_42 DECIMAL(5,2) DEFAULT 50.00,
      cs_03 DECIMAL(5,2) DEFAULT 19.91,
      cs_13 DECIMAL(5,2) DEFAULT 19.63,
      cs_23 DECIMAL(5,2) DEFAULT 38.38,
      cs_33 DECIMAL(5,2) DEFAULT 50.00,
      cs_43 DECIMAL(5,2) DEFAULT 50.00,
      cs_14 DECIMAL(5,2) DEFAULT 50.00,
      cs_24 DECIMAL(5,2) DEFAULT 50.00,
      cs_34 DECIMAL(5,2) DEFAULT 50.00,
      cs_44 DECIMAL(5,2) DEFAULT 50.00,
      cs_other DECIMAL(5,2) DEFAULT 49.49,
      match_time DATETIME NOT NULL,
      status VARCHAR(50) DEFAULT 'UPCOMING',
      home_score INT DEFAULT NULL,
      away_score INT DEFAULT NULL
    )
  `);

  db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(255) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      balance DECIMAL(15,2) DEFAULT 10000.00
    )
  `);

  db.query(`
    CREATE TABLE IF NOT EXISTS bets (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      amount DECIMAL(15,2) NOT NULL,
      potential_win DECIMAL(15,2) NOT NULL,
      status VARCHAR(255) DEFAULT 'PENDING',
      selections TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
});

// Helper function to map correct score settings
function mapCorrectScores(row) {
  return {
    cs00: parseFloat(row.cs_00 || 6.05), cs10: parseFloat(row.cs_10 || 7.28), cs20: parseFloat(row.cs_20 || 14.03), cs30: parseFloat(row.cs_30 || 40.83), cs40: parseFloat(row.cs_40 || 50.00),
    cs01: parseFloat(row.cs_01 || 5.79), cs11: parseFloat(row.cs_11 || 4.79), cs21: parseFloat(row.cs_21 || 10.93), cs31: parseFloat(row.cs_31 || 31.67), cs41: parseFloat(row.cs_41 || 50.00),
    cs02: parseFloat(row.cs_02 || 8.77), cs12: parseFloat(row.cs_12 || 8.65), cs22: parseFloat(row.cs_22 || 13.94), cs32: parseFloat(row.cs_32 || 48.82), cs42: parseFloat(row.cs_42 || 50.00),
    cs03: parseFloat(row.cs_03 || 19.91), cs13: parseFloat(row.cs_13 || 19.63), cs23: parseFloat(row.cs_23 || 38.38), cs33: parseFloat(row.cs_33 || 50.00), cs43: parseFloat(row.cs_43 || 50.00),
    cs14: parseFloat(row.cs_14 || 50.00), cs24: parseFloat(row.cs_24 || 50.00), cs34: parseFloat(row.cs_34 || 50.00), cs44: parseFloat(row.cs_44 || 50.00), csOther: parseFloat(row.cs_other || 49.49)
  };
}

const defaultApiScores = {
  cs00: 6.05, cs10: 7.28, cs20: 14.03, cs30: 40.83, cs40: 50.00,
  cs01: 5.79, cs11: 4.79, cs21: 10.93, cs31: 31.67, cs41: 50.00,
  cs02: 8.77, cs12: 8.65, cs22: 13.94, cs32: 48.82, cs42: 50.00,
  cs03: 19.91, cs13: 19.63, cs23: 38.38, cs33: 50.00, cs43: 50.00,
  cs14: 50.00, cs24: 50.00, cs34: 50.00, cs44: 50.00, csOther: 49.49
};

// MATCHES ROUTE
app.get('/matches', async (req, res) => {
  let customUpcoming = [];
  let apiLive = [];
  let apiUpcoming = [];

  db.query("SELECT * FROM custom_matches WHERE status = 'UPCOMING' ORDER BY match_time ASC", async (err, results) => {
    if (!err && results.length > 0) {
      customUpcoming = results.map(cm => ({
        id: `custom_${cm.id}`,
        dbId: cm.id,
        home: cm.home,
        away: cm.away,
        odds: {
          home: parseFloat(cm.home_odd),
          draw: parseFloat(cm.draw_odd),
          away: parseFloat(cm.away_odd),
          over: parseFloat(cm.over_odd || 1.85),
          under: parseFloat(cm.under_odd || 1.95),
          bttsYes: parseFloat(cm.btts_yes || 1.80),
          bttsNo: parseFloat(cm.btts_no || 1.90),
          dc1x: parseFloat(cm.dc_1x || 1.25),
          dc12: parseFloat(cm.dc_12 || 1.35),
          dcx2: parseFloat(cm.dc_x2 || 1.45),
          dnbHome: parseFloat(cm.dnb_home || 1.40),
          dnbAway: parseFloat(cm.dnb_away || 2.10),
          ...mapCorrectScores(cm)
        },
        matchTime: cm.match_time,
        isCustom: true
      }));
    }

    try {
      const liveRes = await fetch('https://api.football-data.org/v4/matches?status=LIVE,IN_PLAY,PAUSED', {
        headers: { 'X-Auth-Token': FOOTBALL_API_KEY }
      });
      if (liveRes.ok) {
        const liveData = await liveRes.json();
        if (liveData.matches) {
          apiLive = liveData.matches.map(m => ({
            id: `api_${m.id}`,
            home: m.homeTeam.name,
            away: m.awayTeam.name,
            odds: { 
              home: 1.85, draw: 3.40, away: 3.20, over: 1.80, under: 1.95, 
              bttsYes: 1.75, bttsNo: 2.00, dc1x: 1.22, dc12: 1.30, dcx2: 1.55, 
              dnbHome: 1.35, dnbAway: 2.25, ...defaultApiScores
            },
            matchTime: m.utcDate,
            score: `${m.score.fullTime.home ?? 0} - ${m.score.fullTime.away ?? 0}`,
            isLiveApi: true
          }));
        }
      }
    } catch (e) {
      console.log('Live API fetch error skipped.');
    }

    try {
      const upcomingRes = await fetch('https://api.football-data.org/v4/matches?status=SCHEDULED', {
        headers: { 'X-Auth-Token': FOOTBALL_API_KEY }
      });
      if (upcomingRes.ok) {
        const upcomingData = await upcomingRes.json();
        if (upcomingData.matches) {
          apiUpcoming = upcomingData.matches.map(m => ({
            id: `api_${m.id}`,
            home: m.homeTeam.name,
            away: m.awayTeam.name,
            odds: { 
              home: 1.90, draw: 3.30, away: 3.10, over: 1.85, under: 1.90, 
              bttsYes: 1.80, bttsNo: 1.90, dc1x: 1.25, dc12: 1.35, dcx2: 1.45, 
              dnbHome: 1.40, dnbAway: 2.10, ...defaultApiScores
            },
            matchTime: m.utcDate,
            isApiUpcoming: true
          }));
        }
      }
    } catch (e) {
      console.log('Upcoming API fetch error skipped.');
    }

    const combinedUpcoming = [...customUpcoming, ...apiUpcoming];
    res.json({ live: apiLive, upcoming: combinedUpcoming });
  });
});

// ADMIN: Add custom match with comprehensive full correct score markets
app.post('/admin/add-match', (req, res) => {
  let body = req.body;
  let home = body.home;
  let away = body.away;
  let matchTime = body.matchTime;

  if (!home || !away || !matchTime) {
    return res.status(400).send('Teams and match time are required.');
  }

  if (matchTime.includes('T')) {
    matchTime = matchTime.replace('T', ' ') + ':00';
  }

  const queryStr = `INSERT INTO custom_matches 
    (home, away, home_odd, draw_odd, away_odd, over_odd, under_odd, btts_yes, btts_no, dc_1x, dc_12, dc_x2, dnb_home, dnb_away, 
     cs_00, cs_10, cs_20, cs_30, cs_40, cs_01, cs_11, cs_21, cs_31, cs_41, cs_02, cs_12, cs_22, cs_32, cs_42, cs_03, cs_13, cs_23, cs_33, cs_43, cs_14, cs_24, cs_34, cs_44, cs_other, match_time, status) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'UPCOMING')`;

  const values = [
    home, away, 
    parseFloat(body.homeOdd) || 1.90, parseFloat(body.drawOdd) || 3.30, parseFloat(body.awayOdd) || 3.10, 
    parseFloat(body.overOdd) || 1.85, parseFloat(body.underOdd) || 1.95, 
    parseFloat(body.bttsYes) || 1.80, parseFloat(body.bttsNo) || 1.90,
    parseFloat(body.dc1x) || 1.25, parseFloat(body.dc12) || 1.35, parseFloat(body.dcx2) || 1.45,
    parseFloat(body.dnbHome) || 1.40, parseFloat(body.dnbAway) || 2.10,
    parseFloat(body.cs00) || 6.05, parseFloat(body.cs10) || 7.28, parseFloat(body.cs20) || 14.03, parseFloat(body.cs30) || 40.83, parseFloat(body.cs40) || 50.00,
    parseFloat(body.cs01) || 5.79, parseFloat(body.cs11) || 4.79, parseFloat(body.cs21) || 10.93, parseFloat(body.cs31) || 31.67, parseFloat(body.cs41) || 50.00,
    parseFloat(body.cs02) || 8.77, parseFloat(body.cs12) || 8.65, parseFloat(body.cs22) || 13.94, parseFloat(body.cs32) || 48.82, parseFloat(body.cs42) || 50.00,
    parseFloat(body.cs03) || 19.91, parseFloat(body.cs13) || 19.63, parseFloat(body.cs23) || 38.38, parseFloat(body.cs33) || 50.00, parseFloat(body.cs43) || 50.00,
    parseFloat(body.cs14) || 50.00, parseFloat(body.cs24) || 50.00, parseFloat(body.cs34) || 50.00, parseFloat(body.cs44) || 50.00, parseFloat(body.csOther) || 49.49,
    matchTime
  ];

  db.query(queryStr, values, (err) => {
    if (err) {
      console.error("DB Insert Error:", err);
      return res.status(500).send('Failed to add custom match.');
    }
    res.json({ success: true, message: `Scheduled ${home} vs ${away} successfully!` });
  });
});

app.get('/admin/custom-matches', (req, res) => {
  db.query('SELECT * FROM custom_matches ORDER BY id DESC', (err, results) => {
    if (err) return res.status(500).send(err);
    res.json(results);
  });
});

// ADMIN: Resolve custom match and auto-grade user bets
app.post('/admin/resolve-match', (req, res) => {
  const { matchId, homeScore, awayScore } = req.body;
  const hScore = parseInt(homeScore);
  const aScore = parseInt(awayScore);

  if (!matchId || isNaN(hScore) || isNaN(aScore)) {
    return res.status(400).send('Match ID and valid scores are required.');
  }

  db.query(
    'UPDATE custom_matches SET status = "FINISHED", home_score = ?, away_score = ? WHERE id = ?',
    [hScore, aScore, matchId],
    (err) => {
      if (err) return res.status(500).send('Failed to update match result.');

      db.query("SELECT * FROM bets WHERE status LIKE '%PENDING%'", (err, pendingBets) => {
        if (err) return res.json({ success: true, message: 'Match resolved, but failed to evaluate open bets.' });

        pendingBets.forEach(bet => {
          try {
            let selections = JSON.parse(bet.selections);
            let matchFailed = false;

            selections.forEach(sel => {
              if (String(sel.matchId) === `custom_${matchId}` || String(sel.dbId) === String(matchId)) {
                let totalGoals = hScore + aScore;
                let outcome = '';

                if (sel.market === '1x2') {
                  if (hScore > aScore) outcome = 'home';
                  else if (hScore < aScore) outcome = 'away';
                  else outcome = 'draw';
                } else if (sel.market === 'ou') {
                  outcome = totalGoals > 2.5 ? 'over' : 'under';
                } else if (sel.market === 'btts') {
                  outcome = (hScore > 0 && aScore > 0) ? 'yes' : 'no';
                } else if (sel.market === 'dc') {
                  if (sel.pick === '1x') outcome = hScore >= aScore ? '1x' : 'lost';
                  else if (sel.pick === '12') outcome = hScore !== aScore ? '12' : 'lost';
                  else if (sel.pick === 'x2') outcome = aScore >= hScore ? 'x2' : 'lost';
                  
                  if (outcome !== sel.pick) matchFailed = true;
                  return;
                } else if (sel.market === 'dnb') {
                  if (hScore === aScore) {
                    sel.odds = 1.0; 
                    return; 
                  }
                  outcome = (hScore > aScore) ? 'home' : 'away';
                } else if (sel.market === 'cs') {
                  let exactMatchStr = `${hScore}-${aScore}`;
                  if (sel.pick === 'other') {
                    if (hScore <= 4 && aScore <= 4) matchFailed = true;
                  } else {
                    if (sel.pick !== exactMatchStr) matchFailed = true;
                  }
                  return;
                }

                if (sel.market !== 'dc' && sel.market !== 'cs' && sel.pick !== outcome) {
                  matchFailed = true;
                }
              }
            });

            if (matchFailed) {
              db.query('UPDATE bets SET status = ? WHERE id = ?', [`LOST (Match #${matchId} settled)`, bet.id]);
            } else {
              db.query('UPDATE bets SET status = ? WHERE id = ?', [`WON (Match #${matchId} settled)`, bet.id], () => {
                db.query('SELECT balance FROM users WHERE id = ?', [bet.user_id], (err, uRes) => {
                  if (!err && uRes.length > 0) {
                    let newBal = parseFloat(uRes[0].balance) + parseFloat(bet.potential_win);
                    db.query('UPDATE users SET balance = ? WHERE id = ?', [newBal, bet.user_id]);
                  }
                });
              });
            }
          } catch (e) {
            console.error('Error evaluating bet slip:', e);
          }
        });

        res.json({ success: true, message: `Match resolved and bets evaluated successfully!` });
      });
    }
  );
});

// AUTH & UTILS
app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    db.query('INSERT INTO users (username, password) VALUES (?, ?)', [username, hashedPassword], (err) => {
      if (err) return res.status(500).send('User registration failed');
      res.send('User registered successfully!');
    });
  } catch (err) {
    res.status(500).send(err);
  }
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  db.query('SELECT * FROM users WHERE username = ?', [username], async (err, results) => {
    if (err) return res.status(500).send(err);
    if (results.length === 0) return res.status(400).send('User not found');

    const user = results[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).send('Invalid password');

    const isAdmin = user.username.toLowerCase() === 'admin';
    res.json({
      message: 'Login successful!',
      user: { id: user.id, username: user.username, balance: user.balance, isAdmin }
    });
  });
});

app.get('/admin/users', (req, res) => {
  db.query('SELECT id, username, balance FROM users', (err, results) => {
    if (err) return res.status(500).send(err);
    res.json(results);
  });
});

app.get('/admin/bets', (req, res) => {
  db.query(`
    SELECT bets.id, users.username, bets.amount, bets.status 
    FROM bets 
    JOIN users ON bets.user_id = users.id 
    ORDER BY bets.id DESC LIMIT 20
  `, (err, results) => {
    if (err) return res.status(500).send(err);
    res.json(results);
  });
});

app.post('/admin/adjust-balance', (req, res) => {
  const { userId, newBalance } = req.body;
  const balanceVal = parseFloat(newBalance);

  if (!userId || isNaN(balanceVal) || balanceVal < 0 || balanceVal > MAX_BALANCE) {
    return res.status(400).send('Invalid balance value.');
  }

  db.query('UPDATE users SET balance = ? WHERE id = ?', [balanceVal, userId], (err) => {
    if (err) return res.status(500).send(err);
    res.json({ success: true, message: `Successfully updated user #${userId} balance!` });
  });
});

app.post('/place-bet', (req, res) => {
  const { userId, selections, amount, potentialWin } = req.body;
  const betAmount = parseFloat(amount);

  if (!userId || !selections || selections.length === 0 || !betAmount || betAmount <= 0) {
    return res.status(400).send('Invalid bet request or empty slip.');
  }

  db.query('SELECT balance FROM users WHERE id = ?', [userId], (err, results) => {
    if (err) return res.status(500).send(err);
    if (results.length === 0) return res.status(404).send('User not found');

    const currentBalance = parseFloat(results[0].balance);
    if (currentBalance < betAmount) {
      return res.status(400).send('Insufficient balance!');
    }

    let calculatedBalance = currentBalance - betAmount;

    db.query('UPDATE users SET balance = ? WHERE id = ?', [calculatedBalance, userId], (err) => {
      if (err) return res.status(500).send(err);

      const slipDescription = `Parlay (${selections.length} games) - PENDING`;
      db.query(
        'INSERT INTO bets (user_id, amount, potential_win, status, selections) VALUES (?, ?, ?, ?, ?)',
        [userId, betAmount, parseFloat(potentialWin), slipDescription, JSON.stringify(selections)],
        (err) => {
          if (err) return res.status(500).send(err);
          res.json({
            success: true,
            newBalance: calculatedBalance,
            message: 'Bet placed successfully!'
          });
        }
      );
    });
  });
});

app.get('/bet-history/:userId', (req, res) => {
  const userId = req.params.userId;
  db.query('SELECT * FROM bets WHERE user_id = ? ORDER BY id DESC LIMIT 10', [userId], (err, results) => {
    if (err) return res.status(500).send(err);
    res.json(results);
  });
});

app.post('/deposit', (req, res) => {
  const { userId, amount } = req.body;
  const depositAmt = parseFloat(amount);

  if (!userId || !depositAmt || depositAmt <= 0) return res.status(400).send('Invalid amount.');

  db.query('SELECT balance FROM users WHERE id = ?', [userId], (err, results) => {
    if (err) return res.status(500).send(err);
    const currentBal = parseFloat(results[0].balance);
    const newBalance = currentBal + depositAmt;
    db.query('UPDATE users SET balance = ? WHERE id = ?', [newBalance, userId], (err) => {
      if (err) return res.status(500).send(err);
      res.json({ success: true, newBalance, message: `Successfully deposited ₦${depositAmt.toLocaleString()}!` });
    });
  });
});

app.post('/withdraw', (req, res) => {
  const { userId, amount } = req.body;
  const withdrawAmt = parseFloat(amount);

  if (!userId || !withdrawAmt || withdrawAmt <= 0) return res.status(400).send('Invalid amount.');

  db.query('SELECT balance FROM users WHERE id = ?', [userId], (err, results) => {
    if (err) return res.status(500).send(err);
    const currentBal = parseFloat(results[0].balance);
    if (withdrawAmt > currentBal) return res.status(400).send('Insufficient funds!');
    const newBalance = currentBal - withdrawAmt;
    db.query('UPDATE users SET balance = ? WHERE id = ?', [newBalance, userId], (err) => {
      if (err) return res.status(500).send(err);
      res.json({ success: true, newBalance, message: `Successfully withdrew ₦${withdrawAmt.toLocaleString()}!` });
    });
  });
});

app.listen(PORT, () => {
  console.log(`Server running securely at http://localhost:${PORT}`);
});
