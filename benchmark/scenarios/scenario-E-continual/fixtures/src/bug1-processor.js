// BUG 1: race condition under Promise.all + shared mutation.
// Multiple async callbacks push to the same array concurrently —
// under load, items can be lost or out of order.
async function processAll(items, fn) {
  const results = [];
  await Promise.all(items.map(async (item) => {
    const out = await fn(item);
    results.push(out);
  }));
  return results;
}

module.exports = { processAll };
