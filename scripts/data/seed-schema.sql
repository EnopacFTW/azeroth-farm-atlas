-- Static game data (read-only in the app). Third-party AH prices are NEVER stored here.
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE sources (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT, license TEXT, version TEXT, retrieved_at TEXT,
  flavor TEXT NOT NULL, reliability TEXT NOT NULL, notes TEXT
);

CREATE TABLE zones (
  id INTEGER PRIMARY KEY, ui_map_id INTEGER, name_en TEXT NOT NULL, name_de TEXT, continent TEXT,
  kind TEXT NOT NULL, control TEXT, level_min INTEGER, level_max INTEGER, fishing_base_skill INTEGER,
  src_meta TEXT REFERENCES sources(id), src_map TEXT REFERENCES sources(id)
);

CREATE TABLE npcs (
  id INTEGER PRIMARY KEY, name_en TEXT NOT NULL, name_de TEXT, sub_name TEXT, level_min INTEGER, level_max INTEGER,
  rank INTEGER, classification TEXT, creature_type TEXT, family INTEGER, zone_id INTEGER, friendly_to TEXT,
  hostile INTEGER NOT NULL, min_coin INTEGER, max_coin INTEGER,
  can_skin INTEGER,               -- NULL = unknown (NPC not in Classic DB)
  skinning_skill_min INTEGER, skinning_skill_max INTEGER,
  in_classic INTEGER NOT NULL,
  src_core TEXT NOT NULL REFERENCES sources(id),   -- name/level/rank/spawns
  src_combat TEXT REFERENCES sources(id)           -- type/skinning/coin/loot
);
CREATE TABLE npc_spawns (npc_id INTEGER NOT NULL, zone_id INTEGER NOT NULL, x REAL NOT NULL, y REAL NOT NULL);
CREATE INDEX idx_npc_spawns_npc ON npc_spawns(npc_id);
CREATE INDEX idx_npc_spawns_zone ON npc_spawns(zone_id);

CREATE TABLE items (
  id INTEGER PRIMARY KEY, name_en TEXT NOT NULL, name_de TEXT, quality INTEGER, item_class INTEGER, item_subclass INTEGER,
  item_level INTEGER, required_level INTEGER,
  vendor_sell INTEGER,            -- copper, NULL = unknown
  vendor_buy INTEGER, stack_size INTEGER, is_cloth INTEGER NOT NULL DEFAULT 0, in_forever INTEGER NOT NULL,
  src_core TEXT NOT NULL REFERENCES sources(id), src_econ TEXT REFERENCES sources(id)
);

CREATE TABLE objects (
  id INTEGER PRIMARY KEY, name_en TEXT NOT NULL, name_de TEXT, node_type TEXT NOT NULL,
  required_skill INTEGER, skill_source TEXT REFERENCES sources(id), zone_id INTEGER,
  src_core TEXT NOT NULL REFERENCES sources(id)
);
CREATE TABLE object_spawns (object_id INTEGER NOT NULL, zone_id INTEGER NOT NULL, x REAL NOT NULL, y REAL NOT NULL);
CREATE INDEX idx_object_spawns_obj ON object_spawns(object_id);
CREATE INDEX idx_object_spawns_zone ON object_spawns(zone_id);

CREATE TABLE loot (
  source_type TEXT NOT NULL,      -- npc | object | zone
  source_entity_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL REFERENCES items(id),
  context TEXT NOT NULL,          -- normal_kill | skinning | herb_node | mining_node | fishing | quest
  rate REAL,                      -- 0..1, NULL = unknown
  min_qty INTEGER, max_qty INTEGER, group_id INTEGER,
  source_id TEXT NOT NULL REFERENCES sources(id), reliability TEXT NOT NULL
);
CREATE INDEX idx_loot_source ON loot(source_type, source_entity_id);
CREATE INDEX idx_loot_item ON loot(item_id, source_type);

CREATE TABLE spots (
  id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL,
  kind TEXT NOT NULL,             -- mob_cluster | rare_mob | node_zone | fishing_pool | fishing_zone
  title_en TEXT NOT NULL, title_de TEXT NOT NULL, zone_id INTEGER NOT NULL REFERENCES zones(id),
  level_min INTEGER, level_max INTEGER, center_x REAL, center_y REAL, radius REAL, spawn_count INTEGER NOT NULL,
  tags TEXT NOT NULL, professions TEXT NOT NULL,
  has_elite INTEGER NOT NULL, has_rare INTEGER NOT NULL, is_instance INTEGER NOT NULL,
  req_skill_type TEXT, req_skill INTEGER,
  hull_json TEXT, route_json TEXT, route_kind TEXT, route_curated INTEGER NOT NULL, generated INTEGER NOT NULL,
  -- Classic-fallback model per kill (spawn-weighted over NPCs with Classic loot tables); NULL = not computable
  avg_coin_copper INTEGER, model_vendor_copper_per_kill INTEGER, model_vendor_partial INTEGER,
  src_core TEXT NOT NULL REFERENCES sources(id)
);
-- Main drops per spot (precomputed for the result list). rate = spawn-weighted Classic rate, NULL = unknown.
CREATE TABLE spot_items (
  spot_id TEXT NOT NULL, item_id INTEGER NOT NULL, context TEXT NOT NULL, rate REAL,
  forever_confirmed INTEGER NOT NULL, rank INTEGER NOT NULL
);
CREATE INDEX idx_spot_items_spot ON spot_items(spot_id);
CREATE INDEX idx_spot_items_item ON spot_items(item_id);
CREATE TABLE item_vendors (item_id INTEGER NOT NULL, npc_id INTEGER NOT NULL, source_id TEXT NOT NULL);
CREATE INDEX idx_item_vendors_item ON item_vendors(item_id);
CREATE INDEX idx_spots_zone_level ON spots(zone_id, level_min, req_skill_type);
CREATE TABLE spot_npcs (spot_id TEXT NOT NULL, npc_id INTEGER NOT NULL, spawn_count INTEGER NOT NULL);
CREATE INDEX idx_spot_npcs_spot ON spot_npcs(spot_id);
CREATE INDEX idx_spot_npcs_npc ON spot_npcs(npc_id);
CREATE TABLE spot_objects (spot_id TEXT NOT NULL, object_id INTEGER NOT NULL, spawn_count INTEGER NOT NULL);
CREATE INDEX idx_spot_objects_spot ON spot_objects(spot_id);
CREATE INDEX idx_spot_objects_obj ON spot_objects(object_id);
CREATE TABLE spot_points (spot_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL, x REAL NOT NULL, y REAL NOT NULL);
CREATE INDEX idx_spot_points_spot ON spot_points(spot_id);

CREATE VIRTUAL TABLE search_fts USING fts5(kind UNINDEXED, entity_id UNINDEXED, name_en, name_de, tokenize = 'unicode61 remove_diacritics 2');

CREATE TABLE coverage (level_band TEXT NOT NULL, objective TEXT NOT NULL, spots INTEGER NOT NULL);
