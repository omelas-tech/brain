// BUG 3: an awaited promise never resolves because the resolver is
// captured inside a closure that is never invoked.
function makeLatch() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, signal: () => { /* TODO — never resolves */ } };
}

async function waitForSignal() {
  const latch = makeLatch();
  // … some logic that should call latch.signal() …
  return latch.promise;
}

module.exports = { makeLatch, waitForSignal };
