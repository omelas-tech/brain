/**
 * Brain Memory — Cloud Sync Engine
 *
 * Push/pull ~/.brain/ memories via the Brain Cloud API (api.brainmemory.work).
 * Uses the device code OAuth flow for CLI authentication.
 *
 * Zero external dependencies — uses Node.js built-in https, fs, child_process.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');

const CLOUD_DIR = '.cloud';
const CONFIG_FILE = 'config.json';
const DEFAULT_API_URL = 'https://api.brainmemory.work';

// Files/dirs inside ~/.brain/ that should NOT be synced
const TAR_EXCLUDES = ['.sync', '.cloud', '.DS_Store', '_archived'];

// ---------------------------------------------------------------------------
// HTTP helpers (zero-dependency, works on Node >= 18)
// ---------------------------------------------------------------------------

/**
 * Make an HTTP(S) request. Returns { status, headers, body }.
 *
 * @param {string} url
 * @param {Object} [opts]
 * @param {string} [opts.method='GET']
 * @param {Object} [opts.headers]
 * @param {Buffer|string} [opts.body]
 * @returns {Promise<{status: number, headers: Object, body: string}>}
 */
function request(url, opts = {}, _redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (_redirectCount > 5) return reject(new Error('Too many redirects'));

    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const reqOpts = {
      method: opts.method || 'GET',
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      headers: opts.headers || {},
    };

    const req = mod.request(reqOpts, (res) => {
      // Follow redirects
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        const redirectUrl = new URL(res.headers.location, url).href;
        // For 307/308, preserve method and body; for 301/302, switch to GET.
        // When dropping the body we must also drop the body-describing headers,
        // or the redirected GET advertises a Content-Length it never sends and
        // the socket hangs waiting to flush a body that isn't coming.
        let newOpts;
        if ([307, 308].includes(res.statusCode)) {
          newOpts = opts;
        } else {
          const headers = { ...(opts.headers || {}) };
          for (const h of Object.keys(headers)) {
            if (/^content-(length|type)$/i.test(h)) delete headers[h];
          }
          newOpts = { ...opts, method: 'GET', body: undefined, headers };
        }
        res.resume(); // drain the response
        return resolve(request(redirectUrl, newOpts, _redirectCount + 1));
      }

      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });

    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(new Error('Request timed out')); });

    if (opts.body) req.write(opts.body);
    req.end();
  });
}

/**
 * JSON POST/PUT helper.
 */
async function jsonRequest(url, method, data, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const body = data != null ? JSON.stringify(data) : undefined;
  if (body) headers['Content-Length'] = Buffer.byteLength(body).toString();
  const res = await request(url, { method, headers, body });
  try {
    return { status: res.status, data: JSON.parse(res.body) };
  } catch {
    throw new Error(`Non-JSON response (${res.status}) from ${method} ${url}: ${res.body.slice(0, 200)}`);
  }
}

/**
 * Upload a file as multipart/form-data.
 */
async function uploadFile(url, filePath, token) {
  const boundary = '----BrainCloudUpload' + Date.now();
  const fileContent = fs.readFileSync(filePath);
  const header = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="brain"; filename="brain.tar.gz"\r\n` +
    `Content-Type: application/gzip\r\n\r\n`
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([header, fileContent, footer]);

  return request(url, {
    method: 'PUT',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': body.length.toString(),
      'Authorization': `Bearer ${token}`,
    },
    body,
  });
}

/**
 * Download a file from URL, save to disk.
 */
function downloadFile(url, destPath, token, _redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (_redirectCount > 5) return reject(new Error('Too many redirects'));

    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const reqOpts = {
      method: 'GET',
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      headers: { 'Authorization': `Bearer ${token}` },
    };

    const req = mod.request(reqOpts, (res) => {
      // Follow redirects
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        const redirectUrl = new URL(res.headers.location, url).href;
        res.resume();
        return resolve(downloadFile(redirectUrl, destPath, token, _redirectCount + 1));
      }

      if (res.statusCode !== 200) {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          reject(new Error(`Download failed (${res.statusCode}): ${Buffer.concat(chunks).toString()}`));
        });
        return;
      }

      const ws = fs.createWriteStream(destPath);
      res.pipe(ws);
      ws.on('finish', () => {
        ws.close();
        resolve({ checksum: res.headers['x-checksum'] || null });
      });
      ws.on('error', reject);
    });

    req.on('error', reject);
    req.setTimeout(300000, () => { req.destroy(new Error('Download timed out')); });
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Config management — stored at ~/.brain/.cloud/config.json
// ---------------------------------------------------------------------------

function resolvePaths(brainDir) {
  const cloudDir = path.join(brainDir, CLOUD_DIR);
  const configPath = path.join(cloudDir, CONFIG_FILE);
  return { cloudDir, configPath };
}

function readConfig(brainDir) {
  const { configPath } = resolvePaths(brainDir);
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return null;
  }
}

function writeConfig(brainDir, config) {
  const { cloudDir, configPath } = resolvePaths(brainDir);
  fs.mkdirSync(cloudDir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}

function deleteConfig(brainDir) {
  const { cloudDir } = resolvePaths(brainDir);
  fs.rmSync(cloudDir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------

/**
 * Get a valid access token, refreshing if needed.
 *
 * @param {string} brainDir
 * @returns {Promise<string>} access token
 */
async function getValidToken(brainDir) {
  const config = readConfig(brainDir);
  if (!config) throw new Error('Not logged in. Run cloud login first.');

  const now = Math.floor(Date.now() / 1000);

  // Token still valid (with 30s buffer)
  if (config.expires_at && now < config.expires_at - 30) {
    return config.access_token;
  }

  // Try refresh
  if (!config.refresh_token) {
    throw new Error('Session expired and no refresh token. Run cloud login again.');
  }

  const res = await jsonRequest(
    `${config.api_url}/auth/refresh`,
    'POST',
    { refresh_token: config.refresh_token }
  );

  if (res.status !== 200) {
    throw new Error('Token refresh failed. Run cloud login again.');
  }

  config.access_token = res.data.access_token;
  config.refresh_token = res.data.refresh_token;
  config.expires_at = res.data.expires_at;
  writeConfig(brainDir, config);

  return config.access_token;
}

// ---------------------------------------------------------------------------
// Device code auth flow
// ---------------------------------------------------------------------------

/**
 * Start the device code login flow.
 * Returns the device code info so the caller can display it to the user.
 *
 * @param {string} apiUrl
 * @returns {Promise<{device_code: string, user_code: string, verify_url: string, expires_in: number}>}
 */
async function requestDeviceCode(apiUrl) {
  const res = await jsonRequest(`${apiUrl}/auth/device/request`, 'POST', {});
  if (res.status !== 200) {
    throw new Error(`Failed to request device code: ${JSON.stringify(res.data)}`);
  }
  return res.data;
}

/**
 * Poll for device code approval.
 *
 * @param {string} apiUrl
 * @param {string} deviceCode
 * @param {number} interval - Poll interval in ms (default 5000)
 * @param {number} timeout - Max wait in ms (default 600000 = 10 min)
 * @returns {Promise<{access_token: string, refresh_token: string, expires_at: number}>}
 */
async function pollDeviceCode(apiUrl, deviceCode, interval = 5000, timeout = 600000) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const res = await jsonRequest(`${apiUrl}/auth/device/poll`, 'POST', { device_code: deviceCode });

    if (res.status === 200 && res.data.status === 'approved' && res.data.tokens) {
      return res.data.tokens;
    }

    if (res.status === 404 || (res.data && res.data.error && res.data.error.includes('expired'))) {
      throw new Error('Device code expired. Try again.');
    }

    // Still pending — wait and retry
    await new Promise((r) => setTimeout(r, interval));
  }

  throw new Error('Login timed out. Try again.');
}

/**
 * Full login flow: request code, poll, save config.
 *
 * @param {string} brainDir
 * @param {string} [apiUrl]
 * @returns {Promise<{user_code: string, verify_url: string, waitForApproval: () => Promise<void>}>}
 */
async function login(brainDir, apiUrl) {
  const url = apiUrl || DEFAULT_API_URL;
  const codeInfo = await requestDeviceCode(url);

  return {
    user_code: codeInfo.user_code,
    verify_url: codeInfo.verify_url,
    expires_in: codeInfo.expires_in,
    waitForApproval: async () => {
      const tokens = await pollDeviceCode(url, codeInfo.device_code);

      // Fetch user info + default brain
      const meRes = await jsonRequest(`${url}/auth/me`, 'GET', null, tokens.access_token);
      let userEmail = '';
      if (meRes.status === 200 && meRes.data.user) {
        userEmail = meRes.data.user.email;
      }

      const brainsRes = await jsonRequest(`${url}/api/brains`, 'GET', null, tokens.access_token);
      let brainId = null;
      if (brainsRes.status === 200 && Array.isArray(brainsRes.data) && brainsRes.data.length > 0) {
        brainId = brainsRes.data[0].id;
      }

      writeConfig(brainDir, {
        api_url: url,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: tokens.expires_at,
        brain_id: brainId,
        user_email: userEmail,
        connected_at: new Date().toISOString(),
      });
    },
  };
}

/**
 * Logout — clear stored tokens.
 *
 * @param {string} brainDir
 */
function logout(brainDir) {
  deleteConfig(brainDir);
}

// ---------------------------------------------------------------------------
// Tar helpers
// ---------------------------------------------------------------------------

function packBrain(brainDir) {
  const tmpFile = path.join(os.tmpdir(), `brain-upload-${Date.now()}.tar.gz`);
  const excludeArgs = TAR_EXCLUDES.flatMap((e) => ['--exclude', e]);

  execFileSync('tar', ['czf', tmpFile, ...excludeArgs, '-C', brainDir, '.'], {
    stdio: 'pipe',
    timeout: 120000,
  });

  return tmpFile;
}

function unpackBrain(tarPath, brainDir) {
  // Extract into brain dir, overwriting existing files
  execFileSync('tar', ['xzf', tarPath, '-C', brainDir], {
    stdio: 'pipe',
    timeout: 120000,
  });
}

// ---------------------------------------------------------------------------
// Push / Pull
// ---------------------------------------------------------------------------

/**
 * Push ~/.brain/ to the cloud.
 *
 * @param {string} brainDir
 * @returns {Promise<{size_bytes: number, file_count: number, checksum: string}>}
 */
async function push(brainDir) {
  const config = readConfig(brainDir);
  if (!config) throw new Error('Not logged in. Run cloud login first.');
  if (!config.brain_id) throw new Error('No brain linked. Run cloud login again.');

  const token = await getValidToken(brainDir);

  // Pack ~/.brain/ into tar.gz
  const tarPath = packBrain(brainDir);

  try {
    const tarSize = fs.statSync(tarPath).size;
    const url = `${config.api_url}/api/brains/${config.brain_id}/sync`;

    const res = await uploadFile(url, tarPath, token);

    if (res.status !== 200) {
      const data = JSON.parse(res.body);
      throw new Error(`Push failed (${res.status}): ${data.error || res.body}`);
    }

    const result = JSON.parse(res.body);

    // Update config with last push time
    config.last_push = new Date().toISOString();
    writeConfig(brainDir, config);

    return { ...result, local_size: tarSize };
  } finally {
    // Clean up temp file
    try { fs.unlinkSync(tarPath); } catch { /* ignore */ }
  }
}

/**
 * Pull from the cloud into ~/.brain/.
 *
 * @param {string} brainDir
 * @returns {Promise<{size_bytes: number, checksum: string|null}>}
 */
async function pull(brainDir) {
  const config = readConfig(brainDir);
  if (!config) throw new Error('Not logged in. Run cloud login first.');
  if (!config.brain_id) throw new Error('No brain linked. Run cloud login again.');

  const token = await getValidToken(brainDir);
  const url = `${config.api_url}/api/brains/${config.brain_id}/sync`;
  const tmpFile = path.join(os.tmpdir(), `brain-download-${Date.now()}.tar.gz`);

  try {
    const { checksum } = await downloadFile(url, tmpFile, token);
    const size = fs.statSync(tmpFile).size;

    // Extract into ~/.brain/
    unpackBrain(tmpFile, brainDir);

    // Update config
    config.last_pull = new Date().toISOString();
    writeConfig(brainDir, config);

    return { size_bytes: size, checksum };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * Get cloud sync status.
 *
 * @param {string} brainDir
 * @returns {Promise<Object>}
 */
async function status(brainDir) {
  const config = readConfig(brainDir);
  if (!config) {
    return { connected: false };
  }

  let brain = null;
  let user = null;

  try {
    const token = await getValidToken(brainDir);

    const meRes = await jsonRequest(`${config.api_url}/auth/me`, 'GET', null, token);
    if (meRes.status === 200) {
      user = meRes.data.user;
    }

    if (config.brain_id) {
      const brainRes = await jsonRequest(
        `${config.api_url}/api/brains/${config.brain_id}`,
        'GET', null, token
      );
      if (brainRes.status === 200) {
        brain = brainRes.data;
      }
    }
  } catch {
    // Token may be expired — still report config
  }

  return {
    connected: true,
    api_url: config.api_url,
    user_email: config.user_email || (user && user.email) || null,
    brain_id: config.brain_id,
    brain_name: brain ? brain.name : null,
    brain_size: brain ? brain.size_bytes : null,
    brain_files: brain ? brain.file_count : null,
    last_synced: brain && brain.last_synced_at ? brain.last_synced_at : null,
    last_push: config.last_push || null,
    last_pull: config.last_pull || null,
    connected_at: config.connected_at || null,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  login,
  logout,
  push,
  pull,
  status,
  readConfig,
  writeConfig,
  // Internal — exported for testing
  requestDeviceCode,
  pollDeviceCode,
  getValidToken,
  packBrain,
  unpackBrain,
  resolvePaths,
  DEFAULT_API_URL,
};
