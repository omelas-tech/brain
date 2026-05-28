// Tiny in-memory stand-in so the fixture is self-contained and the agent can
// see the shape of the DB layer without needing Postgres at benchmark time.
const articles = [
  { id: 1, title: 'Hello', body: '...', created_at: '2026-01-01T00:00:00Z' },
  { id: 2, title: 'World', body: '...', created_at: '2026-01-02T00:00:00Z' },
];
const comments = [];

module.exports = {
  listArticles: async ({ cursor, limit }) => {
    let rows = [...articles].sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (cursor) rows = rows.filter((r) => r.created_at < cursor.created_at);
    return rows.slice(0, limit);
  },
  listComments: async ({ article_id, cursor, limit }) => {
    let rows = comments.filter((c) => c.article_id === article_id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (cursor) rows = rows.filter((r) => r.created_at < cursor.created_at);
    return rows.slice(0, limit);
  },
};
