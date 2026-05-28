const { Pool } = require('pg');
const pool = new Pool({ max: 10 });

async function query(text, params) {
  const client = await pool.connect();
  try { return await client.query(text, params); }
  finally { client.release(); }
}

module.exports = { pool, query };
