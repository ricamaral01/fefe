const { Pool, types } = require('pg');
const fs = require('fs');
const path = require('path');

// DATE e TIME chegam como texto ("2026-11-23", "08:30:00") para evitar conversão de fuso.
types.setTypeParser(1082, (v) => v);
types.setTypeParser(1083, (v) => v);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://clinica:clinica@localhost:5432/clinica',
  // current_date / now() no fuso da clínica
  options: `-c timezone=${process.env.TZ_CLINICA || 'America/Sao_Paulo'}`,
});

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
}

const q = (text, params) => pool.query(text, params);
const one = async (text, params) => (await pool.query(text, params)).rows[0] || null;
const all = async (text, params) => (await pool.query(text, params)).rows;

async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await fn(client);
    await client.query('COMMIT');
    return r;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { pool, migrate, q, one, all, tx };
