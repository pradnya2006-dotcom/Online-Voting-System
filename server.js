const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const { OAuth2Client } = require('google-auth-library');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// MySQL Connection Pool
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    database: process.env.DB_NAME || 'online_voting_system',
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Check Connection & Seed Candidates
pool.getConnection()
    .then(async conn => {
        console.log('✅ Connected to MySQL Database: ' + process.env.DB_NAME);
        
        try {
            // Ensure expected candidates exist
            const expectedCandidates = ['Candidate 1', 'Candidate 2', 'Candidate 3'];
            for (const name of expectedCandidates) {
                const [rows] = await conn.query('SELECT * FROM candidates WHERE name = ?', [name]);
                if (rows.length === 0) {
                    await conn.query('INSERT INTO candidates (name) VALUES (?)', [name]);
                    console.log(`🌱 Added missing candidate: ${name}`);
                }
            }
            const [candidates] = await conn.query('SELECT name FROM candidates');
            console.log('📋 Current candidates in database: ' + candidates.map(c => c.name).join(', '));
        } catch (err) {
            console.error('⚠️ Could not seed candidates. Ensure tables exist by running database_setup.sql.');
        }
        
        conn.release();
    })
    .catch(err => {
        console.error('❌ MySQL Connection Error:', err);
        console.log('Please ensure MySQL is running and credentials in .env are correct.');
    });

// --- API Routes ---

// Serve pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'register.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));
app.get('/vote', (req, res) => res.sendFile(path.join(__dirname, 'vote.html')));
app.get('/result', (req, res) => res.sendFile(path.join(__dirname, 'result.html')));

// 1. User Registration
app.post('/api/register', async (req, res) => {
    const { full_name, email, voter_id, password } = req.body;

    try {
        // Check if user already exists
        const [rows] = await pool.query('SELECT * FROM voters WHERE email = ? OR voter_id = ?', [email, voter_id]);
        if (rows.length > 0) {
            return res.status(400).json({ message: 'Voter ID or Email already registered!' });
        }

        // Hash Password
        const hashedPassword = await bcrypt.hash(password, 10);

        await pool.query(
            'INSERT INTO voters (name, email, voter_id, password) VALUES (?, ?, ?, ?)',
            [full_name.trim(), email.trim(), voter_id.trim(), hashedPassword]
        );

        console.log(`✅ User registered: ${voter_id}`);
        res.status(200).json({ message: 'Registration successful!' });
    } catch (err) {
        console.error('Registration Error:', err);
        res.status(500).json({ message: 'Registration failed.' });
    }
});

// 2. User Login
app.post('/api/login', async (req, res) => {
    const voter_id = req.body.voter_id ? req.body.voter_id.trim() : "";
    const password = req.body.password ? req.body.password.trim() : "";

    console.log('--------------------------------------------------');
    console.log('📥 Login Attempt Received:');
    console.log(`- Voter ID: "${voter_id}"`);

    try {
        const [rows] = await pool.query('SELECT * FROM voters WHERE voter_id = ?', [voter_id]);
        const user = rows[0];

        if (!user) {
            console.log('❌ Failure: User not found');
            return res.status(401).json({ message: 'Invalid Voter ID or Password' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            console.log('❌ Failure: Password mismatch');
            return res.status(401).json({ message: 'Invalid Voter ID or Password' });
        }

        console.log('✅ Success: Login successful');
        const { password: _, ...userData } = user; // Exclude password
        res.status(200).json({ message: 'Login successful', user: userData });
    } catch (err) {
        console.error('Login Error:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
    console.log('--------------------------------------------------');
});

// 3. Google Login
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

app.post('/api/google-login', async (req, res) => {
    const { token } = req.body;

    try {
        const ticket = await client.verifyIdToken({
            idToken: token,
            audience: process.env.GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        const email = payload['email'];

        console.log('--------------------------------------------------');
        console.log('📥 Google Login Attempt: ' + email);

        const [rows] = await pool.query('SELECT * FROM voters WHERE email = ?', [email]);
        const user = rows[0];

        if (user) {
            console.log('✅ Success: User found');
            const { password: _, ...userData } = user;
            res.status(200).json({ message: 'Login successful', user: userData });
        } else {
            console.log('❌ Failure: No user found with this email');
            res.status(401).json({ message: 'No registered voter found with this Google email.' });
        }
    } catch (error) {
        console.error('❌ Google Token Verification Failed:', error.message);
        res.status(400).json({ message: 'Invalid Google token' });
    }
});

// 4. Cast Vote
app.post('/api/vote', async (req, res) => {
    const { voter_id, candidate_name } = req.body;

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [userRows] = await connection.query('SELECT has_voted FROM voters WHERE voter_id = ? FOR UPDATE', [voter_id]);
        const user = userRows[0];

        if (!user) {
            await connection.rollback();
            return res.status(404).json({ message: 'User not found' });
        }

        if (user.has_voted) {
            await connection.rollback();
            return res.status(400).json({ message: 'You have already cast your vote!' });
        }

        const [candidateRows] = await connection.query('UPDATE candidates SET votes = votes + 1 WHERE name = ?', [candidate_name]);

        if (candidateRows.affectedRows === 0) {
            await connection.rollback();
            return res.status(404).json({ message: 'Candidate not found' });
        }

        await connection.query('UPDATE voters SET has_voted = TRUE WHERE voter_id = ?', [voter_id]);

        await connection.commit();
        res.status(200).json({ message: 'Vote successfully recorded!' });
    } catch (err) {
        await connection.rollback();
        console.error('Voting Error:', err);
        res.status(500).json({ message: 'Voting failed.' });
    } finally {
        connection.release();
    }
});

// 5. Get Results
app.get('/api/results', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM candidates ORDER BY votes DESC');
        res.status(200).json(rows);
    } catch (err) {
        console.error('Results Error:', err);
        res.status(500).json({ message: 'Failed to fetch results.' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 SERVER RUNNING AT: http://localhost:${PORT}`);
});
