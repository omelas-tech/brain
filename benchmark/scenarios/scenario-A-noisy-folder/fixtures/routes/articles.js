const express = require('express');
const Redis = require('ioredis');

const router = express.Router();
const redis = new Redis();
const db = require('../db');

// Aurora-CMS convention: cursor pagination + Redis cache (60s TTL on lists).
router.get('/', async (req, res, next) => {
  try {
    const { cursor, limit = 25 } = req.query;
    const cap = Math.min(Number(limit) || 25, 100);
    const cacheKey = `aurora:articles:list:${cursor || 'first'}:${cap}`;

    const cached = await redis.get(cacheKey).catch(() => null);
    if (cached) return res.json(JSON.parse(cached));

    const decoded = cursor
      ? JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8'))
      : null;

    const rows = await db.listArticles({ cursor: decoded, limit: cap + 1 });
    const hasMore = rows.length > cap;
    const data = rows.slice(0, cap);
    const last = data[data.length - 1];
    const nextCursor = hasMore && last
      ? Buffer.from(JSON.stringify({ created_at: last.created_at, id: last.id })).toString('base64')
      : null;

    const body = { data, next_cursor: nextCursor, has_more: hasMore };
    await redis.set(cacheKey, JSON.stringify(body), 'EX', 60).catch(() => {});
    res.json(body);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
