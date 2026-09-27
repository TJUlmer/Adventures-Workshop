#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..');
const DEFAULT_MANIFEST = 'tools/baselines/mobile-ui-phase0/evidence-manifest.json';
const DEFAULT_ROOTS = [
  'MOBILE_UI_PROJECT.md',
  'MOBILE_UI_PHASE_0.md',
  'docs/mobile-ui-phase0-baseline.md',
  'tools/mobile-ui-baseline.json',
  'src/lib/components/layout/AppShell.svelte',
  'src/lib/components/layout/EditorPanes.svelte',
  'src/lib/components/layout/TitleBar.svelte',
  'src/lib/interaction/pointer-session.ts',
  'src/main.ts',
  'vite.config.ts',
  'tools/mobile-interaction-contract.css',
  'tools/mobile-interaction-contract.html',
  'tools/mobile-interaction-contract.ts',
  'tools/mobile-ui-baseline-capture.css',
  'tools/mobile-ui-baseline-capture.ts',
  'tools/mobile-baseline',
  'tools/baselines/mobile-ui-phase0',
  'exports/mobile-ui-baseline',
  'exports/mobile-ui-baseline-tts'
];

function usage() {
  console.log(`Usage:
  node tools/mobile-baseline/evidence.mjs capture [--manifest PATH] [--root PATH ...]
  node tools/mobile-baseline/evidence.mjs verify  [--manifest PATH] [--geometry-only]

The tool uses Node built-ins only. ZIP containers are compared by their stored
entries because the app intentionally stamps each archive with the current time.`);
}

function parseArgs(argv) {
  const command = argv.shift();
  const options = { command, manifest: DEFAULT_MANIFEST, roots: [], geometryOnly: false };
  while (argv.length > 0) {
    const argument = argv.shift();
    if (argument === '--manifest') {
      const value = argv.shift();
      if (!value) throw new Error('--manifest requires a path.');
      options.manifest = value;
    } else if (argument === '--root') {
      const value = argv.shift();
      if (!value) throw new Error('--root requires a path.');
      options.roots.push(value);
    } else if (argument === '--geometry-only') {
      options.geometryOnly = true;
    } else if (argument === '--help' || argument === '-h') {
      options.command = 'help';
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

function repoPath(value) {
  return isAbsolute(value) ? resolve(value) : resolve(REPO_ROOT, value);
}

function displayPath(value) {
  return relative(REPO_ROOT, value).split(sep).join('/');
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizeString(value) {
  return value
    .replace(
      /file:\/\/\/[^"]*?\/mobile-ui-[a-z0-9-]+-tts\//gi,
      'file:///<BASELINE>/mobile-ui-baseline-tts/'
    )
    .replace(
      /[A-Za-z]:\\[^\r\n]*?\\mobile-ui-[a-z0-9-]+-tts\\/gi,
      '<BASELINE>\\mobile-ui-baseline-tts\\'
    );
}

/* Phase 9 briefly captured a manifest while profile names normalized to a
   generic marker. Keep that spelling as a compatibility digest only; the
   durable spelling above is the one Phase 0 already committed. */
function normalizeStringWithGenericTtsMarker(value) {
  return value
    .replace(/file:\/\/\/[^"]*?\/mobile-ui-[a-z0-9-]+-tts\//gi, 'file:///<BASELINE>/<TTS>/')
    .replace(/[A-Za-z]:\\[^\r\n]*?\\mobile-ui-[a-z0-9-]+-tts\\/gi, '<BASELINE>\\<TTS>\\');
}

const NORMALIZED_TTS_REFERENCE =
  /((?:file:\/\/\/<BASELINE>\/mobile-ui-baseline-tts\/|<BASELINE>\\mobile-ui-baseline-tts\\)[^\r\n"']*?)-[0-9a-f]{8}(?=\.(?:jpe?g|png|webp)\b)/gi;

/** Geometry ignores only the content hash in a normalized TTS image URL. */
function geometryNormalizeString(value) {
  return normalizeString(value).replace(NORMALIZED_TTS_REFERENCE, '$1-<CONTENT_HASH>');
}

function normalizeJson(value, key = '', normalizeText = normalizeString) {
  if (key === 'exportedAt' || key === 'Date') return '<VOLATILE_TIMESTAMP>';
  if (typeof value === 'string') return normalizeText(value);
  if (Array.isArray(value)) return value.map((entry) => normalizeJson(entry, '', normalizeText));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [
        childKey,
        normalizeJson(child, childKey, normalizeText)
      ])
    );
  }
  return value;
}

function normalizedDigest(bytes, extension, normalizeText = normalizeString) {
  if (extension === '.json') {
    try {
      const value = JSON.parse(bytes.toString('utf8'));
      return sha256(Buffer.from(canonicalJson(normalizeJson(value, '', normalizeText))));
    } catch {
      return null;
    }
  }
  if (extension === '.txt') {
    return sha256(Buffer.from(normalizeText(bytes.toString('utf8')).replace(/\r\n/g, '\n')));
  }
  return null;
}

function escapeRegExp(value) {
  return value.replace(/[|\\{}()[\]^$+*?.-]/g, '\\$&');
}

/**
 * Re-spell only TTS image paths which the geometry path index paired.
 *
 * Old manifests have no geometry-normalized digest. Replacing the current
 * content-hash name with that manifest's name lets their original normalized
 * digest remain a real structural comparison instead of silently skipping
 * JSON/text whenever one of those generated names changes.
 */
function remapTtsImageReferences(value, aliases) {
  let result = value;
  for (const [actual, expected] of aliases) {
    result = result.replace(new RegExp(escapeRegExp(actual), 'g'), expected);
    const actualWindows = actual.replaceAll('/', '\\');
    const expectedWindows = expected.replaceAll('/', '\\');
    result = result.replace(new RegExp(escapeRegExp(actualWindows), 'g'), expectedWindows);
  }
  return result;
}

function compatibilityNormalizedDigests(bytes, extension, aliases) {
  const normalizers = [normalizeString, normalizeStringWithGenericTtsMarker];
  return new Set(
    normalizers
      .map((normalizeText) => normalizedDigest(
        bytes,
        extension,
        (value) => normalizeText(remapTtsImageReferences(value, aliases))
      ))
      .filter((digest) => digest !== null)
  );
}

const COMPATIBILITY_NORMALIZED_DIGESTS = Symbol('compatibilityNormalizedDigests');

function pngDimensions(bytes) {
  if (bytes.length < 24 || bytes.toString('hex', 0, 8) !== '89504e470d0a1a0a') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function paeth(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

/** Hash decoded 8-bit, non-interlaced PNG samples rather than encoder bytes. */
function pngPixelDigest(bytes) {
  const dimensions = pngDimensions(bytes);
  if (!dimensions) return null;

  let bitDepth = 0;
  let colourType = -1;
  let interlace = -1;
  const dataChunks = [];
  for (let offset = 8; offset + 12 <= bytes.length; ) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > bytes.length) return null;
    if (type === 'IHDR') {
      bitDepth = bytes[start + 8];
      colourType = bytes[start + 9];
      interlace = bytes[start + 12];
    } else if (type === 'IDAT') dataChunks.push(bytes.subarray(start, end));
    else if (type === 'IEND') break;
    offset = end + 4;
  }

  const channels = new Map([
    [0, 1],
    [2, 3],
    [4, 2],
    [6, 4]
  ]).get(colourType);
  if (bitDepth !== 8 || interlace !== 0 || channels === undefined || dataChunks.length === 0) {
    return null;
  }

  const stride = dimensions.width * channels;
  const inflated = inflateSync(Buffer.concat(dataChunks));
  if (inflated.length !== (stride + 1) * dimensions.height) return null;

  const pixels = Buffer.allocUnsafe(stride * dimensions.height);
  let previous = Buffer.alloc(stride);
  let sourceOffset = 0;
  for (let row = 0; row < dimensions.height; row += 1) {
    const filter = inflated[sourceOffset];
    sourceOffset += 1;
    if (filter === undefined || filter > 4) return null;
    const reconstructed = Buffer.allocUnsafe(stride);
    for (let column = 0; column < stride; column += 1) {
      const encoded = inflated[sourceOffset + column];
      const left = column >= channels ? reconstructed[column - channels] : 0;
      const above = previous[column] ?? 0;
      const upperLeft = column >= channels ? (previous[column - channels] ?? 0) : 0;
      let predictor = 0;
      if (filter === 1) predictor = left ?? 0;
      else if (filter === 2) predictor = above;
      else if (filter === 3) predictor = Math.floor(((left ?? 0) + above) / 2);
      else if (filter === 4) predictor = paeth(left ?? 0, above, upperLeft);
      reconstructed[column] = ((encoded ?? 0) + predictor) & 0xff;
    }
    reconstructed.copy(pixels, row * stride);
    previous = reconstructed;
    sourceOffset += stride;
  }
  return sha256(pixels);
}

function jpegDimensions(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2) break;
    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isStartOfFrame) {
      return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
    }
    offset += length + 2;
  }
  return null;
}

function webpDimensions(bytes) {
  if (bytes.length < 30 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') {
    return null;
  }
  const kind = bytes.toString('ascii', 12, 16);
  if (kind === 'VP8X') {
    return {
      width: 1 + bytes.readUIntLE(24, 3),
      height: 1 + bytes.readUIntLE(27, 3)
    };
  }
  if (kind === 'VP8L' && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
  }
  if (kind === 'VP8 ' && bytes.length >= 30) {
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  return null;
}

function imageDimensions(bytes, extension) {
  if (extension === '.png') return pngDimensions(bytes);
  if (extension === '.jpg' || extension === '.jpeg') return jpegDimensions(bytes);
  if (extension === '.webp') return webpDimensions(bytes);
  return null;
}

function inspectBytes(bytes, name, options = {}) {
  const extension = extname(name).toLowerCase();
  const result = { bytes: bytes.length, sha256: sha256(bytes) };
  const dimensions = imageDimensions(bytes, extension);
  if (dimensions) result.dimensions = dimensions;
  if (extension === '.png') {
    const pixelSha256 = pngPixelDigest(bytes);
    if (pixelSha256) result.pixelSha256 = pixelSha256;
  }
  const normalizedSha256 = normalizedDigest(bytes, extension);
  if (normalizedSha256) result.normalizedSha256 = normalizedSha256;
  const geometryNormalizedSha256 = normalizedDigest(bytes, extension, geometryNormalizeString);
  if (geometryNormalizedSha256) result.geometryNormalizedSha256 = geometryNormalizedSha256;

  /* Used only while verifying manifests captured before the geometry digest
     existed. A symbol carries the candidates through object spreads while
     JSON serialization omits them from a new captured manifest. */
  if (normalizedSha256) {
    result[COMPATIBILITY_NORMALIZED_DIGESTS] = compatibilityNormalizedDigests(
      bytes,
      extension,
      options.compatibilityAliases ?? []
    );
  }
  return result;
}

/** The app's ZIP writer stores entries without compression or data descriptors. */
function inspectStoredZip(bytes, options = {}) {
  const entries = [];
  let offset = 0;
  while (offset + 4 <= bytes.length) {
    const signature = bytes.readUInt32LE(offset);
    if (signature !== 0x04034b50) break;
    if (offset + 30 > bytes.length) throw new Error('Truncated ZIP local header.');
    const flags = bytes.readUInt16LE(offset + 6);
    const method = bytes.readUInt16LE(offset + 8);
    const compressedSize = bytes.readUInt32LE(offset + 18);
    const fileNameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    if ((flags & 0x08) !== 0) throw new Error('ZIP data descriptors are not supported.');
    if (method !== 0) throw new Error(`ZIP entry uses compression method ${method}; expected stored.`);
    const nameStart = offset + 30;
    const dataStart = nameStart + fileNameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > bytes.length) throw new Error('Truncated ZIP entry.');
    const name = bytes.toString('utf8', nameStart, nameStart + fileNameLength);
    const data = bytes.subarray(dataStart, dataEnd);
    entries.push({ path: name, ...inspectBytes(data, name, options) });
    offset = dataEnd;
  }
  return entries;
}

async function walk(target) {
  const info = await stat(target);
  if (info.isFile()) return [target];
  const names = await readdir(target);
  const children = await Promise.all(names.sort().map((name) => walk(join(target, name))));
  return children.flat();
}

async function inspectFile(file, options = {}) {
  const bytes = await readFile(file);
  const result = { path: displayPath(file), ...inspectBytes(bytes, file, options) };
  if (extname(file).toLowerCase() === '.zip') {
    result.comparison = 'stored-entries';
    result.containerNote = 'Raw ZIP hash includes per-run DOS timestamps and is informational.';
    result.entries = inspectStoredZip(bytes, options);
  } else if (result.normalizedSha256) {
    result.comparison = 'normalized-sha256';
  } else if (result.dimensions) {
    result.comparison = result.pixelSha256 ? 'dimensions-and-pixels' : 'dimensions-and-sha256';
  } else {
    result.comparison = 'sha256';
  }
  return result;
}

async function existingRoots(values) {
  const roots = [];
  for (const value of values) {
    const absolute = repoPath(value);
    try {
      await stat(absolute);
      roots.push(absolute);
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        throw new Error(`Missing baseline root: ${displayPath(absolute)}`);
      }
      throw error;
    }
  }
  return roots;
}

async function capture(options) {
  const manifestPath = repoPath(options.manifest);
  const roots = await existingRoots(options.roots.length > 0 ? options.roots : DEFAULT_ROOTS);
  if (roots.length === 0) throw new Error('None of the requested baseline roots exists.');
  const allFiles = (await Promise.all(roots.map(walk)))
    .flat()
    .filter((file) => resolve(file) !== manifestPath)
    .sort();
  const files = [];
  for (const file of allFiles) files.push(await inspectFile(file));
  const manifest = {
    format: 'unmatched-labs-mobile-ui-baseline-evidence',
    version: 1,
    generatedAt: new Date().toISOString(),
    platform: `${process.platform}-${process.arch}`,
    node: process.version,
    roots: roots.map(displayPath),
    files
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Captured ${files.length} files in ${displayPath(manifestPath)}.`);
}

const CONTENT_HASHED_IMAGE_PATH_SUFFIX =
  /-[0-9a-f]{8}(?=\.(?:jpe?g|png|webp)$)/i;

function slashPath(value) {
  return value.replaceAll('\\', '/');
}

function isTtsPath(value) {
  return /(?:^|\/)exports\/[^/]+-tts(?:\/|$)/i.test(slashPath(value));
}

function isTtsZip(value) {
  return /(?:^|\/)exports\/[^/]+-tts\.zip$/i.test(slashPath(value));
}

function canonicalEvidencePath(value, ttsContainer = false) {
  const normalized = slashPath(value);
  if (!ttsContainer && !isTtsPath(normalized)) return normalized;
  return normalized.replace(CONTENT_HASHED_IMAGE_PATH_SUFFIX, '-<CONTENT_HASH>');
}

function ttsRelativePath(value, ttsContainer = false) {
  const normalized = slashPath(value);
  if (ttsContainer) return normalized;
  const match = normalized.match(/(?:^|\/)exports\/[^/]+-tts\/(.+)$/i);
  return match?.[1] ?? null;
}

function indexPaths(entries, pathFor, geometryOnly, ttsContainer, label, errors) {
  const index = new Map();
  for (const entry of entries) {
    const path = pathFor(entry);
    const key = geometryOnly ? canonicalEvidencePath(path, ttsContainer) : path;
    const previous = index.get(key);
    if (previous) {
      errors.push(
        label + ': canonical path collision between ' + pathFor(previous) + ' and ' + path + '.'
      );
      continue;
    }
    index.set(key, entry);
  }
  return index;
}

/**
 * Pair current and captured TTS image names through their canonical path.
 * These aliases are only for old normalized digests; new manifests carry a
 * geometry-normalized digest and do not need to reconstruct the old spelling.
 */
function compatibilityAliases(expectedIndex, actualIndex, ttsContainer = false) {
  const aliases = [];
  for (const [key, expected] of expectedIndex) {
    const actual = actualIndex.get(key);
    if (!actual) continue;
    const expectedPath = ttsRelativePath(expected.path, ttsContainer);
    const actualPath = ttsRelativePath(actual.path, ttsContainer);
    if (
      expectedPath &&
      actualPath &&
      expectedPath !== actualPath &&
      CONTENT_HASHED_IMAGE_PATH_SUFFIX.test(expectedPath) &&
      CONTENT_HASHED_IMAGE_PATH_SUFFIX.test(actualPath)
    ) {
      aliases.push([actualPath, expectedPath]);
    }
  }
  return aliases;
}

function compareEntry(expected, actual, geometryOnly, label, errors) {
  const comparesDecodedPixels = Boolean(expected.pixelSha256 && actual.pixelSha256);
  if (expected.bytes !== actual.bytes && !geometryOnly && !comparesDecodedPixels) {
    errors.push(`${label}: encoded byte count changed.`);
  }
  if (expected.dimensions) {
    if (
      !actual.dimensions ||
      expected.dimensions.width !== actual.dimensions.width ||
      expected.dimensions.height !== actual.dimensions.height
    ) {
      errors.push(`${label}: dimensions changed.`);
    }
    if (!geometryOnly) {
      if (comparesDecodedPixels && expected.pixelSha256 !== actual.pixelSha256) {
        errors.push(`${label}: decoded pixels changed.`);
      } else if (!comparesDecodedPixels && expected.sha256 !== actual.sha256) {
        errors.push(`${label}: encoded image changed.`);
      }
    }
  } else if (expected.normalizedSha256 || expected.geometryNormalizedSha256) {
    if (geometryOnly && expected.geometryNormalizedSha256) {
      if (expected.geometryNormalizedSha256 !== actual.geometryNormalizedSha256) {
        errors.push(`${label}: geometry-normalized content changed.`);
      }
    } else if (
      geometryOnly &&
      !expected.geometryNormalizedSha256 &&
      expected.normalizedSha256 !== actual.normalizedSha256 &&
      !actual[COMPATIBILITY_NORMALIZED_DIGESTS]?.has(expected.normalizedSha256)
    ) {
      errors.push(`${label}: normalized content changed (legacy manifest).`);
    } else if (!geometryOnly && expected.normalizedSha256 !== actual.normalizedSha256) {
      errors.push(`${label}: normalized content changed.`);
    }
  } else if (!geometryOnly && expected.sha256 !== actual.sha256) {
    errors.push(`${label}: content changed.`);
  }
}

async function verify(options) {
  const manifestPath = repoPath(options.manifest);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const errors = [];
  const roots = await existingRoots(manifest.roots);
  const currentFiles = (await Promise.all(roots.map(walk)))
    .flat()
    .filter((file) => resolve(file) !== manifestPath);
  const expectedFiles = indexPaths(
    manifest.files,
    (file) => file.path,
    options.geometryOnly,
    false,
    'manifest',
    errors
  );
  const actualFiles = indexPaths(
    currentFiles.map((absolute) => ({ path: displayPath(absolute), absolute })),
    (file) => file.path,
    options.geometryOnly,
    false,
    'current output',
    errors
  );
  const aliases = options.geometryOnly
    ? compatibilityAliases(expectedFiles, actualFiles)
    : [];

  for (const [key, file] of actualFiles) {
    if (!expectedFiles.has(key)) errors.push(`${file.path}: unexpected.`);
  }

  for (const [key, expected] of expectedFiles) {
    const current = actualFiles.get(key);
    if (!current) {
      errors.push(`${expected.path}: missing.`);
      continue;
    }

    const absolute = current.absolute;
    let actual;
    try {
      actual = await inspectFile(absolute, { compatibilityAliases: aliases });
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        errors.push(`${expected.path}: missing.`);
        continue;
      }
      throw error;
    }
    if (expected.comparison === 'stored-entries') {
      const ttsContainer = options.geometryOnly &&
        (isTtsPath(expected.path) || isTtsZip(expected.path));
      const expectedEntries = indexPaths(
        expected.entries,
        (entry) => entry.path,
        options.geometryOnly,
        ttsContainer,
        `${expected.path} manifest ZIP`,
        errors
      );
      let actualEntries = indexPaths(
        actual.entries,
        (entry) => entry.path,
        options.geometryOnly,
        ttsContainer,
        `${expected.path} current ZIP`,
        errors
      );
      const entryAliases = options.geometryOnly
        ? compatibilityAliases(expectedEntries, actualEntries, ttsContainer)
        : [];

      if (entryAliases.length > 0) {
        actual = await inspectFile(absolute, {
          compatibilityAliases: [...aliases, ...entryAliases]
        });
        actualEntries = new Map(
          actual.entries.map((entry) => [
            canonicalEvidencePath(entry.path, ttsContainer),
            entry
          ])
        );
      }

      for (const [entryKey, entry] of expectedEntries) {
        const found = actualEntries.get(entryKey);
        if (!found) errors.push(`${expected.path}!${entry.path}: missing.`);
        else {
          compareEntry(
            entry,
            found,
            options.geometryOnly,
            `${expected.path}!${entry.path}`,
            errors
          );
        }
      }
      for (const [entryKey, entry] of actualEntries) {
        if (!expectedEntries.has(entryKey)) {
          errors.push(`${expected.path}!${entry.path}: unexpected entry.`);
        }
      }
    } else {
      compareEntry(expected, actual, options.geometryOnly, expected.path, errors);
    }
  }
  if (errors.length > 0) {
    console.error(`Baseline verification failed (${errors.length}):`);
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Verified ${manifest.files.length} baseline files${options.geometryOnly ? ' (geometry-only)' : ''}.`);
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === 'capture') await capture(options);
  else if (options.command === 'verify') await verify(options);
  else {
    usage();
    if (options.command !== 'help') process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
