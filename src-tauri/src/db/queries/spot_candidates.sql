-- Coarse pre-filter for the farm finder. Scoring/hard constraints happen in src/domain (TypeScript, tested).
-- Shared by the Rust command (db/game.rs) and the Vitest data tests (src/domain/profiles.data.test.ts).
SELECT json_object(
  'id', s.id, 'slug', s.slug, 'kind', s.kind, 'titleEn', s.title_en, 'titleDe', s.title_de, 'zoneId', s.zone_id,
  'zone', json_object('nameEn', z.name_en, 'nameDe', z.name_de, 'kind', z.kind, 'control', z.control, 'uiMapId', z.ui_map_id,
                      'levelMin', z.level_min, 'levelMax', z.level_max, 'fishingBaseSkill', z.fishing_base_skill),
  'levelMin', s.level_min, 'levelMax', s.level_max, 'centerX', s.center_x, 'centerY', s.center_y, 'radius', s.radius,
  'spawnCount', s.spawn_count, 'tags', json(s.tags), 'professions', json(s.professions),
  'hasElite', s.has_elite, 'hasRare', s.has_rare, 'isInstance', s.is_instance,
  'reqSkillType', s.req_skill_type, 'reqSkill', s.req_skill,
  'avgCoinCopper', s.avg_coin_copper, 'modelVendorCopperPerKill', s.model_vendor_copper_per_kill, 'modelVendorPartial', s.model_vendor_partial,
  'routeKind', s.route_kind, 'routeCurated', s.route_curated, 'generated', s.generated, 'srcCore', s.src_core,
  'npcs', (SELECT json_group_array(json_object('id', n.id, 'nameEn', n.name_en, 'nameDe', n.name_de, 'levelMin', n.level_min,
              'levelMax', n.level_max, 'rank', n.rank, 'canSkin', n.can_skin, 'skinMin', n.skinning_skill_min, 'skinMax', n.skinning_skill_max,
              'creatureType', n.creature_type, 'inClassic', n.in_classic, 'spawns', sn.spawn_count))
           FROM spot_npcs sn JOIN npcs n ON n.id = sn.npc_id WHERE sn.spot_id = s.id),
  'objects', (SELECT json_group_array(json_object('id', o.id, 'nameEn', o.name_en, 'nameDe', o.name_de, 'nodeType', o.node_type,
              'requiredSkill', o.required_skill, 'spawns', so.spawn_count))
           FROM spot_objects so JOIN objects o ON o.id = so.object_id WHERE so.spot_id = s.id),
  'items', (SELECT json_group_array(json_object('itemId', i.id, 'nameEn', i.name_en, 'nameDe', i.name_de, 'quality', i.quality,
              'context', si.context, 'rate', si.rate, 'foreverConfirmed', si.forever_confirmed, 'vendorSell', i.vendor_sell, 'isCloth', i.is_cloth))
           FROM (SELECT * FROM spot_items WHERE spot_id = s.id ORDER BY rank) si JOIN items i ON i.id = si.item_id)
) AS j
FROM spots s JOIN zones z ON z.id = s.zone_id
WHERE (s.kind IN ('node_zone', 'fishing_pool', 'fishing_zone')
       OR (s.level_min <= :level + :above AND s.level_max >= :level - :below))
  AND (:zone IS NULL OR s.zone_id = :zone)
  AND (:include_instances = 1 OR s.is_instance = 0)
