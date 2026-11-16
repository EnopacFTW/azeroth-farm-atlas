// Fetches the pinned raw data sources into data-raw/ (gitignored). Lua and SQL are only ever PARSED, never executed.
// Usage: npm run data:fetch && npm run data:build
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const RAW = path.join(ROOT, 'data-raw');

// Pinned versions used for the shipped seed (2026-11-15). Update deliberately and re-run data:build.
const QUESTIE = { repo: 'https://github.com/Questie/QuestieDB.git', commit: '4dbb82440a27856f8dccf57094a5d792cdc7cc9b' };
const CMANGOS = {
  url: 'https://github.com/cmangos/classic-db/raw/master/Full_DB/ClassicDB_1_12_1_z2815.sql.gz',
  file: 'ClassicDB.sql.gz',
};

function run(cmd, args, cwd) {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { cwd, stdio: 'inherit' });
}

fs.mkdirSync(RAW, { recursive: true });

// QuestieDB (GPL-3.0): sparse checkout of the Forever flavor only
const q = path.join(RAW, 'questiedb');
if (!fs.existsSync(path.join(q, '.git'))) {
  run('git', ['clone', '--filter=blob:none', '--no-checkout', '--sparse', QUESTIE.repo, 'questiedb'], RAW);
}
run('git', ['sparse-checkout', 'set', 'data/Forever', 'l10n/Forever', 'docs', 'src/corrections/Forever'], q);
run('git', ['fetch', '--depth', '1', 'origin', QUESTIE.commit], q);
run('git', ['checkout', '--detach', QUESTIE.commit], q);

// cmangos classic-db (GPL-3.0): full dump, gunzipped
const c = path.join(RAW, 'cmangos');
fs.mkdirSync(c, { recursive: true });
const gz = path.join(c, CMANGOS.file);
if (!fs.existsSync(gz)) {
  console.log(`download ${CMANGOS.url}`);
  const res = await fetch(CMANGOS.url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  fs.writeFileSync(gz, Buffer.from(await res.arrayBuffer()));
}
const sha = crypto.createHash('sha256').update(fs.readFileSync(gz)).digest('hex');
console.log(`cmangos sha256 ${sha}`);
fs.writeFileSync(path.join(c, 'ClassicDB.sql'), zlib.gunzipSync(fs.readFileSync(gz)));
console.log('data-raw ready. Next: npm run data:build');
