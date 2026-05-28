// BUG 4: fire-and-forget promise loses errors — unhandled rejection
// crashes the process under Node's default settings.
function refreshInBackground(refresher) {
  refresher();             // returns a promise; we drop it
  return { started: true };
}

module.exports = { refreshInBackground };
