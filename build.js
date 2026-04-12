#!/usr/bin/env node
/**
 * build.js — Blurry Site extension packager
 *
 * Produces dist/blurrysite.zip ready for Chrome Web Store / Firefox Add-ons.
 * No compile step needed — this is vanilla JS. This script only zips the files.
 *
 * Usage: node build.js
 * Output: dist/blurrysite-<version>.zip
 */

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT    = __dirname;
const DIST    = path.join(ROOT, 'dist');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const VERSION  = MANIFEST.version;
const OUT_FILE = path.join(DIST, `blurrysite-${VERSION}.zip`);

// Files and directories to include in the extension zip
const INCLUDE = [
  'manifest.json',
  'background.js',
  'src/',
  'popup/',
  'styles/',
  'icons/',
  '_locales/',
];

if (!fs.existsSync(DIST)) {
  fs.mkdirSync(DIST);
}

// Remove previous zip for this version if it exists
if (fs.existsSync(OUT_FILE)) {
  fs.unlinkSync(OUT_FILE);
}

const args = INCLUDE.map(f => `"${f}"`).join(' ');
execSync(`zip -r "${OUT_FILE}" ${args}`, { cwd: ROOT, stdio: 'inherit' });

const stat = fs.statSync(OUT_FILE);
const kb = (stat.size / 1024).toFixed(1);
console.log(`\nBuilt: dist/blurrysite-${VERSION}.zip (${kb} KB)`);
