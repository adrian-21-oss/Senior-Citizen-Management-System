// THIS IS THE BACKEND SERVER (Node.js + Express + PostgreSQL) FOR THE SENIOR CITIZEN MANAGEMENT SYSTEM (SCMS)
// YOU WILL PUT YOUR BACKEND ROUTES HERE. THE FRONTEND IS IN THE "public" FOLDER, AND IT USES AJAX TO CALL THESE ROUTES.


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

// Test Database Connection Route -- This will test if the backend can connect to the database (your local database pgAdmin). You can call it by visiting http://localhost:5000/api/test-db in your browser or using Postman. 
app.get('/api/test-db', async (req, res) => {
    try {
        const result = await pool.query('SELECT NOW()');
        res.json({ status: 'Success', database_time: result.rows[0].now }); // Connected
    } catch (err) {
        console.error('Database connection error:', err);
        res.status(500).json({ error: 'Database connection failed' }); // Not Connected
    }
});






// Auto-Generate Next Senior ID Route (e.g., SC-2026-0001)   FEEL FREE TO CHANGE EVERYTHING IF YOU WANT, SPECIALLY IF YOU ARE ASSIGNED TO THIS PART (Index.html). THIS IS JUST AN EXAMPLE.
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















// ============================================================
// PROCESS BENEFITS ROUTES
// Paste this block into server.js, below the /api/senior/next-id
// route and ABOVE app.listen(...). It uses the existing `pool`.
// ============================================================

const ADMIN_ID = 3; // TEMPORARY: Benefits Staff. Replace with the logged-in admin once login exists.
const benefitYear = () => new Date().getFullYear();

// 1) Search seniors by NAME only (partial, case-insensitive)
//    GET /api/benefits/search?name=adrian pono
app.get('/api/benefits/search', async (req, res) => {
    const name = String(req.query.name || '').trim().replace(/\s+/g, ' ');
    if (!name) {
        return res.status(400).json({ error: 'Enter a senior name to search.' });
    }

    // Escape LIKE wildcards typed by the user
    const pattern = `%${name.replace(/[\\%_]/g, '\\$&')}%`;

    try {
        const result = await pool.query(
            `SELECT senior_id,
                    CONCAT_WS(' ', first_name, NULLIF(middle_name, ''), last_name) AS full_name
             FROM senior_citizen
             WHERE CONCAT_WS(' ', first_name, NULLIF(middle_name, ''), last_name) ILIKE $1
                OR CONCAT_WS(' ', first_name, last_name) ILIKE $1
             ORDER BY last_name, first_name
             LIMIT 10`,
            [pattern]
        );
        res.json({ seniors: result.rows });
    } catch (err) {
        console.error('Senior search error:', err);
        res.status(500).json({ error: 'Search failed. Please try again.' });
    }
});

// 2) List this year's benefits for one senior, with Available / Claimed status
//    GET /api/benefits/senior/SC-2026-0001
app.get('/api/benefits/senior/:seniorId', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT b.benefit_id,
                    b.benefit_name,
                    b.period_description,
                    b.amount,
                    bt.claim_status AS status
             FROM benefit b
             JOIN benefit_transaction bt
                    ON bt.benefit_id = b.benefit_id
                   AND bt.benefit_year = b.benefit_year
                   AND bt.senior_id = $1
             WHERE b.benefit_year = $2
             ORDER BY b.benefit_id`,
            [req.params.seniorId, benefitYear()]
        );
        res.json({ benefits: result.rows });
    } catch (err) {
        console.error('Load benefits error:', err);
        res.status(500).json({ error: 'Could not load benefits.' });
    }
});

// 3) Release cash payout: marks every selected benefit as Claimed
//    POST /api/benefits/release   body: { senior_id, benefit_ids: [1, 2] }
app.post('/api/benefits/release', async (req, res) => {
    const { senior_id, benefit_ids } = req.body;

    if (!senior_id || !Array.isArray(benefit_ids) || benefit_ids.length === 0) {
        return res.status(400).json({ error: 'Select at least one benefit to release.' });
    }

    const ids = [...new Set(benefit_ids.map(Number))];
    if (ids.some(id => !Number.isInteger(id))) {
        return res.status(400).json({ error: 'Invalid benefit selection.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const senior = await client.query('SELECT 1 FROM senior_citizen WHERE senior_id = $1', [senior_id]);
        if (senior.rowCount === 0) {
            throw Object.assign(new Error('Senior not found.'), { status: 404 });
        }

        let total = 0;
        for (const id of ids) {
            // Only an existing 'Available' row can be claimed. Amount comes from the
            // benefit table, never from the browser.
            const r = await client.query(
                `UPDATE benefit_transaction bt
                 SET claim_status    = 'Claimed',
                     admin_id        = $2,
                     amount_released = b.amount,
                     released_on     = NOW()
                 FROM benefit b
                 WHERE b.benefit_id   = bt.benefit_id
                   AND b.benefit_year = bt.benefit_year
                   AND bt.senior_id    = $1
                   AND bt.benefit_id   = $3
                   AND bt.benefit_year = $4
                   AND bt.claim_status = 'Available'
                 RETURNING bt.amount_released`,
                [senior_id, ADMIN_ID, id, benefitYear()]
            );

            if (r.rowCount === 0) {
                // Already claimed, or not assigned to this senior
                throw Object.assign(
                    new Error('One or more selected benefits are already claimed or not assigned to this senior. Search again to refresh.'),
                    { status: 409 }
                );
            }
            total += Number(r.rows[0].amount_released);
        }

        await client.query('COMMIT');
        res.json({ success: true, released: ids.length, total });
    } catch (err) {
        await client.query('ROLLBACK');
        if (err.status) {
            return res.status(err.status).json({ error: err.message });
        }
        console.error('Release payout error:', err);
        res.status(500).json({ error: 'Payout could not be released. Nothing was saved.' });
    } finally {
        client.release();
    }
});
// Senior Registry (Dashboard, Register, Profiles, Audit)
app.use('/api', require('./registry-routes'));