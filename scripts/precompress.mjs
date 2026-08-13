#!/usr/bin/env node
// Precompresses the built assets so the server can ship them without paying
// compression cost per request. The bundle is ~5MB raw and ~1.3MB gzipped, so
// this is the difference between a usable and a painful cold load.
//
// Writes <file>.br and <file>.gz next to each compressible file; the server
// picks one based on Accept-Encoding and falls back to the original when
// neither exists (so an un-precompressed dist still works).

import { brotliCompress, constants, gzip } from "node:zlib";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { promisify } from "node:util";

const gzipAsync = promisify(gzip);
const brotliAsync = promisify(brotliCompress);

const ROOT = resolve(process.argv[2] ?? "dist");
// Compressing tiny files costs more in requests than it saves in bytes.
const MIN_BYTES = 1024;
const COMPRESSIBLE = new Set([
  ".js",
  ".mjs",
  ".css",
  ".html",
  ".json",
  ".svg",
  ".map",
  ".txt",
  ".ico",
]);

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile()) yield path;
  }
}

let files = 0;
let rawTotal = 0;
let brTotal = 0;

for await (const file of walk(ROOT)) {
  if (!COMPRESSIBLE.has(extname(file))) continue;
  if (file.endsWith(".br") || file.endsWith(".gz")) continue;
  const info = await stat(file);
  if (info.size < MIN_BYTES) continue;

  const raw = await readFile(file);
  const [br, gz] = await Promise.all([
    brotliAsync(raw, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 11,
        [constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
      },
    }),
    gzipAsync(raw, { level: 9 }),
  ]);
  // Keep only what actually pays off (already-compressed formats won't).
  if (br.length < raw.length) await writeFile(`${file}.br`, br);
  if (gz.length < raw.length) await writeFile(`${file}.gz`, gz);

  files++;
  rawTotal += raw.length;
  brTotal += Math.min(br.length, raw.length);
}

const mb = (n) => (n / 1024 / 1024).toFixed(2);
console.log(
  `precompressed ${files} files: ${mb(rawTotal)}MB → ${mb(brTotal)}MB brotli`
);
