// Creates or updates a staff account with a properly hashed password.
// Usage: node scripts/create-admin.js <username> "<Full Name>" "<Role>" <password>
// Roles: Admin | Registration Staff | Benefits Staff
require('dotenv').config();
const crypto = require('crypto');
const { Pool } = require('pg');
const [, , username, fullName, role, password] = process.argv;
if (!password) { console.log('Usage: node scripts/create-admin.js <username> "<Full Name>" "<Role>" <password>\nRoles: Admin | Registration Staff | Benefits Staff'); process.exit(1); }
const salt = crypto.randomBytes(16).toString('hex');
const hash = `scrypt$${salt}$${crypto.scryptSync(password, salt, 32).toString('hex')}`;
const pool = new Pool({ user: process.env.DB_USER, host: process.env.DB_HOST, database: process.env.DB_NAME, password: process.env.DB_PASSWORD, port: process.env.DB_PORT });
pool.query(`INSERT INTO admin_user (full_name, username, password_hash, role) VALUES ($1,$2,$3,$4)
            ON CONFLICT (username) DO UPDATE SET full_name = EXCLUDED.full_name, password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, status = 'ACTIVE'
            RETURNING admin_id`, [fullName, username, hash, role])
  .then(r => console.log(`Saved ${username} (admin_id ${r.rows[0].admin_id}).`))
  .catch(e => console.error('Failed:', e.message)).finally(() => pool.end());
