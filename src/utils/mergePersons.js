/**
 * Merge duplicateId into canonicalId.
 * All source evidence, kinship, and stone links from the duplicate migrate to the canonical.
 * The duplicate deceased row is deleted at the end.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} canonicalId  UUID of the record to keep
 * @param {string} duplicateId  UUID of the record to delete
 * @param {object} fieldOverrides  Field values to copy from duplicate onto canonical (admin-chosen)
 * @returns {{ ok: boolean, error: string|null, log: string[] }}
 */
export async function mergePersons(supabase, canonicalId, duplicateId, fieldOverrides = {}) {
  const log = []

  try {
    // Step 1: migrate deceased_sources rows
    const { data: dupSources, error: e1 } = await supabase
      .from('deceased_sources')
      .select('*')
      .eq('deceased_id', duplicateId)
    if (e1) throw new Error('Load deceased_sources: ' + e1.message)

    for (const src of (dupSources || [])) {
      const { deceased_source_id: _id, ...row } = src
      const { error } = await supabase
        .from('deceased_sources')
        .upsert({ ...row, deceased_id: canonicalId }, {
          onConflict: 'deceased_id,source_id,church_event_type,church_event_date_verbatim',
          ignoreDuplicates: true,
        })
      if (error) log.push(`Source row warning: ${error.message}`)
      else log.push(`Migrated source row from ${_id}`)
    }

    // Step 2: migrate stone_deceased links
    const [{ data: dupStones, error: e2 }, { data: canonStones, error: e3 }] = await Promise.all([
      supabase.from('stone_deceased').select('stone_id, role').eq('deceased_id', duplicateId),
      supabase.from('stone_deceased').select('stone_id').eq('deceased_id', canonicalId),
    ])
    if (e2) throw new Error('Load duplicate stone_deceased: ' + e2.message)
    if (e3) throw new Error('Load canonical stone_deceased: ' + e3.message)

    const canonStoneIds = new Set((canonStones || []).map(s => s.stone_id))
    for (const link of (dupStones || [])) {
      if (canonStoneIds.has(link.stone_id)) {
        log.push(`Stone ${link.stone_id} already linked to canonical — skipped`)
        continue
      }
      const { error } = await supabase
        .from('stone_deceased')
        .insert({ stone_id: link.stone_id, deceased_id: canonicalId, role: link.role })
      if (error) log.push(`Stone link warning: ${error.message}`)
      else log.push(`Migrated stone link ${link.stone_id}`)
    }

    // Step 3: migrate kinship rows
    const [{ data: primaryRows, error: e4 }, { data: relativeRows, error: e5 }] = await Promise.all([
      supabase.from('kinship').select('*').eq('primary_deceased_id', duplicateId),
      supabase.from('kinship').select('*').eq('relative_deceased_id', duplicateId),
    ])
    if (e4) throw new Error('Load primary kinship: ' + e4.message)
    if (e5) throw new Error('Load relative kinship: ' + e5.message)

    const { data: canonKinship, error: e6 } = await supabase
      .from('kinship')
      .select('primary_deceased_id, relative_deceased_id, relationship_type')
      .or(`primary_deceased_id.eq.${canonicalId},relative_deceased_id.eq.${canonicalId}`)
    if (e6) throw new Error('Load canonical kinship: ' + e6.message)

    const existingPairs = new Set(
      (canonKinship || []).map(k => `${k.primary_deceased_id}|${k.relative_deceased_id}|${k.relationship_type}`)
    )

    for (const row of (primaryRows || [])) {
      if (row.relative_deceased_id === canonicalId) {
        await supabase.from('kinship').delete().eq('kinship_id', row.kinship_id)
        log.push(`Deleted self-loop kinship ${row.kinship_id}`)
        continue
      }
      const key = `${canonicalId}|${row.relative_deceased_id}|${row.relationship_type}`
      if (existingPairs.has(key)) {
        await supabase.from('kinship').delete().eq('kinship_id', row.kinship_id)
        log.push(`Dropped duplicate kinship ${row.kinship_id} (canonical already has it)`)
        continue
      }
      const { error } = await supabase.from('kinship')
        .update({ primary_deceased_id: canonicalId })
        .eq('kinship_id', row.kinship_id)
      if (error) log.push(`Kinship update warning: ${error.message}`)
      else { existingPairs.add(key); log.push(`Re-pointed primary kinship ${row.kinship_id}`) }
    }

    for (const row of (relativeRows || [])) {
      if (row.primary_deceased_id === canonicalId) {
        await supabase.from('kinship').delete().eq('kinship_id', row.kinship_id)
        log.push(`Deleted self-loop kinship ${row.kinship_id}`)
        continue
      }
      const key = `${row.primary_deceased_id}|${canonicalId}|${row.relationship_type}`
      if (existingPairs.has(key)) {
        await supabase.from('kinship').delete().eq('kinship_id', row.kinship_id)
        log.push(`Dropped duplicate kinship ${row.kinship_id}`)
        continue
      }
      const { error } = await supabase.from('kinship')
        .update({ relative_deceased_id: canonicalId })
        .eq('kinship_id', row.kinship_id)
      if (error) log.push(`Kinship update warning: ${error.message}`)
      else { existingPairs.add(key); log.push(`Re-pointed relative kinship ${row.kinship_id}`) }
    }

    // Step 4: apply admin-chosen field overrides onto canonical
    if (Object.keys(fieldOverrides).length > 0) {
      const { error } = await supabase
        .from('deceased')
        .update(fieldOverrides)
        .eq('deceased_id', canonicalId)
      if (error) throw new Error('Apply field overrides: ' + error.message)
      log.push(`Applied field overrides: ${Object.keys(fieldOverrides).join(', ')}`)
    }

    // Step 5: delete the duplicate — CASCADE handles deceased_sources and stone_deceased
    const { error: e7 } = await supabase
      .from('deceased')
      .delete()
      .eq('deceased_id', duplicateId)
    if (e7) throw new Error('Delete duplicate: ' + e7.message)
    log.push(`Deleted duplicate deceased ${duplicateId}`)

    return { ok: true, error: null, log }
  } catch (err) {
    return { ok: false, error: err.message, log }
  }
}
