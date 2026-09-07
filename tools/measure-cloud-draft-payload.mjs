#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

const DATA_URL = /^data:([^;,]*)(;base64)?,/i;

const EXTENSIONS = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'model/obj': 'obj',
  'text/plain': 'txt',
  'application/json': 'json'
};

function decode(dataUrl) {
  const match = DATA_URL.exec(dataUrl);
  if (!match) throw new Error('Not a data URL.');

  const contentType = (match[1] ?? '').trim() || 'application/octet-stream';
  const payload = dataUrl.slice(match[0].length);
  const bytes = match[2]
    ? Buffer.from(payload, 'base64')
    : Buffer.from(decodeURIComponent(payload), 'utf8');
  return { bytes, contentType };
}

function collectDataUrls(value, found = new Set()) {
  if (typeof value === 'string') {
    if (DATA_URL.test(value)) found.add(value);
    return found;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectDataUrls(item, found);
    return found;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectDataUrls(item, found);
  }
  return found;
}

function substitute(value, mapping) {
  if (typeof value === 'string') return mapping.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => substitute(item, mapping));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, substitute(item, mapping)])
    );
  }
  return value;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

async function measure(path) {
  const raw = await readFile(path, 'utf8');
  const document = JSON.parse(raw);
  const urls = collectDataUrls(document);
  const mapping = new Map();
  let assetBytes = 0;
  let largestAssetBytes = 0;

  for (const dataUrl of urls) {
    const { bytes, contentType } = decode(dataUrl);
    const hash = createHash('sha256').update(bytes).digest('hex');
    const extension = EXTENSIONS[contentType.toLowerCase()] ?? 'bin';
    mapping.set(dataUrl, `draft-asset:${hash}.${extension}`);
    assetBytes += bytes.length;
    largestAssetBytes = Math.max(largestAssetBytes, bytes.length);
  }

  const remote = JSON.stringify(substitute(document, mapping), null, 2);
  const fileBytes = Buffer.byteLength(raw);
  const remoteBytes = Buffer.byteLength(remote);

  return {
    file: basename(path),
    fileBytes,
    fileSize: formatBytes(fileBytes),
    uniqueAssets: urls.size,
    assetBytes,
    assetSize: formatBytes(assetBytes),
    largestAssetBytes,
    largestAssetSize: formatBytes(largestAssetBytes),
    remoteBytes,
    remoteSize: formatBytes(remoteBytes)
  };
}

const paths = process.argv.slice(2);
if (paths.length === 0) {
  console.error('Usage: node tools/measure-cloud-draft-payload.mjs <set.json> [set.json ...]');
  process.exitCode = 1;
} else {
  const results = [];
  for (const path of paths) results.push(await measure(path));
  console.table(results);
}
