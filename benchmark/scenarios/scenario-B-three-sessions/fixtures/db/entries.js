// Reference repository the agent should imitate.
const { query } = require('./index');

async function list({ limit = 25, cursor } = {}) {
  if (cursor) {
    const res = await query(
      'SELECT * FROM entries WHERE created_at < $1 ORDER BY created_at DESC LIMIT $2',
      [cursor, limit],
    );
    return res.rows;
  }
  const res = await query('SELECT * FROM entries ORDER BY created_at DESC LIMIT $1', [limit]);
  return res.rows;
}

async function get(id) {
  const res = await query('SELECT * FROM entries WHERE id = $1', [id]);
  return res.rows[0] || null;
}

async function create({ amount, memo }) {
  const res = await query(
    'INSERT INTO entries (amount, memo) VALUES ($1, $2) RETURNING *',
    [amount, memo],
  );
  return res.rows[0];
}

module.exports = { list, get, create };
