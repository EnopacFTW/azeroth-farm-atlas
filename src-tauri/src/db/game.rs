//! Read-only queries against game.db. Results are built as JSON inside SQLite and passed through unchanged.

use crate::error::{AppError, AppResult};
use rusqlite::{named_params, params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::Value;

pub const SPOT_CANDIDATES_SQL: &str = include_str!("queries/spot_candidates.sql");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateQuery {
    pub level: u8,
    #[serde(default = "d_below")]
    pub below: u8,
    #[serde(default = "d_above")]
    pub above: u8,
    pub zone_id: Option<u32>,
    #[serde(default)]
    pub include_instances: bool,
}
fn d_below() -> u8 {
    12
}
fn d_above() -> u8 {
    5
}

fn json_rows(c: &Connection, sql: &str, p: impl rusqlite::Params) -> AppResult<Vec<Value>> {
    let mut st = c.prepare_cached(sql)?;
    let rows = st.query_map(p, |r| r.get::<_, String>(0))?;
    let mut out = Vec::new();
    for r in rows {
        out.push(serde_json::from_str(&r?)?);
    }
    Ok(out)
}

fn json_one(c: &Connection, sql: &str, p: impl rusqlite::Params) -> AppResult<Option<Value>> {
    let s: Option<String> = c.query_row(sql, p, |r| r.get(0)).optional()?;
    Ok(match s {
        Some(s) => Some(serde_json::from_str(&s)?),
        None => None,
    })
}

pub fn spot_candidates(c: &Connection, q: &CandidateQuery) -> AppResult<Vec<Value>> {
    if !(1..=60).contains(&q.level) {
        return Err(AppError::invalid(crate::i18n::tr("Level muss zwischen 1 und 60 liegen", "Level must be between 1 and 60")));
    }
    json_rows(
        c,
        SPOT_CANDIDATES_SQL,
        named_params! { ":level": q.level, ":above": q.above.min(20), ":below": q.below.min(60), ":zone": q.zone_id, ":include_instances": q.include_instances as i32 },
    )
}

const LOOT_JSON: &str = "json_object('itemId', i.id, 'nameEn', i.name_en, 'nameDe', i.name_de, 'quality', i.quality, 'context', l.context,
  'rate', l.rate, 'minQty', l.min_qty, 'maxQty', l.max_qty, 'groupId', l.group_id, 'vendorSell', i.vendor_sell, 'isCloth', i.is_cloth,
  'sourceId', l.source_id, 'reliability', l.reliability)";

pub fn spot_detail(c: &Connection, id: &str) -> AppResult<Option<Value>> {
    let sql = format!(
        "SELECT json_object(
          'spot', json_object('id', s.id, 'slug', s.slug, 'kind', s.kind, 'titleEn', s.title_en, 'titleDe', s.title_de, 'zoneId', s.zone_id,
             'levelMin', s.level_min, 'levelMax', s.level_max, 'centerX', s.center_x, 'centerY', s.center_y, 'radius', s.radius,
             'spawnCount', s.spawn_count, 'tags', json(s.tags), 'professions', json(s.professions), 'hasElite', s.has_elite,
             'hasRare', s.has_rare, 'isInstance', s.is_instance, 'reqSkillType', s.req_skill_type, 'reqSkill', s.req_skill,
             'hull', json(s.hull_json), 'route', json(s.route_json), 'routeKind', s.route_kind, 'routeCurated', s.route_curated,
             'generated', s.generated, 'srcCore', s.src_core, 'avgCoinCopper', s.avg_coin_copper,
             'modelVendorCopperPerKill', s.model_vendor_copper_per_kill, 'modelVendorPartial', s.model_vendor_partial,
             'farmableBy', s.farmable_by),
          'sources', (SELECT json_group_array(json_object('site', ss.site, 'title', ss.title, 'url', ss.url, 'forever', ss.forever,
             'noteEn', ss.note_en, 'noteDe', ss.note_de)) FROM spot_sources ss WHERE ss.spot_id = s.id),
          'zone', (SELECT json_object('id', z.id, 'uiMapId', z.ui_map_id, 'nameEn', z.name_en, 'nameDe', z.name_de, 'continent', z.continent,
             'kind', z.kind, 'control', z.control, 'levelMin', z.level_min, 'levelMax', z.level_max, 'fishingBaseSkill', z.fishing_base_skill,
             'srcMeta', z.src_meta, 'srcMap', z.src_map) FROM zones z WHERE z.id = s.zone_id),
          'npcs', (SELECT json_group_array(json_object('id', n.id, 'nameEn', n.name_en, 'nameDe', n.name_de, 'subName', n.sub_name,
             'levelMin', n.level_min, 'levelMax', n.level_max, 'rank', n.rank, 'classification', n.classification, 'creatureType', n.creature_type,
             'canSkin', n.can_skin, 'skinMin', n.skinning_skill_min, 'skinMax', n.skinning_skill_max, 'minCoin', n.min_coin, 'maxCoin', n.max_coin,
             'inClassic', n.in_classic, 'xpMult', n.xp_mult, 'srcCore', n.src_core, 'srcCombat', n.src_combat, 'spawns', sn.spawn_count,
             'loot', (SELECT json_group_array({LOOT_JSON}) FROM loot l JOIN items i ON i.id = l.item_id
                      WHERE l.source_type = 'npc' AND l.source_entity_id = n.id)))
             FROM spot_npcs sn JOIN npcs n ON n.id = sn.npc_id WHERE sn.spot_id = s.id),
          'objects', (SELECT json_group_array(json_object('id', o.id, 'nameEn', o.name_en, 'nameDe', o.name_de, 'nodeType', o.node_type,
             'requiredSkill', o.required_skill, 'skillSource', o.skill_source, 'srcCore', o.src_core, 'spawns', so.spawn_count,
             'loot', (SELECT json_group_array({LOOT_JSON}) FROM loot l JOIN items i ON i.id = l.item_id
                      WHERE l.source_type = 'object' AND l.source_entity_id = o.id)))
             FROM spot_objects so JOIN objects o ON o.id = so.object_id WHERE so.spot_id = s.id),
          'zoneLoot', CASE WHEN s.kind IN ('fishing_zone', 'fishing_pool') THEN (SELECT json_group_array({LOOT_JSON}) FROM loot l
             JOIN items i ON i.id = l.item_id WHERE l.source_type = 'zone' AND l.source_entity_id = s.zone_id) ELSE json('[]') END,
          'points', (SELECT json_group_array(json_array(p.entity_type, p.entity_id, p.x, p.y)) FROM spot_points p WHERE p.spot_id = s.id)
        ) FROM spots s WHERE s.id = ?1"
    );
    json_one(c, &sql, [id])
}

pub fn item_detail(c: &Connection, id: u32) -> AppResult<Option<Value>> {
    let sql = "SELECT json_object(
      'item', json_object('id', i.id, 'nameEn', i.name_en, 'nameDe', i.name_de, 'quality', i.quality, 'itemClass', i.item_class,
         'itemSubclass', i.item_subclass, 'itemLevel', i.item_level, 'requiredLevel', i.required_level, 'vendorSell', i.vendor_sell,
         'vendorBuy', i.vendor_buy, 'stackSize', i.stack_size, 'isCloth', i.is_cloth, 'inForever', i.in_forever, 'srcCore', i.src_core, 'srcEcon', i.src_econ),
      'npcSources', (SELECT json_group_array(x) FROM (SELECT json_object('npcId', n.id, 'nameEn', n.name_en, 'nameDe', n.name_de,
         'levelMin', n.level_min, 'levelMax', n.level_max, 'rank', n.rank, 'xpMult', n.xp_mult, 'zoneId', n.zone_id, 'context', l.context, 'rate', l.rate,
         'minQty', l.min_qty, 'maxQty', l.max_qty, 'sourceId', l.source_id, 'reliability', l.reliability,
         'spawns', (SELECT COUNT(*) FROM npc_spawns ns WHERE ns.npc_id = n.id)) AS x
         FROM loot l JOIN npcs n ON n.id = l.source_entity_id WHERE l.source_type = 'npc' AND l.item_id = i.id
         ORDER BY (l.rate IS NULL), l.rate DESC LIMIT 300)),
      'objectSources', (SELECT json_group_array(json_object('objectId', o.id, 'nameEn', o.name_en, 'nameDe', o.name_de, 'nodeType', o.node_type,
         'requiredSkill', o.required_skill, 'context', l.context, 'rate', l.rate, 'sourceId', l.source_id, 'reliability', l.reliability))
         FROM loot l JOIN objects o ON o.id = l.source_entity_id WHERE l.source_type = 'object' AND l.item_id = i.id),
      'zoneSources', (SELECT json_group_array(json_object('zoneId', z.id, 'nameEn', z.name_en, 'nameDe', z.name_de, 'context', l.context,
         'rate', l.rate, 'fishingBaseSkill', z.fishing_base_skill, 'sourceId', l.source_id, 'reliability', l.reliability))
         FROM loot l JOIN zones z ON z.id = l.source_entity_id WHERE l.source_type = 'zone' AND l.item_id = i.id),
      'vendors', (SELECT json_group_array(json_object('npcId', n.id, 'nameEn', n.name_en, 'nameDe', n.name_de, 'subName', n.sub_name,
         'zoneId', n.zone_id, 'friendlyTo', n.friendly_to, 'sourceId', v.source_id))
         FROM item_vendors v JOIN npcs n ON n.id = v.npc_id WHERE v.item_id = i.id),
      'spots', (SELECT json_group_array(x) FROM (SELECT json_object('spotId', s.id, 'titleDe', s.title_de, 'titleEn', s.title_en, 'kind', s.kind,
         'zoneId', s.zone_id, 'levelMin', s.level_min, 'levelMax', s.level_max, 'reqSkillType', s.req_skill_type, 'reqSkill', s.req_skill,
         'context', si.context, 'rate', si.rate, 'foreverConfirmed', si.forever_confirmed, 'hasElite', s.has_elite, 'isInstance', s.is_instance) AS x
         FROM spot_items si JOIN spots s ON s.id = si.spot_id WHERE si.item_id = i.id
         ORDER BY (si.rate IS NULL), si.rate DESC LIMIT 60))
    ) FROM items i WHERE i.id = ?1";
    json_one(c, sql, [id])
}

pub fn npc_detail(c: &Connection, id: u32) -> AppResult<Option<Value>> {
    let sql = format!(
        "SELECT json_object(
          'npc', json_object('id', n.id, 'nameEn', n.name_en, 'nameDe', n.name_de, 'subName', n.sub_name, 'levelMin', n.level_min,
             'levelMax', n.level_max, 'rank', n.rank, 'classification', n.classification, 'creatureType', n.creature_type, 'zoneId', n.zone_id,
             'friendlyTo', n.friendly_to, 'hostile', n.hostile, 'canSkin', n.can_skin, 'skinMin', n.skinning_skill_min, 'skinMax', n.skinning_skill_max,
             'minCoin', n.min_coin, 'maxCoin', n.max_coin, 'inClassic', n.in_classic, 'xpMult', n.xp_mult, 'srcCore', n.src_core, 'srcCombat', n.src_combat),
          'spawns', (SELECT json_group_array(json_array(ns.zone_id, ns.x, ns.y)) FROM npc_spawns ns WHERE ns.npc_id = n.id),
          'loot', (SELECT json_group_array({LOOT_JSON}) FROM loot l JOIN items i ON i.id = l.item_id WHERE l.source_type = 'npc' AND l.source_entity_id = n.id),
          'spots', (SELECT json_group_array(json_object('spotId', s.id, 'titleDe', s.title_de, 'titleEn', s.title_en, 'zoneId', s.zone_id, 'kind', s.kind))
             FROM spot_npcs sn JOIN spots s ON s.id = sn.spot_id WHERE sn.npc_id = n.id)
        ) FROM npcs n WHERE n.id = ?1"
    );
    json_one(c, &sql, [id])
}

/// FTS5 search over items, NPCs, zones and nodes in DE and EN. Input is tokenized and quoted (no FTS syntax injection).
pub fn search(c: &Connection, q: &str, kinds: Option<Vec<String>>, limit: u32) -> AppResult<Vec<Value>> {
    let q = q.trim();
    if q.is_empty() {
        return Ok(vec![]);
    }
    let limit = limit.clamp(1, 100);
    let kinds = kinds.unwrap_or_else(|| vec!["item".into(), "npc".into(), "zone".into(), "object".into()]);
    let kinds_json = serde_json::to_string(&kinds)?;
    if let Ok(id) = q.parse::<u32>() {
        return json_rows(
            c,
            "SELECT json_object('kind', kind, 'id', CAST(entity_id AS INTEGER), 'nameEn', name_en, 'nameDe', name_de) FROM search_fts
             WHERE entity_id = ?1 AND kind IN (SELECT value FROM json_each(?2)) LIMIT ?3",
            params![id, kinds_json, limit],
        );
    }
    let tokens: Vec<String> = q
        .split(|ch: char| !(ch.is_alphanumeric()))
        .filter(|t| !t.is_empty())
        .take(8)
        .map(|t| format!("\"{}\"*", t.replace('"', "")))
        .collect();
    if tokens.is_empty() {
        return Ok(vec![]);
    }
    let fts = tokens.join(" ");
    json_rows(
        c,
        "SELECT json_object('kind', kind, 'id', CAST(entity_id AS INTEGER), 'nameEn', name_en, 'nameDe', name_de) FROM search_fts
         WHERE search_fts MATCH ?1 AND kind IN (SELECT value FROM json_each(?2))
         ORDER BY CASE kind WHEN 'item' THEN 0 WHEN 'npc' THEN 1 WHEN 'object' THEN 2 ELSE 3 END, length(name_en), rank LIMIT ?3",
        params![fts, kinds_json, limit],
    )
}

pub fn zones(c: &Connection) -> AppResult<Vec<Value>> {
    json_rows(
        c,
        "SELECT json_object('id', z.id, 'uiMapId', z.ui_map_id, 'nameEn', z.name_en, 'nameDe', z.name_de, 'continent', z.continent, 'kind', z.kind,
           'control', z.control, 'levelMin', z.level_min, 'levelMax', z.level_max, 'fishingBaseSkill', z.fishing_base_skill,
           'spots', (SELECT COUNT(*) FROM spots s WHERE s.zone_id = z.id))
         FROM zones z ORDER BY z.continent, z.kind, z.name_de",
        [],
    )
}

pub fn zone_layer(c: &Connection, zone_id: u32) -> AppResult<Value> {
    let spots = json_rows(
        c,
        "SELECT json_object('id', s.id, 'kind', s.kind, 'titleDe', s.title_de, 'titleEn', s.title_en, 'levelMin', s.level_min, 'levelMax', s.level_max,
           'centerX', s.center_x, 'centerY', s.center_y, 'radius', s.radius, 'tags', json(s.tags), 'reqSkillType', s.req_skill_type, 'reqSkill', s.req_skill,
           'hasElite', s.has_elite, 'hasRare', s.has_rare)
         FROM spots s WHERE s.zone_id = ?1 AND s.center_x IS NOT NULL",
        [zone_id],
    )?;
    let nodes = json_rows(
        c,
        "SELECT json_object('objectId', o.id, 'nameEn', o.name_en, 'nameDe', o.name_de, 'nodeType', o.node_type, 'requiredSkill', o.required_skill,
           'points', json_group_array(json_array(os.x, os.y)))
         FROM object_spawns os JOIN objects o ON o.id = os.object_id WHERE os.zone_id = ?1 GROUP BY o.id",
        [zone_id],
    )?;
    let zone = json_one(
        c,
        "SELECT json_object('id', id, 'uiMapId', ui_map_id, 'nameEn', name_en, 'nameDe', name_de, 'kind', kind, 'control', control,
           'levelMin', level_min, 'levelMax', level_max, 'srcMap', src_map) FROM zones WHERE id = ?1",
        [zone_id],
    )?
    .ok_or_else(|| AppError::not_found(crate::i18n::tr("Zone nicht gefunden", "Zone not found")))?;
    Ok(serde_json::json!({ "zone": zone, "spots": spots, "nodes": nodes }))
}

pub fn sources(c: &Connection) -> AppResult<Vec<Value>> {
    json_rows(
        c,
        "SELECT json_object('id', id, 'name', name, 'url', url, 'license', license, 'version', version, 'retrievedAt', retrieved_at,
           'flavor', flavor, 'reliability', reliability, 'notes', notes) FROM sources",
        [],
    )
}

pub fn coverage(c: &Connection) -> AppResult<Value> {
    let rows = json_rows(c, "SELECT json_object('band', level_band, 'objective', objective, 'spots', spots) FROM coverage", [])?;
    let meta = json_rows(c, "SELECT json_object('key', key, 'value', value) FROM meta", [])?;
    let counts = json_one(
        c,
        "SELECT json_object('zones', (SELECT COUNT(*) FROM zones), 'npcs', (SELECT COUNT(*) FROM npcs), 'npcSpawns', (SELECT COUNT(*) FROM npc_spawns),
          'items', (SELECT COUNT(*) FROM items), 'objects', (SELECT COUNT(*) FROM objects), 'objectSpawns', (SELECT COUNT(*) FROM object_spawns),
          'loot', (SELECT COUNT(*) FROM loot), 'lootWithRate', (SELECT COUNT(*) FROM loot WHERE rate IS NOT NULL),
          'spots', (SELECT COUNT(*) FROM spots), 'curatedRoutes', (SELECT COUNT(*) FROM spots WHERE route_curated = 1),
          'generatedSpots', (SELECT COUNT(*) FROM spots WHERE generated = 1))",
        [],
    )?;
    Ok(serde_json::json!({ "bands": rows, "meta": meta, "counts": counts }))
}

/// Spawn density of all NPC and gathering-node spawns of a zone on a coarse grid (cols × rows over 0–100 %).
/// Used as a neutral base layer when no map image is imported: it shows where the zone has content, not terrain.
pub fn zone_density(c: &Connection, zone_id: u32, cols: usize, rows: usize) -> AppResult<Value> {
    let mut grid = vec![0u32; cols * rows];
    let mut st = c.prepare("SELECT x, y FROM npc_spawns WHERE zone_id = ?1 UNION ALL SELECT x, y FROM object_spawns WHERE zone_id = ?1")?;
    let mut total = 0u32;
    for p in st.query_map([zone_id], |r| Ok((r.get::<_, f64>(0)?, r.get::<_, f64>(1)?)))? {
        let (x, y) = p?;
        if !(0.0..=100.0).contains(&x) || !(0.0..=100.0).contains(&y) {
            continue;
        }
        let cx = ((x / 100.0) * cols as f64).min(cols as f64 - 1.0) as usize;
        let cy = ((y / 100.0) * rows as f64).min(rows as f64 - 1.0) as usize;
        grid[cy * cols + cx] += 1;
        total += 1;
    }
    Ok(serde_json::json!({ "zoneId": zone_id, "cols": cols, "rows": rows, "total": total, "max": grid.iter().max().copied().unwrap_or(0), "cells": grid }))
}


#[cfg(test)]
mod tests {
    use super::*;

    fn game() -> Connection {
        crate::db::open_game(&crate::db::test_seed_path()).expect("run `npm run data:build` first")
    }

    #[test]
    fn candidates_for_level_28_include_wetlands_raptors() {
        let c = game();
        let rows = spot_candidates(&c, &CandidateQuery { level: 28, below: 12, above: 5, zone_id: None, include_instances: false }).unwrap();
        assert!(rows.iter().any(|r| r["id"] == "mob:wetlands-mottled-scytheclaw"));
        assert!(rows.iter().all(|r| r["isInstance"] == 0));
    }

    #[test]
    fn spot_detail_has_points_and_separated_loot_contexts() {
        let c = game();
        let d = spot_detail(&c, "mob:wetlands-mottled-scytheclaw").unwrap().unwrap();
        assert!(d["points"].as_array().unwrap().len() >= 5);
        let loot = d["npcs"][0]["loot"].as_array().unwrap();
        assert!(loot.iter().any(|l| l["context"] == "skinning"));
        assert!(loot.iter().any(|l| l["context"] == "normal_kill"));
    }

    #[test]
    fn search_de_and_en_find_same_item() {
        let c = game();
        let de = search(&c, "Mittleres Leder", Some(vec!["item".into()]), 5).unwrap();
        let en = search(&c, "medium leather", Some(vec!["item".into()]), 5).unwrap();
        assert_eq!(de[0]["id"], 2319);
        assert_eq!(en[0]["id"], 2319);
        assert!(search(&c, "\"; DROP TABLE items; --", None, 5).is_ok(), "fts input is sanitized");
    }

    #[test]
    fn item_detail_lists_sources() {
        let c = game();
        let d = item_detail(&c, 4306).unwrap().unwrap();
        assert!(d["npcSources"].as_array().unwrap().len() > 10, "silk cloth has many sources");
    }
}
