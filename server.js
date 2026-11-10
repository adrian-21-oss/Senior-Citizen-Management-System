const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Serve static frontend files from the "public" folder
app.use(express.static('public'));

// PostgreSQL Connection Pool Setup
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

// Test Database Connection Route
app.get('/api/test-db', async (req, res) => {
    try {
        const result = await pool.query('SELECT NOW()');
        res.json({ status: 'Success', database_time: result.rows[0].now });
    } catch (err) {
        console.error('Database connection error:', err);
        res.status(500).json({ error: 'Database connection failed' });
    }
});

// Auto-Generate Next Senior ID Route (e.g., SC-2026-0001)
app.get('/api/senior/next-id', async (req, res) => {
    try {
        const currentYear = new Date().getFullYear();
        const countResult = await pool.query('SELECT COUNT(*) FROM seniors');
        const nextNumber = parseInt(countResult.rows[0].count) + 1;
        const formattedId = `SC-${currentYear}-${String(nextNumber).padStart(4, '0')}`;
        
        res.json({ next_id: formattedId });
    } catch (err) {
        console.error('Error generating ID:', err);
        res.status(500).json({ error: 'Failed to generate ID' });
    }
});

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`SCMS Backend running smoothly on http://localhost:${PORT}`);
});