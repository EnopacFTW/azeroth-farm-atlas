// Builds src-tauri/resources/seed.db from QuestieDB (Forever) + cmangos classic-db (Classic fallback).
// Usage: npm run data:build   (expects data-raw/ populated by `npm run data:fetch`)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { extractLongString, parseLuaTable } from './lib/lua-table.mjs';
import { readTables, toObjects } from './lib/sql-dump.mjs';
import { clusterPoints, convexHull, nearestNeighbourTour, skinningSkillForLevel } from './lib/geo.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const RAW = path.join(ROOT, 'data-raw');
const Q = path.join(RAW, 'questiedb');
const CM = path.join(RAW, 'cmangos', 'ClassicDB.sql');
const OUT_DB = path.join(ROOT, 'src-tauri', 'resources', 'seed.db');
const META = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'data', 'zones.json'), 'utf8'));
const SEED_SCHEMA_VERSION = 2;

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

// ---------------------------------------------------------------- sources
function gitHead(dir) {
  try { return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return null; }
}
const questieCommit = gitHead(Q);
const cmangosFile = 'ClassicDB_1_12_1_z2815.sql.gz';
const cmangosSha256 = fs.existsSync(CM + '.gz')
  ? crypto.createHash('sha256').update(fs.readFileSync(CM + '.gz')).digest('hex') : null;
const builtAt = new Date().toISOString();

const SOURCES = [
  { id: 'questiedb_forever', name: 'QuestieDB – Flavor Forever', url: 'https://github.com/Questie/QuestieDB', license: 'GPL-3.0',
    version: questieCommit, flavor: 'forever', reliability: 'forever_client_data',
    notes: 'NPCs, Level, Rang, Spawnkoordinaten (Forever-konvertiert), Objekte/Knoten-Spawns, Item-Drop-Beziehungen ohne Dropchance, deDE-Namen.' },
  { id: 'cmangos_classic', name: 'cmangos classic-db (1.12.1)', url: 'https://github.com/cmangos/classic-db', license: 'GPL-3.0',
    version: `${cmangosFile} sha256:${cmangosSha256}`, flavor: 'classic_era', reliability: 'classic_fallback',
    notes: 'Emulator-Datenbank Classic 1.12: Kreaturtyp, Kürschnerbarkeit, Loot-Chancen (Kill/Kürschnern/Knoten/Angeln), Münzloot, Händlerpreise. Nicht Forever-verifiziert.' },
  { id: 'classic_rules', name: 'Classic-Spielregeln (Wowpedia)', url: 'https://wowpedia.fandom.com/wiki/Skinning', license: 'Fakten / CC BY-SA Referenz',
    version: 'Classic 1.12', flavor: 'classic_era', reliability: 'classic_fallback',
    notes: 'Formeln: Kürschner-Skill = (Level-10)*10 bis Level 20, sonst Level*5; Erz-/Kräuter-Skillgrenzen; graue Moblevel. Nicht gegen Forever geprüft.' },
  { id: 'manual_zone_meta', name: 'Zonen-Metadaten (manuell kuratiert)', url: 'scripts/data/zones.json', license: 'Projektlizenz (GPL-3.0)',
    version: builtAt.slice(0, 10), flavor: 'classic_era', reliability: 'manual_unverified',
    notes: 'Deutsche Zonennamen, Kontinent, Zonentyp, Classic-Zonenkontrolle für PvP-Hinweis.' },
  { id: 'atlas_clustering', name: 'Azeroth Farm Atlas – automatische Spot-Gruppierung', url: 'scripts/lib/geo.mjs', license: 'GPL-3.0',
    version: String(SEED_SCHEMA_VERSION), flavor: 'forever', reliability: 'forever_client_data',
    notes: 'Spots sind automatisch aus Forever-Spawnpunkten gruppiert (DBSCAN, eps 6 %). Keine handkuratierten Routen.' },
  { id: 'community_guides', name: 'Community-Farmguides (recherchiert)', url: 'scripts/data/community-spots.json', license: 'Fakten mit Quellenlink',
    version: builtAt.slice(0, 10), flavor: 'classic_era', reliability: 'manual_unverified',
    notes: 'Empfohlene Farmspots aus öffentlichen Guides (Warcraft Tavern, Almar\'s Guides, wow-professions.com, Boostroom, Method.gg). Mobs, Koordinaten und Loot werden beim Build gegen die Forever-Spawndaten aufgelöst; Quellen je Spot verlinkt.' },
];

// ---------------------------------------------------------------- QuestieDB
log('parsing QuestieDB Forever…');
const readLua = (file, marker) => parseLuaTable(extractLongString(fs.readFileSync(path.join(Q, file), 'utf8'), marker));
const qNpcs = readLua('data/Forever/foreverNpcDB.lua', 'QuestieDB.npcData');
const qItems = readLua('data/Forever/foreverItemDB.lua', 'QuestieDB.itemData');
const qObjects = readLua('data/Forever/foreverObjectDB.lua', 'QuestieDB.objectData');
const deNpcs = readLua('l10n/Forever/lookupNpcs/deDE.lua', 'l10n.npcNameLookup');
const deItems = readLua('l10n/Forever/lookupItems/deDE.lua', 'l10n.itemLookup');
const deObjects = readLua('l10n/Forever/lookupObjects/deDE.lua', 'l10n.objectLookup');
const conversion = JSON.parse(fs.readFileSync(path.join(Q, 'data/Forever/conversion.json'), 'utf8'));
log(`QuestieDB: ${Object.keys(qNpcs).length} npcs, ${Object.keys(qItems).length} items, ${Object.keys(qObjects).length} objects`);

// ---------------------------------------------------------------- cmangos
log('parsing cmangos classic-db…');
const sql = fs.readFileSync(CM, 'utf8');
const T = readTables(sql, ['creature_template', 'creature_loot_template', 'skinning_loot_template', 'gameobject_template',
  'gameobject_loot_template', 'fishing_loot_template', 'item_template', 'skill_fishing_base_level']);
const pick = (t, cols) => toObjects(T.columns[t], T.rows[t], cols);
const cCreatures = new Map(pick('creature_template', ['Entry', 'Name', 'MinLevel', 'MaxLevel', 'CreatureType', 'Family', 'Rank',
  'MinLootGold', 'MaxLootGold', 'LootId', 'SkinningLootId', 'ExperienceMultiplier']).map((r) => [r.Entry, r]));
const cItems = new Map(pick('item_template', ['entry', 'class', 'subclass', 'name', 'Quality', 'BuyPrice', 'SellPrice', 'stackable',
  'ItemLevel', 'RequiredLevel']).map((r) => [r.entry, r]));
const cGameObjects = new Map(pick('gameobject_template', ['entry', 'type', 'name', 'data1']).map((r) => [r.entry, r]));
const lootCols = ['entry', 'item', 'ChanceOrQuestChance', 'groupid', 'mincountOrRef', 'maxcount'];
const groupBy = (rows) => { const m = new Map(); for (const r of rows) { if (!m.has(r.entry)) m.set(r.entry, []); m.get(r.entry).push(r); } return m; };
const cCreatureLoot = groupBy(pick('creature_loot_template', lootCols));
const cSkinLoot = groupBy(pick('skinning_loot_template', lootCols));
const cGoLoot = groupBy(pick('gameobject_loot_template', lootCols));
const cFishLoot = groupBy(pick('fishing_loot_template', lootCols));
const cFishBase = new Map(pick('skill_fishing_base_level', ['entry', 'skill']).map((r) => [r.entry, r.skill]));
log(`cmangos: ${cCreatures.size} creatures, ${cItems.size} items, ${cGameObjects.size} gameobjects`);

// Expands one cmangos loot template into item rows with rates (0..1). References (world-drop pools) are skipped.
function expandLoot(entries) {
  const out = [];
  let skippedRefs = 0;
  const groups = new Map();
  for (const e of entries) {
    if (e.mincountOrRef < 0) { skippedRefs++; continue; }
    if (!groups.has(e.groupid)) groups.set(e.groupid, []);
    groups.get(e.groupid).push(e);
  }
  for (const [gid, list] of groups) {
    if (gid === 0) {
      for (const e of list) {
        out.push({ item: e.item, rate: Math.abs(e.ChanceOrQuestChance) / 100, quest: e.ChanceOrQuestChance < 0,
          min: e.mincountOrRef, max: e.maxcount, group: 0 });
      }
    } else {
      const explicit = list.filter((e) => e.ChanceOrQuestChance !== 0);
      const equal = list.filter((e) => e.ChanceOrQuestChance === 0);
      const sumExplicit = explicit.reduce((s, e) => s + Math.abs(e.ChanceOrQuestChance), 0);
      const share = equal.length ? Math.max(0, 100 - sumExplicit) / equal.length : 0;
      for (const e of list) {
        const pct = e.ChanceOrQuestChance === 0 ? share : Math.abs(e.ChanceOrQuestChance);
        out.push({ item: e.item, rate: pct / 100, quest: e.ChanceOrQuestChance < 0, min: e.mincountOrRef, max: e.maxcount, group: gid });
      }
    }
  }
  return { rows: out, skippedRefs };
}

// ---------------------------------------------------------------- zones
const transformByArea = new Map(conversion.geometry.transforms.map((t) => [t.area_id, t]));
const zoneMeta = new Map(META.zones.map((z) => [z.id, z]));
const herbSkill = META.gatheringSkill.herb;
const oreSkill = META.gatheringSkill.ore;
const CLOTH = new Set(META.clothItemIds);

// ---------------------------------------------------------------- open DB
fs.mkdirSync(path.dirname(OUT_DB), { recursive: true });
if (fs.existsSync(OUT_DB)) fs.rmSync(OUT_DB);
const db = new DatabaseSync(OUT_DB);
db.exec(fs.readFileSync(path.join(ROOT, 'scripts', 'data', 'seed-schema.sql'), 'utf8'));
db.exec('BEGIN');
const ins = (table, cols) => {
  const st = db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
  return (...v) => st.run(...v.map((x) => (x === undefined ? null : x)));
};

const insMeta = ins('meta', ['key', 'value']);
insMeta('seed_schema_version', String(SEED_SCHEMA_VERSION));
insMeta('built_at', builtAt);
insMeta('questiedb_commit', questieCommit ?? 'unknown');
insMeta('cmangos_file', cmangosFile);
insMeta('flavor', 'forever');

const insSource = ins('sources', ['id', 'name', 'url', 'license', 'version', 'retrieved_at', 'flavor', 'reliability', 'notes']);
for (const s of SOURCES) insSource(s.id, s.name, s.url, s.license, s.version, builtAt, s.flavor, s.reliability, s.notes);

// ---------------------------------------------------------------- items
log('items…');
const itemIds = new Set(Object.keys(qItems).map(Number));
const lootRows = []; // collected first, items inserted after so referenced ids exist

const CREATURE_TYPES = { 1: 'beast', 2: 'dragonkin', 3: 'demon', 4: 'elemental', 5: 'giant', 6: 'undead', 7: 'humanoid',
  8: 'critter', 9: 'mechanical', 10: 'not_specified', 11: 'totem' };
const CLASSIFICATION = { 0: 'normal', 1: 'elite', 2: 'rare_elite', 3: 'boss', 4: 'rare' };

// ---------------------------------------------------------------- NPCs
log('npcs + spawns…');
const insNpc = ins('npcs', ['id', 'name_en', 'name_de', 'sub_name', 'level_min', 'level_max', 'rank', 'classification', 'creature_type',
  'family', 'zone_id', 'friendly_to', 'hostile', 'min_coin', 'max_coin', 'can_skin', 'skinning_skill_min', 'skinning_skill_max',
  'in_classic', 'xp_mult', 'src_core', 'src_combat']);
const insNpcSpawn = ins('npc_spawns', ['npc_id', 'zone_id', 'x', 'y']);
const npcInfo = new Map();
let spawnCount = 0;
let refsSkipped = 0;

// Forever drop relationships from QuestieDB item.npcDrops (no rates)
const foreverDrops = new Map(); // npcId -> Set(itemId)
for (const [id, it] of Object.entries(qItems)) {
  for (const npcId of it[1] ?? []) {
    if (!foreverDrops.has(npcId)) foreverDrops.set(npcId, new Set());
    foreverDrops.get(npcId).add(Number(id));
  }
}

for (const [idStr, n] of Object.entries(qNpcs)) {
  const id = Number(idStr);
  const [name, , , lmin, lmax, rank, spawns, , zoneId, , , , friendly, subName, npcFlags] = n;
  if (!name) continue;
  const c = cCreatures.get(id);
  const de = deNpcs[id]?.[0] ?? null;
  const typeName = c ? CREATURE_TYPES[c.CreatureType] ?? null : null;
  const neutralMob = friendly === 'AH' && !(npcFlags > 0) && !!c && !!typeName && !['humanoid', 'critter', 'not_specified', 'totem'].includes(typeName)
    && (c.LootId > 0 || c.SkinningLootId > 0 || c.MaxLootGold > 0);
  const hostile = (friendly == null && !(npcFlags > 0)) || neutralMob ? 1 : 0;
  const canSkin = c ? (c.SkinningLootId > 0 ? 1 : 0) : null;
  const coinMin = c ? c.MinLootGold : null;
  const coinMax = c ? c.MaxLootGold : null;
  insNpc(id, name, typeof de === 'string' ? de : null, subName ?? null, lmin ?? null, lmax ?? null, rank ?? null,
    CLASSIFICATION[rank] ?? null, typeName, c?.Family ?? null, zoneId || null, friendly ?? null, hostile, coinMin, coinMax,
    canSkin, canSkin ? skinningSkillForLevel(lmin) : null, canSkin ? skinningSkillForLevel(lmax) : null, c ? 1 : 0,
    c ? Number(c.ExperienceMultiplier) : null, 'questiedb_forever', c ? 'cmangos_classic' : null);
  const pts = [];
  for (const [z, list] of Object.entries(spawns ?? {})) {
    for (const p of list ?? []) {
      const [x, y] = p;
      if (!(x >= 0 && x <= 100 && y >= 0 && y <= 100)) continue;
      insNpcSpawn(id, Number(z), x, y);
      pts.push({ zone: Number(z), x, y });
      spawnCount++;
    }
  }
  npcInfo.set(id, { id, name, de, lmin, lmax, rank, hostile, typeName, canSkin, coinMin, coinMax, pts, family: c?.Family ?? 0, inClassic: !!c, zoneId: zoneId || null, friendly: friendly ?? null, npcFlags: npcFlags ?? 0 });

  if (c?.LootId) {
    const { rows, skippedRefs } = expandLoot(cCreatureLoot.get(c.LootId) ?? []);
    refsSkipped += skippedRefs;
    for (const r of rows) lootRows.push(['npc', id, r.item, r.quest ? 'quest' : 'normal_kill', r.rate, r.min, r.max, r.group, 'cmangos_classic', 'classic_fallback']);
  }
  if (c?.SkinningLootId) {
    for (const r of expandLoot(cSkinLoot.get(c.SkinningLootId) ?? []).rows)
      lootRows.push(['npc', id, r.item, 'skinning', r.rate, r.min, r.max, r.group, 'cmangos_classic', 'classic_fallback']);
  }
  for (const itemId of foreverDrops.get(id) ?? []) {
    lootRows.push(['npc', id, itemId, 'normal_kill', null, null, null, null, 'questiedb_forever', 'forever_client_data']);
  }
}
log(`npcs: ${npcInfo.size}, spawns: ${spawnCount}, skipped loot references: ${refsSkipped}`);

// ---------------------------------------------------------------- objects (gathering nodes + fishing pools)
log('objects…');
const insObj = ins('objects', ['id', 'name_en', 'name_de', 'node_type', 'required_skill', 'skill_source', 'zone_id', 'src_core']);
const insObjSpawn = ins('object_spawns', ['object_id', 'zone_id', 'x', 'y']);
const objInfo = new Map();
for (const [idStr, o] of Object.entries(qObjects)) {
  const id = Number(idStr);
  const [name, , , spawns, zoneId] = o;
  if (!name) continue;
  const cg = cGameObjects.get(id);
  let nodeType = null;
  let skill = null;
  if (name in herbSkill) { nodeType = 'herb'; skill = herbSkill[name]; }
  else if (name in oreSkill) { nodeType = 'ore'; skill = oreSkill[name]; }
  else if (/Vein|Deposit/.test(name)) { nodeType = 'ore'; }
  else if (cg?.type === 25 || /School|Floating Wreckage|Floating Debris/.test(name)) { nodeType = 'fishing_pool'; }
  if (!nodeType) continue;
  const de = deObjects[id];
  insObj(id, name, typeof de === 'string' ? de : null, nodeType, skill, skill != null ? 'classic_rules' : null, zoneId || null, 'questiedb_forever');
  const pts = [];
  for (const [z, list] of Object.entries(spawns ?? {})) {
    for (const [x, y] of list ?? []) {
      if (!(x >= 0 && x <= 100 && y >= 0 && y <= 100)) continue;
      insObjSpawn(id, Number(z), x, y);
      pts.push({ zone: Number(z), x, y });
    }
  }
  objInfo.set(id, { id, name, de, nodeType, skill, pts });
  if (cg && (cg.type === 3 || cg.type === 25) && cg.data1) {
    const ctx = nodeType === 'herb' ? 'herb_node' : nodeType === 'ore' ? 'mining_node' : 'fishing';
    for (const r of expandLoot(cGoLoot.get(cg.data1) ?? []).rows)
      lootRows.push(['object', id, r.item, ctx, r.rate, r.min, r.max, r.group, 'cmangos_classic', 'classic_fallback']);
  }
}

// ---------------------------------------------------------------- zones table + fishing loot
log('zones…');
const insZone = ins('zones', ['id', 'ui_map_id', 'name_en', 'name_de', 'continent', 'kind', 'control', 'level_min', 'level_max',
  'fishing_base_skill', 'src_meta', 'src_map']);
const zoneLevels = new Map();
for (const npc of npcInfo.values()) {
  if (!npc.hostile || npc.lmin == null) continue;
  const perZone = new Map();
  for (const p of npc.pts) perZone.set(p.zone, (perZone.get(p.zone) ?? 0) + 1);
  for (const [z, c] of perZone) {
    if (c < 3) continue;
    if (!zoneLevels.has(z)) zoneLevels.set(z, []);
    zoneLevels.get(z).push(npc.lmin, npc.lmax);
  }
}
const pctl = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const zoneLevel = new Map();
for (const z of META.zones) {
  const lv = zoneLevels.get(z.id) ?? [];
  const lmin = lv.length ? pctl(lv, 0.1) : null;
  const lmax = lv.length ? pctl(lv, 0.9) : null;
  zoneLevel.set(z.id, [lmin, lmax]);
  const tr = transformByArea.get(z.id);
  insZone(z.id, tr?.ui_map_id ?? null, z.en, z.de, z.continent, z.kind, z.control ?? null, lmin, lmax,
    cFishBase.get(z.id) ?? null, 'manual_zone_meta', tr ? 'questiedb_forever' : null);
}
for (const [zoneId, entries] of cFishLoot) {
  if (!zoneMeta.has(zoneId)) continue;
  for (const r of expandLoot(entries).rows)
    lootRows.push(['zone', zoneId, r.item, 'fishing', r.rate, r.min, r.max, r.group, 'cmangos_classic', 'classic_fallback']);
}

// ---------------------------------------------------------------- items insert
for (const r of lootRows) itemIds.add(r[2]);
const insItem = ins('items', ['id', 'name_en', 'name_de', 'quality', 'item_class', 'item_subclass', 'item_level', 'required_level',
  'vendor_sell', 'vendor_buy', 'stack_size', 'is_cloth', 'in_forever', 'src_core', 'src_econ']);
const itemQuality = new Map();
let itemsWritten = 0;
for (const id of itemIds) {
  const q = qItems[id];
  const c = cItems.get(id);
  const name = q?.[0] ?? c?.name;
  if (!name) continue;
  const de = deItems[id];
  itemQuality.set(id, c?.Quality ?? null);
  insItem(id, name, typeof de === 'string' ? de : null, c?.Quality ?? null, q?.[11] ?? c?.class ?? null, q?.[12] ?? c?.subclass ?? null,
    q?.[8] ?? c?.ItemLevel ?? null, q?.[9] ?? c?.RequiredLevel ?? null, c ? c.SellPrice : null, c ? c.BuyPrice : null,
    c?.stackable ?? null, CLOTH.has(id) ? 1 : 0, q ? 1 : 0, q ? 'questiedb_forever' : 'cmangos_classic', c ? 'cmangos_classic' : null);
  itemsWritten++;
}
const insLoot = ins('loot', ['source_type', 'source_entity_id', 'item_id', 'context', 'rate', 'min_qty', 'max_qty', 'group_id', 'source_id', 'reliability']);
const writtenItems = new Set(db.prepare('SELECT id FROM items').all().map((r) => r.id));
let lootWritten = 0;
for (const r of lootRows) { if (writtenItems.has(r[2])) { insLoot(...r); lootWritten++; } }
log(`items: ${itemsWritten}, loot rows: ${lootWritten}`);

// ---------------------------------------------------------------- spots
log('spots…');
const insSpotRaw = ins('spots', ['id', 'slug', 'kind', 'title_en', 'title_de', 'zone_id', 'level_min', 'level_max', 'center_x', 'center_y',
  'radius', 'spawn_count', 'tags', 'professions', 'has_elite', 'has_rare', 'is_instance', 'req_skill_type', 'req_skill', 'hull_json',
  'route_json', 'route_kind', 'route_curated', 'generated', 'src_core', 'avg_coin_copper', 'model_vendor_copper_per_kill', 'model_vendor_partial',
  'farmable_by']);
let pendingEcon = [null, null, null];
let pendingFaction = null;
const insSpot = (...v) => { insSpotRaw(...v, ...pendingEcon, pendingFaction); pendingEcon = [null, null, null]; pendingFaction = null; };
const insSpotItem = ins('spot_items', ['spot_id', 'item_id', 'context', 'rate', 'forever_confirmed', 'rank']);
const itemVendorSell = new Map([...cItems.values()].map((c) => [c.entry, c.SellPrice]));

// Aggregates loot of several sources (weighted by spawn count). Unknown sources (no Classic table) are excluded from rates.
function aggregateSpotLoot(sources) {
  // sources: [{ weight, rows: [{item, ctx, rate, src}] , hasClassic }]
  const classicWeight = sources.filter((s) => s.hasClassic).reduce((a, s) => a + s.weight, 0);
  const agg = new Map();
  for (const s of sources) {
    for (const r of s.rows) {
      if (r.ctx === 'quest') continue;
      const k = `${r.item}|${r.ctx}`;
      if (!agg.has(k)) agg.set(k, { item: r.item, ctx: r.ctx, weighted: 0, classic: false, forever: false });
      const a = agg.get(k);
      if (r.src === 'questiedb_forever') a.forever = true;
      else if (r.rate != null) { a.weighted += r.rate * s.weight; a.classic = true; }
    }
  }
  return [...agg.values()].map((a) => ({ ...a, rate: a.classic && classicWeight > 0 ? a.weighted / classicWeight : null }));
}

function writeSpotItems(spotId, loot) {
  const ranked = [...loot].sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1));
  const keep = ranked.filter((l, i) => i < 10 || l.ctx === 'skinning' || CLOTH.has(l.item)).slice(0, 24);
  keep.forEach((l, i) => insSpotItem(spotId, l.item, l.ctx, l.rate, l.forever ? 1 : 0, i));
}

// Classic vendor model per kill: Σ rate × avgQty × vendorSell (normal kill loot) + avg coin. Partial if a priced drop lacks vendor price.
function vendorModel(npcs, weights) {
  const classic = npcs.filter((n) => n.inClassic);
  if (!classic.length) return [null, null, null];
  const total = classic.reduce((a, n) => a + weights.get(n.id), 0);
  let coin = 0; let vendor = 0; let partial = 0;
  for (const n of classic) {
    const w = weights.get(n.id) / total;
    const c = ((n.coinMin ?? 0) + (n.coinMax ?? 0)) / 2;
    coin += w * c;
    for (const l of lootRowsByNpc.get(n.id) ?? []) {
      if (l.ctx !== 'normal_kill' || l.rate == null) continue;
      const sell = itemVendorSell.get(l.item);
      if (sell == null) { partial = 1; continue; }
      vendor += w * l.rate * ((l.min + l.max) / 2) * sell;
    }
  }
  return [Math.round(coin), Math.round(vendor + coin), partial];
}
const lootRowsByNpc = new Map();
for (const r of lootRows) {
  if (r[0] !== 'npc' || r[8] !== 'cmangos_classic') continue;
  if (!lootRowsByNpc.has(r[1])) lootRowsByNpc.set(r[1], []);
  lootRowsByNpc.get(r[1]).push({ item: r[2], ctx: r[3], rate: r[4], min: r[5] ?? 1, max: r[6] ?? 1 });
}
const lootRowsByObject = new Map();
for (const r of lootRows) {
  if (r[0] !== 'object') continue;
  if (!lootRowsByObject.has(r[1])) lootRowsByObject.set(r[1], []);
  lootRowsByObject.get(r[1]).push({ item: r[2], ctx: r[3], rate: r[4], src: r[8] });
}
const lootRowsByZone = new Map();
for (const r of lootRows) {
  if (r[0] !== 'zone') continue;
  if (!lootRowsByZone.has(r[1])) lootRowsByZone.set(r[1], []);
  lootRowsByZone.get(r[1]).push({ item: r[2], ctx: r[3], rate: r[4], src: r[8] });
}
const insSpotNpc = ins('spot_npcs', ['spot_id', 'npc_id', 'spawn_count']);
const insSpotObj = ins('spot_objects', ['spot_id', 'object_id', 'spawn_count']);
const insSpotPoint = ins('spot_points', ['spot_id', 'entity_type', 'entity_id', 'x', 'y']);

const lootByNpc = new Map();
for (const r of lootRows) {
  if (r[0] !== 'npc') continue;
  if (!lootByNpc.has(r[1])) lootByNpc.set(r[1], []);
  lootByNpc.get(r[1]).push({ item: r[2], ctx: r[3], rate: r[4], src: r[8] });
}
const zoneName = (z, lang) => zoneMeta.get(z)?.[lang] ?? zoneMeta.get(z)?.en ?? `Zone ${z}`;
const slugify = (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const isInstanceZone = (z) => ['dungeon', 'raid', 'battleground'].includes(zoneMeta.get(z)?.kind);
const PROF_BY_TAG = { skinning: ['skinning', 'leatherworking'], cloth: ['tailoring', 'first_aid'], mining: ['mining', 'blacksmithing', 'engineering'],
  herbalism: ['herbalism', 'alchemy'], fishing: ['fishing', 'cooking'] };
const professionsFor = (tags) => [...new Set(tags.flatMap((t) => PROF_BY_TAG[t] ?? []))];
const fmt = (v) => Math.round(v * 10) / 10;

let spotCount = 0;
const usedSlugs = new Set();
function uniqueSlug(base) {
  let s = base; let i = 2;
  while (usedSlugs.has(s)) s = `${base}-${i++}`;
  usedSlugs.add(s);
  return s;
}

// --- mob clusters
const SKIP_TYPES = new Set(['critter', 'totem', 'not_specified']);
for (const z of META.zones) {
  if (z.kind === 'city' || z.kind === 'battleground') continue;
  const clusters = [];
  for (const npc of npcInfo.values()) {
    if (!npc.hostile || npc.lmin == null || npc.lmax > 63) continue;
    if (npc.typeName && SKIP_TYPES.has(npc.typeName)) continue;
    const pts = npc.pts.filter((p) => p.zone === z.id);
    const isRare = npc.rank === 2 || npc.rank === 4;
    if (pts.length < (isRare ? 1 : 3)) continue;
    let cl = isRare ? [pts] : clusterPoints(pts, 6, 3);
    // widely scattered patrols (e.g. Devilsaurs) form no dense cluster: keep them as one "scattered" spot
    const scattered = !isRare && cl.length === 0;
    if (scattered) cl = [pts];
    for (const c of cl) {
      const cx = c.reduce((s, p) => s + p.x, 0) / c.length;
      const cy = c.reduce((s, p) => s + p.y, 0) / c.length;
      clusters.push({ npcs: new Map([[npc.id, c]]), cx, cy, lmin: npc.lmin, lmax: npc.lmax, rare: isRare || scattered, scattered,
        type: npc.typeName });
    }
  }
  // greedy merge of nearby clusters with compatible levels and creature type
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const a = clusters[i]; const b = clusters[j];
        if (a.rare || b.rare) continue;
        if (Math.hypot(a.cx - b.cx, a.cy - b.cy) > 7) continue;
        if (Math.max(a.lmax, b.lmax) - Math.min(a.lmin, b.lmin) > 6) continue;
        if (a.type && b.type && a.type !== b.type) continue;
        for (const [k, v] of b.npcs) a.npcs.set(k, [...(a.npcs.get(k) ?? []), ...v]);
        const all = [...a.npcs.values()].flat();
        a.cx = all.reduce((s, p) => s + p.x, 0) / all.length;
        a.cy = all.reduce((s, p) => s + p.y, 0) / all.length;
        a.lmin = Math.min(a.lmin, b.lmin); a.lmax = Math.max(a.lmax, b.lmax);
        a.type = a.type ?? b.type;
        clusters.splice(j, 1);
        merged = true;
        break outer;
      }
    }
  }
  for (const c of clusters) {
    const all = [...c.npcs.values()].flat();
    if (!c.rare && all.length < 5) continue;
    if (c.scattered && all.length < 3) continue;
    const npcs = [...c.npcs.keys()].map((id) => npcInfo.get(id)).sort((a, b) => c.npcs.get(b.id).length - c.npcs.get(a.id).length);
    const tags = ['xp'];
    const anySkin = npcs.some((n) => n.canSkin === 1);
    if (anySkin) tags.push('skinning');
    const loot = npcs.flatMap((n) => lootByNpc.get(n.id) ?? []);
    if (loot.some((l) => CLOTH.has(l.item) && l.ctx === 'normal_kill' && (l.rate == null || l.rate > 0))) tags.push('cloth');
    if (npcs.some((n) => (n.coinMax ?? 0) > 0)) tags.push('gold');
    const hasRare = npcs.some((n) => n.rank === 2 || n.rank === 4) ||
      loot.some((l) => l.ctx === 'normal_kill' && l.rate != null && l.rate < 0.05 && (itemQuality.get(l.item) ?? 0) >= 3);
    if (hasRare) tags.push('rare');
    if (loot.length) tags.push('materials');
    const hasElite = npcs.some((n) => [1, 2, 3].includes(n.rank));
    const names = (lang) => npcs.slice(0, 2).map((n) => (lang === 'de' ? n.de || n.name : n.name)).join(', ') + (npcs.length > 2 ? ` +${npcs.length - 2}` : '');
    const where = `${zoneName(z.id, 'en')} (${Math.round(c.cx)}, ${Math.round(c.cy)})`;
    const whereDe = `${zoneName(z.id, 'de')} (${Math.round(c.cx)}, ${Math.round(c.cy)})`;
    const slug = uniqueSlug(slugify(`${z.en}-${npcs[0].name}`));
    const id = `mob:${slug}`;
    const radius = Math.max(...all.map((p) => Math.hypot(p.x - c.cx, p.y - c.cy)));
    const hull = all.length >= 3 ? convexHull(all).map((p) => [fmt(p.x), fmt(p.y)]) : null;
    const kind = c.scattered ? 'mob_scattered' : c.rare ? 'rare_mob' : 'mob_cluster';
    const weights = new Map(npcs.map((n) => [n.id, c.npcs.get(n.id).length]));
    pendingEcon = vendorModel(npcs, weights);
    writeSpotItems(id, aggregateSpotLoot(npcs.map((n) => ({ weight: weights.get(n.id), hasClassic: n.inClassic, rows: lootByNpc.get(n.id) ?? [] }))));
    insSpot(id, slug, kind, `${names('en')} · ${where}`, `${names('de')} · ${whereDe}`, z.id, c.lmin, c.lmax,
      fmt(c.cx), fmt(c.cy), fmt(radius), all.length, JSON.stringify(tags), JSON.stringify(professionsFor(tags)), hasElite ? 1 : 0,
      hasRare ? 1 : 0, isInstanceZone(z.id) ? 1 : 0, anySkin ? 'skinning' : null,
      anySkin ? Math.min(...npcs.filter((n) => n.canSkin === 1).map((n) => skinningSkillForLevel(n.lmin))) : null,
      hull ? JSON.stringify(hull) : null, null, null, 0, 1, 'atlas_clustering');
    for (const n of npcs) {
      const pts = c.npcs.get(n.id);
      insSpotNpc(id, n.id, pts.length);
      for (const p of pts) insSpotPoint(id, 'npc', n.id, p.x, p.y);
    }
    spotCount++;
  }
}

// --- gathering node spots: one per (zone, node name)
const nodeSpotIds = new Map();
const nodesByZoneName = new Map();
for (const o of objInfo.values()) {
  for (const p of o.pts) {
    const key = `${p.zone}|${o.nodeType}|${o.name}`;
    if (!nodesByZoneName.has(key)) nodesByZoneName.set(key, { zone: p.zone, type: o.nodeType, name: o.name, de: o.de, skill: o.skill, objs: new Map() });
    const g = nodesByZoneName.get(key);
    if (!g.objs.has(o.id)) g.objs.set(o.id, []);
    g.objs.get(o.id).push(p);
  }
}
for (const g of nodesByZoneName.values()) {
  if (!zoneMeta.has(g.zone)) continue;
  const all = [...g.objs.values()].flat();
  if (all.length < (g.type === 'fishing_pool' ? 1 : 3)) continue;
  const tag = g.type === 'herb' ? 'herbalism' : g.type === 'ore' ? 'mining' : 'fishing';
  const tags = [tag, 'materials'];
  const cx = all.reduce((s, p) => s + p.x, 0) / all.length;
  const cy = all.reduce((s, p) => s + p.y, 0) / all.length;
  const [zlmin, zlmax] = zoneLevel.get(g.zone) ?? [null, null];
  const tour = nearestNeighbourTour(all).map((p) => [fmt(p.x), fmt(p.y)]);
  const slug = uniqueSlug(slugify(`${zoneMeta.get(g.zone).en}-${g.name}`));
  const id = `node:${slug}`;
  nodeSpotIds.set(`${g.zone}|${g.type}|${g.name}`, id);
  const skillType = tag;
  const plural = g.type === 'fishing_pool' ? 'Schwärme' : 'Vorkommen';
  insSpot(id, slug, g.type === 'fishing_pool' ? 'fishing_pool' : 'node_zone', `${g.name} · ${zoneName(g.zone, 'en')}`,
    `${g.de || g.name} (${plural}) · ${zoneName(g.zone, 'de')}`, g.zone, zlmin, zlmax, fmt(cx), fmt(cy),
    fmt(Math.max(...all.map((p) => Math.hypot(p.x - cx, p.y - cy)))), all.length, JSON.stringify(tags),
    JSON.stringify(professionsFor([tag])), 0, 0, isInstanceZone(g.zone) ? 1 : 0, skillType,
    g.type === 'fishing_pool' ? (cFishBase.has(g.zone) ? Math.max(1, cFishBase.get(g.zone)) : null) : g.skill,
    null, JSON.stringify(tour), 'straight_line_nn', 0, 1, 'atlas_clustering');
  writeSpotItems(id, aggregateSpotLoot([...g.objs].map(([oid, pts]) => ({ weight: pts.length,
    hasClassic: (lootRowsByObject.get(oid) ?? []).some((r) => r.src === 'cmangos_classic'), rows: lootRowsByObject.get(oid) ?? [] }))));
  for (const [oid, pts] of g.objs) {
    insSpotObj(id, oid, pts.length);
    for (const p of pts) insSpotPoint(id, 'object', oid, p.x, p.y);
  }
  spotCount++;
}

// --- fishing zones without pools (open water fishing, from fishing_loot_template)
for (const [zoneId] of cFishLoot) {
  const z = zoneMeta.get(zoneId);
  if (!z || z.kind !== 'zone') continue;
  const slug = uniqueSlug(slugify(`${z.en}-fishing`));
  const [zlmin, zlmax] = zoneLevel.get(zoneId) ?? [null, null];
  const base = cFishBase.get(zoneId);
  writeSpotItems(`fish:${slug}`, aggregateSpotLoot([{ weight: 1, hasClassic: true, rows: lootRowsByZone.get(zoneId) ?? [] }]));
  insSpot(`fish:${slug}`, slug, 'fishing_zone', `Open water fishing · ${z.en}`, `Angeln (offenes Gewässer) · ${z.de}`, zoneId, zlmin, zlmax,
    null, null, null, 0, JSON.stringify(['fishing', 'materials']), JSON.stringify(professionsFor(['fishing'])), 0, 0, 0, 'fishing',
    base != null ? Math.max(1, base) : null, null, null, null, 0, 1, 'cmangos_classic');
  spotCount++;
}
// --- community spots: researched guide recommendations, resolved against the Forever spawn and loot data
const COMMUNITY = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'data', 'community-spots.json'), 'utf8'));
const insSpotSource = ins('spot_sources', ['spot_id', 'site', 'title', 'url', 'forever', 'note_en', 'note_de']);
const zoneByName = new Map([...zoneMeta].map(([id, z]) => [z.en.toLowerCase(), id]));
const itemIdsByName = new Map();
for (const r of db.prepare('SELECT id, name_en FROM items').all()) {
  const k = r.name_en.toLowerCase();
  if (!itemIdsByName.has(k)) itemIdsByName.set(k, []);
  itemIdsByName.get(k).push(r.id);
}
const communityReport = { resolved: [], skipped: [] };
for (const e of COMMUNITY.spots) {
  const zid = zoneByName.get(e.zone.toLowerCase());
  if (!zid) { communityReport.skipped.push(`${e.id}: unknown zone ${e.zone}`); continue; }
  const unknownItems = (e.items ?? []).filter((n) => !itemIdsByName.has(n.toLowerCase()));
  if (unknownItems.length) communityReport.skipped.push(`${e.id}: unknown item(s) ${unknownItems.join(', ')} (ignored)`);
  const itemSet = new Set((e.items ?? []).flatMap((n) => itemIdsByName.get(n.toLowerCase()) ?? []));
  const near = (p) => !e.at || Math.hypot(p.x - e.at[0], p.y - e.at[1]) <= (e.r ?? 10);
  const tokenOk = (name, tokens) => !tokens || tokens.some((t) => (e.exact ? name.toLowerCase() === t.toLowerCase() : name.toLowerCase().includes(t.toLowerCase())));
  const instance = isInstanceZone(zid);
  const slug = uniqueSlug(`community-${e.id}`);
  const id = `community:${e.id}`;
  const objectives = e.objectives ?? [];
  if (e.nodeType) {
    // gathering recommendations are attached to the existing per-node spots of the zone (one node type and skill each),
    // so a mixed route never hides a node the character cannot gather yet
    const targets = [...nodeSpotIds].filter(([k]) => { const [z, t, name] = k.split('|'); return Number(z) === zid && t === e.nodeType && tokenOk(name, e.nodes); })
      .map(([, sid]) => sid);
    if (!targets.length) { communityReport.skipped.push(`${e.id}: no node spots`); continue; }
    for (const sid of targets) {
      for (const key of e.src) {
        const src = COMMUNITY.sources[key];
        if (!src) throw new Error(`community spot ${e.id}: unknown source ${key}`);
        insSpotSource(sid, src.site, src.title, src.url, src.forever ? 1 : 0, e.en ?? null, e.de ?? null);
      }
    }
    communityReport.resolved.push(e.id);
    continue;
  } else {
    const picked = new Map();
    for (const n of npcInfo.values()) {
      const named = !!e.mobs && !!n.friendly && !(n.npcFlags > 0) && ![1, 3].includes(n.rank);
      if ((!n.hostile && !named) || n.lmin == null || !tokenOk(n.name, e.mobs)) continue;
      // without mob names the target items select the mobs: only mobs that drop one of them
      if (!e.mobs && !e.allMobs && !(lootByNpc.get(n.id) ?? []).some((l) => itemSet.has(l.item) && (l.rate == null || l.rate > 0))) continue;
      if (instance) { if (n.zoneId === zid) picked.set(n.id, []); continue; }
      const pts = n.pts.filter((p) => p.zone === zid && near(p));
      if (pts.length) picked.set(n.id, pts);
    }
    if (!picked.size) { communityReport.skipped.push(`${e.id}: no matching mobs`); continue; }
    const npcs = [...picked.keys()].map((nid) => npcInfo.get(nid)).sort((a, b) => picked.get(b.id).length - picked.get(a.id).length);
    const all = [...picked.values()].flat();
    const loot = npcs.flatMap((n) => lootByNpc.get(n.id) ?? []);
    const anySkin = npcs.some((n) => n.canSkin === 1);
    const tags = ['xp'];
    if (anySkin) tags.push('skinning');
    if (loot.some((l) => CLOTH.has(l.item) && l.ctx === 'normal_kill' && (l.rate == null || l.rate > 0))) tags.push('cloth');
    if (npcs.some((n) => (n.coinMax ?? 0) > 0)) tags.push('gold');
    const hasRare = npcs.some((n) => n.rank === 2 || n.rank === 4);
    if (hasRare) tags.push('rare');
    if (loot.length) tags.push('materials');
    for (const o of objectives) if (!tags.includes(o)) tags.push(o);
    // recommended for AoE grinding/farming by the AoE guides (finder filter "AoE spots")
    if (e.aoe) tags.push('aoe');
    const hasElite = npcs.some((n) => [1, 2, 3].includes(n.rank));
    const names = (lang) => npcs.slice(0, 2).map((n) => (lang === 'de' ? n.de || n.name : n.name)).join(', ') + (npcs.length > 2 ? ` +${npcs.length - 2}` : '');
    const cx = all.length ? all.reduce((s, p) => s + p.x, 0) / all.length : null;
    const cy = all.length ? all.reduce((s, p) => s + p.y, 0) / all.length : null;
    const where = (lang) => (cx != null ? `${zoneName(zid, lang)} (${Math.round(cx)}, ${Math.round(cy)})` : zoneName(zid, lang));
    const weights = new Map(npcs.map((n) => [n.id, Math.max(1, picked.get(n.id).length)]));
    pendingEcon = vendorModel(npcs, weights);
    // friendly to Alliance only -> farmable by Horde, and vice versa; any mob hostile to both makes it a both-faction spot
    const sides = new Set(npcs.map((n) => (n.hostile ? 'both' : n.friendly === 'A' ? 'horde' : n.friendly === 'H' ? 'alliance' : 'both')));
    pendingFaction = sides.has('both') || sides.size !== 1 ? null : [...sides][0];
    writeSpotItems(id, aggregateSpotLoot(npcs.map((n) => ({ weight: weights.get(n.id), hasClassic: n.inClassic, rows: lootByNpc.get(n.id) ?? [] }))));
    const hull = all.length >= 3 ? convexHull(all).map((p) => [fmt(p.x), fmt(p.y)]) : null;
    insSpot(id, slug, instance ? 'instance_run' : 'mob_cluster', `${names('en')} · ${where('en')}`, `${names('de')} · ${where('de')}`, zid,
      Math.min(...npcs.map((n) => n.lmin)), Math.max(...npcs.map((n) => n.lmax ?? n.lmin)),
      cx != null ? fmt(cx) : null, cy != null ? fmt(cy) : null, cx != null ? fmt(Math.max(...all.map((p) => Math.hypot(p.x - cx, p.y - cy)))) : null,
      all.length || npcs.length, JSON.stringify(tags), JSON.stringify(professionsFor(tags)), hasElite ? 1 : 0, hasRare ? 1 : 0, instance ? 1 : 0,
      anySkin ? 'skinning' : null, anySkin ? Math.min(...npcs.filter((n) => n.canSkin === 1).map((n) => skinningSkillForLevel(n.lmin))) : null,
      hull ? JSON.stringify(hull) : null, null, null, 0, 0, 'community_guides');
    for (const n of npcs) {
      const pts = picked.get(n.id);
      insSpotNpc(id, n.id, pts.length);
      for (const p of pts) insSpotPoint(id, 'npc', n.id, p.x, p.y);
    }
  }
  for (const key of e.src) {
    const s = COMMUNITY.sources[key];
    if (!s) throw new Error(`community spot ${e.id}: unknown source ${key}`);
    insSpotSource(id, s.site, s.title, s.url, s.forever ? 1 : 0, e.en ?? null, e.de ?? null);
  }
  communityReport.resolved.push(e.id);
  spotCount++;
}
log(`community spots: ${communityReport.resolved.length} resolved, ${communityReport.skipped.length} notes`);
for (const s of communityReport.skipped) log(`  community: ${s}`);
log(`spots: ${spotCount}`);

// ---------------------------------------------------------------- vendors (Forever relation from QuestieDB item.vendors)
const insVendor = ins('item_vendors', ['item_id', 'npc_id', 'source_id']);
for (const [id, it] of Object.entries(qItems)) {
  for (const npcId of it[13] ?? []) if (npcInfo.has(npcId)) insVendor(Number(id), npcId, 'questiedb_forever');
}

// ---------------------------------------------------------------- search index
log('fts…');
const insFts = ins('search_fts', ['kind', 'entity_id', 'name_en', 'name_de']);
for (const r of db.prepare('SELECT id, name_en, name_de FROM items').all()) insFts('item', r.id, r.name_en, r.name_de ?? '');
for (const r of db.prepare('SELECT id, name_en, name_de FROM npcs WHERE id IN (SELECT DISTINCT npc_id FROM npc_spawns)').all()) insFts('npc', r.id, r.name_en, r.name_de ?? '');
for (const r of db.prepare('SELECT id, name_en, name_de FROM zones').all()) insFts('zone', r.id, r.name_en, r.name_de ?? '');
for (const r of db.prepare('SELECT id, name_en, name_de FROM objects').all()) insFts('object', r.id, r.name_en, r.name_de ?? '');

// ---------------------------------------------------------------- coverage
const insCov = ins('coverage', ['level_band', 'objective', 'spots']);
const bands = [[1, 10], [11, 20], [21, 30], [31, 40], [41, 50], [51, 60]];
const objectives = ['xp', 'gold', 'cloth', 'skinning', 'mining', 'herbalism', 'fishing', 'rare'];
const coverage = {};
for (const [a, b] of bands) {
  const band = `${a}-${b}`;
  coverage[band] = {};
  for (const o of objectives) {
    const n = db.prepare(`SELECT COUNT(*) c FROM spots, json_each(spots.tags) t WHERE t.value = ? AND is_instance = 0
      AND level_min IS NOT NULL AND level_min <= ? AND level_max >= ?`).get(o, b, a).c;
    insCov(band, o, n);
    coverage[band][o] = n;
  }
}
db.exec('COMMIT');
db.exec('ANALYZE');
db.exec('VACUUM');

const count = (t) => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
const manifest = {
  seedSchemaVersion: SEED_SCHEMA_VERSION,
  builtAt,
  sources: SOURCES.map(({ id, name, url, license, version, reliability }) => ({ id, name, url, license, version, reliability })),
  counts: {
    zones: count('zones'), npcs: count('npcs'), npcSpawns: count('npc_spawns'), items: count('items'), objects: count('objects'),
    objectSpawns: count('object_spawns'), lootRows: count('loot'),
    lootRowsForeverRelation: db.prepare("SELECT COUNT(*) c FROM loot WHERE source_id='questiedb_forever'").get().c,
    lootRowsClassicWithRate: db.prepare("SELECT COUNT(*) c FROM loot WHERE source_id='cmangos_classic'").get().c,
    spots: count('spots'),
    spotsByKind: Object.fromEntries(db.prepare('SELECT kind, COUNT(*) c FROM spots GROUP BY kind').all().map((r) => [r.kind, r.c])),
    curatedRoutes: 0,
    communitySpots: communityReport.resolved.length,
    skippedLootReferences: refsSkipped,
  },
  coverage,
};
db.close();
const sha = crypto.createHash('sha256').update(fs.readFileSync(OUT_DB)).digest('hex');
manifest.seedSha256 = sha;
fs.writeFileSync(path.join(ROOT, 'src-tauri', 'resources', 'data-manifest.json'), JSON.stringify(manifest, null, 2));

// coverage report (markdown)
const lines = ['# Coverage-Report (automatisch erzeugt)', '', `Build: ${builtAt}  ·  Seed SHA-256: \`${sha.slice(0, 16)}…\``, '',
  '## Datensätze', '', '| Tabelle | Anzahl |', '|---|---|', ...Object.entries(manifest.counts).filter(([, v]) => typeof v === 'number').map(([k, v]) => `| ${k} | ${v} |`), '',
  '## Spots je Levelband und Farmziel (offene Welt)', '', `| Band | ${objectives.join(' | ')} |`, `|---|${objectives.map(() => '---').join('|')}|`,
  ...Object.entries(coverage).map(([band, o]) => `| ${band} | ${objectives.map((k) => (o[k] === 0 ? '**0 (Lücke)**' : o[k])).join(' | ')} |`), '',
  '## Community-Spots', '', `Aufgelöst: ${communityReport.resolved.length}`, '', ...communityReport.skipped.map((s) => `- ${s}`), '',
  '## Quellen', '', ...SOURCES.map((s) => `- **${s.name}** (${s.license}) – ${s.url} – Version: \`${s.version}\` – ${s.reliability}`), ''];
fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'docs', 'coverage-report.md'), lines.join('\n'));
log('done', JSON.stringify(manifest.counts));
