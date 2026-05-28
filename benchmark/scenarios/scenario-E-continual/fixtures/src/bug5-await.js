// BUG 5: forgotten `await` — function returns a Promise<Result> instead
// of Result; downstream code sees `[object Promise]`.
function loadConfig(reader) {
  const raw = reader.read('config.json');   // returns a Promise, but not awaited
  return JSON.parse(raw);
}

module.exports = { loadConfig };
