// Writes the updater manifest (latest.json) for the signed NSIS installer of the current version.
// Usage: node scripts/release-manifest.mjs [notes]   (after a signed `npm run tauri build`)
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const conf = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
const version = conf.version;
const file = `${conf.productName}_${version}_x64-setup.exe`;
const bundle = path.join(root, 'src-tauri/target/release/bundle');
const sigPath = path.join(bundle, 'nsis', `${file}.sig`);
if (!fs.existsSync(sigPath)) {
  console.error(`Missing ${sigPath} – build with TAURI_SIGNING_PRIVATE_KEY set first.`);
  process.exit(1);
}
// GitHub replaces spaces in asset names with dots
const asset = file.replace(/ /g, '.');
const manifest = {
  version,
  notes: process.argv[2] ?? `FarmForever ${version}`,
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature: fs.readFileSync(sigPath, 'utf8').trim(),
      url: `https://github.com/EnopacFTW/azeroth-farm-atlas/releases/download/v${version}/${asset}`,
    },
  },
};
const out = path.join(bundle, 'latest.json');
fs.writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`${out}\n  version ${version}\n  url ${manifest.platforms['windows-x86_64'].url}`);
