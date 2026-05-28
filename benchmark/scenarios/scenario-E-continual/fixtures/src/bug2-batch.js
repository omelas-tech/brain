// BUG 2: similar shared-state race in batched processing.
// `counter` is incremented from each concurrent callback without atomicity,
// and the returned counts can be wrong.
async function processInBatches(items, batchSize, fn) {
  let counter = 0;
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await Promise.all(batch.map(async (item) => {
      const out = await fn(item);
      counter += 1;
      results.push(out);
    }));
  }
  return { results, processed: counter };
}

module.exports = { processInBatches };
