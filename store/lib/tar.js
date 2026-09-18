'use strict';

/**
 * brain-store — archive inspection
 *
 * The store treats a brain as an opaque gzip-compressed tar archive. It never
 * extracts one to disk. The only thing it needs from the contents is the number
 * of regular files, which drives the empty-push guard and the `file_count`
 * reported to clients.
 *
 * The archive is inflated as a stream and only tar headers are examined, so a
 * hostile upload cannot exhaust memory: inflated size and entry count are both
 * bounded.
 */

const zlib = require('zlib');

const BLOCK = 512;
const DEFAULT_MAX_INFLATED = 1024 * 1024 * 1024; // 1 GiB
const DEFAULT_MAX_ENTRIES = 500000;

class ArchiveError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ArchiveError';
  }
}

function isGzip(buf) {
  return buf.length >= 3 && buf[0] === 0x1f && buf[1] === 0x8b && buf[2] === 0x08;
}

/** Parse a tar numeric field: octal text, or GNU base-256 when the high bit is set. */
function parseNumber(field) {
  if (field[0] & 0x80) {
    let n = 0;
    for (let i = 1; i < field.length; i++) n = n * 256 + field[i];
    return n;
  }
  const text = field.toString('latin1').replace(/\0.*$/, '').trim();
  if (text === '') return 0;
  if (!/^[0-7]+$/.test(text)) return NaN;
  return parseInt(text, 8);
}

/** A tar header's checksum is the byte sum of the block with the checksum field read as spaces. */
function headerChecksumOk(block) {
  const stored = parseNumber(block.subarray(148, 156));
  if (!Number.isFinite(stored)) return false;
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += (i >= 148 && i < 156) ? 0x20 : block[i];
  return sum === stored;
}

function isZeroBlock(block) {
  for (let i = 0; i < BLOCK; i++) if (block[i] !== 0) return false;
  return true;
}

/**
 * Count the regular files in a gzip-compressed tar archive.
 *
 * @param {Buffer} gz
 * @param {Object} [opts]
 * @param {number} [opts.maxInflatedBytes]
 * @param {number} [opts.maxEntries]
 * @returns {Promise<{fileCount: number}>}
 */
function inspectArchive(gz, opts = {}) {
  const maxInflated = opts.maxInflatedBytes || DEFAULT_MAX_INFLATED;
  const maxEntries = opts.maxEntries || DEFAULT_MAX_ENTRIES;

  return new Promise((resolve, reject) => {
    if (!Buffer.isBuffer(gz) || !isGzip(gz)) {
      return reject(new ArchiveError('not a gzip archive'));
    }

    const gunzip = zlib.createGunzip();
    const header = Buffer.alloc(BLOCK);
    let headerFill = 0;
    let skip = 0;
    let inflated = 0;
    let entries = 0;
    let fileCount = 0;
    let sawHeader = false;
    let ended = false;
    let settled = false;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      gunzip.destroy();
      reject(err instanceof ArchiveError ? err : new ArchiveError(err.message));
    };

    gunzip.on('data', (chunk) => {
      if (settled) return;
      inflated += chunk.length;
      if (inflated > maxInflated) return fail(new ArchiveError('archive inflates beyond the allowed size'));

      let off = 0;
      while (off < chunk.length && !ended) {
        if (skip > 0) {
          const n = Math.min(skip, chunk.length - off);
          skip -= n;
          off += n;
          continue;
        }
        const n = Math.min(BLOCK - headerFill, chunk.length - off);
        chunk.copy(header, headerFill, off, off + n);
        headerFill += n;
        off += n;
        if (headerFill < BLOCK) break;
        headerFill = 0;

        if (isZeroBlock(header)) {
          // End-of-archive marker. Anything after it is padding.
          ended = true;
          break;
        }
        if (!headerChecksumOk(header)) return fail(new ArchiveError('not a tar archive'));
        sawHeader = true;

        if (++entries > maxEntries) return fail(new ArchiveError('archive has too many entries'));

        const size = parseNumber(header.subarray(124, 136));
        if (!Number.isFinite(size) || size < 0) return fail(new ArchiveError('corrupt tar header'));

        const type = header[156];
        if (type === 0x30 /* '0' */ || type === 0x00) fileCount++;

        skip = Math.ceil(size / BLOCK) * BLOCK;
      }
    });

    gunzip.on('error', (err) => fail(new ArchiveError('corrupt gzip stream: ' + err.message)));

    gunzip.on('end', () => {
      if (settled) return;
      if (!ended && (skip > 0 || headerFill > 0)) return fail(new ArchiveError('truncated tar archive'));
      if (!sawHeader && inflated > 0 && !ended) return fail(new ArchiveError('not a tar archive'));
      settled = true;
      resolve({ fileCount });
    });

    gunzip.end(gz);
  });
}

module.exports = { inspectArchive, ArchiveError, isGzip };
