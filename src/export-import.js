/**
 * Brain Memory — Export / Import
 *
 * Single-file encrypted export/import for portable memory transfers.
 * Pack all ~/.brain/ files into one JSON blob, optionally AES-256-GCM encrypt,
 * and write a single .brain-export file. Import reverses the process.
 *
 * Zero external dependencies — uses only Node.js built-in fs and crypto.
 */

const fs = require('fs');
const path = require('path');
const { encrypt, decrypt } = require('./crypto');

// Directories inside ~/.brain/ to skip during export
const EXCLUDED = new Set(['.sync', '.DS_Store']);

/**
 * Export the entire ~/.brain/ directory to a single file.
 *
 * @param {string} brainDir - Absolute path to ~/.brain/
 * @param {string} outputPath - Destination file path
 * @param {string|null} [passphrase] - If provided, encrypt the export
 * @returns {{ fileCount: number, outputPath: string }}
 */
function exportBrain(brainDir, outputPath, passphrase) {
  if (!fs.existsSync(brainDir)) {
    throw new Error('~/.brain/ directory not found. Run /brain:init first.');
  }

  const files = {};
  collectFiles(brainDir, brainDir, files);

  const payload = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), files });

  if (passphrase) {
    const encrypted = encrypt(payload, passphrase);
    fs.writeFileSync(outputPath, encrypted);
  } else {
    fs.writeFileSync(outputPath, payload, 'utf8');
  }

  return { fileCount: Object.keys(files).length, outputPath };
}

/**
 * Recursively collect all files from brainDir into a flat { relativePath: content } map.
 *
 * @param {string} dir - Current directory to scan
 * @param {string} brainDir - Root ~/.brain/ directory
 * @param {Object} files - Accumulator object
 */
function collectFiles(dir, brainDir, files) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const rel = path.relative(brainDir, path.join(dir, entry.name));
    const topLevel = rel.split(path.sep)[0];
    if (EXCLUDED.has(topLevel)) continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(fullPath, brainDir, files);
    } else {
      // Normalize path separators to forward slash for portability
      const key = rel.split(path.sep).join('/');
      files[key] = fs.readFileSync(fullPath, 'utf8');
    }
  }
}

/**
 * Import memories from a .brain-export file into ~/.brain/.
 *
 * @param {string} inputPath - Path to the export file
 * @param {string} brainDir - Absolute path to ~/.brain/
 * @param {string|null} [passphrase] - Decryption passphrase (if the export is encrypted)
 * @param {Object} [options]
 * @param {string} [options.mode='overwrite'] - 'overwrite' replaces all files; 'merge' only imports newer files
 * @returns {{ fileCount: number, skipped: number }}
 */
function importBrain(inputPath, brainDir, passphrase, options = {}) {
  const mode = options.mode || 'overwrite';

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Export file not found: ${inputPath}`);
  }

  const raw = fs.readFileSync(inputPath);
  let payload;

  if (passphrase) {
    try {
      payload = JSON.parse(decrypt(raw, passphrase));
    } catch (err) {
      if (err.message.includes('Unsupported state') || err.message.includes('unable to authenticate') || err.message.includes('Invalid encrypted data')) {
        throw new Error('Decryption failed — wrong passphrase or corrupted file.');
      }
      throw err;
    }
  } else {
    try {
      payload = JSON.parse(raw.toString('utf8'));
    } catch {
      throw new Error('Invalid export file. If the file is encrypted, provide a passphrase.');
    }
  }

  if (!payload || !payload.files || typeof payload.files !== 'object' || Array.isArray(payload.files)) {
    throw new Error('Invalid export format: missing files object.');
  }

  fs.mkdirSync(brainDir, { recursive: true });

  let imported = 0;
  let skipped = 0;

  for (const [relPath, content] of Object.entries(payload.files)) {
    // Convert forward-slash paths to OS-native
    const nativePath = relPath.split('/').join(path.sep);
    const destPath = path.join(brainDir, nativePath);

    if (mode === 'merge' && fs.existsSync(destPath)) {
      // In merge mode, only import if the export's file is newer
      // We compare exportedAt vs local file mtime
      const localMtime = fs.statSync(destPath).mtime;
      const exportDate = new Date(payload.exportedAt);
      if (exportDate <= localMtime) {
        skipped++;
        continue;
      }
    }

    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, content, 'utf8');
    imported++;
  }

  return { fileCount: imported, skipped };
}

/**
 * Preview what an import would do without writing any files.
 *
 * @param {string} inputPath - Path to the export file
 * @param {string} brainDir - Absolute path to ~/.brain/
 * @param {string|null} [passphrase] - Decryption passphrase
 * @returns {{ totalFiles: number, newFiles: string[], existingFiles: string[], exportedAt: string }}
 */
function previewImport(inputPath, brainDir, passphrase) {
  const raw = fs.readFileSync(inputPath);
  let payload;

  if (passphrase) {
    try {
      payload = JSON.parse(decrypt(raw, passphrase));
    } catch (err) {
      if (err.message.includes('Unsupported state') || err.message.includes('unable to authenticate') || err.message.includes('Invalid encrypted data')) {
        throw new Error('Decryption failed — wrong passphrase or corrupted file.');
      }
      throw err;
    }
  } else {
    try {
      payload = JSON.parse(raw.toString('utf8'));
    } catch {
      throw new Error('Invalid export file. If the file is encrypted, provide a passphrase.');
    }
  }

  if (!payload || !payload.files || typeof payload.files !== 'object' || Array.isArray(payload.files)) {
    throw new Error('Invalid export format: missing files object.');
  }

  const files = Object.keys(payload.files);
  const newFiles = [];
  const existingFiles = [];

  for (const relPath of files) {
    const nativePath = relPath.split('/').join(path.sep);
    const destPath = path.join(brainDir, nativePath);
    if (fs.existsSync(destPath)) {
      existingFiles.push(relPath);
    } else {
      newFiles.push(relPath);
    }
  }

  return {
    totalFiles: files.length,
    newFiles,
    existingFiles,
    exportedAt: payload.exportedAt,
  };
}

module.exports = {
  exportBrain,
  importBrain,
  previewImport,
};
