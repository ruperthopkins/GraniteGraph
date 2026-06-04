// src/admin/PersonView.jsx
// Granite Graph — Person Research & QA View
// Add to AdminHome tools list and App.js routing

import { useState, useCallback } from 'react'
import { supabase } from '../supabaseClient'
import { normaliseName, matchScoreDetails, fmtDate } from '../utils/nameNorm'
import { mergePersons } from '../utils/mergePersons'
import { REL_LABEL, INVERSE_REL } from '../constants'

const CONFIDENCE_LEVELS = ['confirmed', 'probable', 'possible', 'uncertain']

const PATRIOT_AFFILIATIONS = [
  { value: 'association_papers', label: 'Signed Association Papers', color: '#6ee7b7', bg: 'rgba(5,150,105,0.18)' },
  { value: 'ny_militia',         label: 'NY Militia',                color: '#6ee7b7', bg: 'rgba(5,150,105,0.18)' },
  { value: 'continental_army',   label: 'Continental Army',          color: '#6ee7b7', bg: 'rgba(5,150,105,0.18)' },
  { value: 'culper_ring',        label: 'Culper Ring',               color: '#93c5fd', bg: 'rgba(37,99,235,0.18)' },
  { value: 'loyalist',           label: 'Crown Loyalist',            color: '#fca5a5', bg: 'rgba(185,28,28,0.18)' },
]
const SOURCE_TYPES = ['stone_inscription', 'document', 'church_record', 'census', 'colonial_document', 'family_record', 'ai_extracted', 'volunteer', 'admin']
const SOURCE_LABEL = { stone_inscription: 'Stone inscription', document: 'Document', church_record: 'Church record', census: 'Census', colonial_document: 'Colonial document', family_record: 'Family record', ai_extracted: 'AI extracted', volunteer: 'Volunteer', admin: 'Admin' }

// ── Initials avatar ───────────────────────────────────────────────────────────
function Avatar({ name, size = 40, color = 'info' }) {
  const initials = (name || '??').split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase()
  const colors = {
    info: { bg: 'var(--color-background-info)', text: 'var(--color-text-info)' },
    success: { bg: 'var(--color-background-success)', text: 'var(--color-text-success)' },
    warning: { bg: 'var(--color-background-warning)', text: 'var(--color-text-warning)' },
    secondary: { bg: 'var(--color-background-secondary)', text: 'var(--color-text-secondary)' },
  }
  const c = colors[color] || colors.info
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: c.bg, color: c.text,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.3, fontWeight: 500,
    }}>{initials}</div>
  )
}

// ── Confidence badge ──────────────────────────────────────────────────────────
function ConfidenceBadge({ value }) {
  const map = {
    confirmed: 'var(--color-text-success)',
    probable: 'var(--color-text-info)',
    possible: 'var(--color-text-warning)',
    uncertain: 'var(--color-text-secondary)',
  }
  const color = map[value] || 'var(--color-text-secondary)'
  return (
    <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 99, border: `0.5px solid ${color}`, color, whiteSpace: 'nowrap' }}>
      {value}
    </span>
  )
}

// ── Source badge ──────────────────────────────────────────────────────────────
function SourceBadge({ value }) {
  const labels = {
    stone_inscription: 'stone', document: 'document', church_record: 'church',
    census: 'census', colonial_document: 'colonial doc', family_record: 'family record',
    ai_extracted: 'AI', genealogy_record: 'genealogy', volunteer: 'volunteer', admin: 'admin',
  }
  return (
    <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
      {labels[value] || value}
    </span>
  )
}

// ── Bibliographic source entry ────────────────────────────────────────────────
function SourceEntry({ dot, title, subtitle, ref_code, note }) {
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0, marginTop: 5 }} />
      <div>
        <p style={{ fontSize: 12, fontStyle: 'italic', margin: '0 0 1px', color: 'var(--color-text-primary)' }}>{title}</p>
        {subtitle && <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '0 0 1px' }}>{subtitle}</p>}
        {ref_code && <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '0 0 1px', fontFamily: 'monospace' }}>§ {ref_code}</p>}
        {note && <p style={{ fontSize: 11, color: 'var(--color-text-info)', margin: 0 }}>{note}</p>}
      </div>
    </div>
  )
}

// ── Tree person box ───────────────────────────────────────────────────────────
const TREE_COLORS = {
  focal:      { bg: 'var(--color-background-info,    rgba(37,99,235,0.18))',   border: '1.5px solid var(--color-border-info,    #3b82f6)', text: 'var(--color-text-info,    #93c5fd)', weight: 600 },
  ancestor:   { bg: 'var(--color-background-warning, rgba(180,83,9,0.15))',    border: '0.5px solid var(--color-border-warning, #d97706)', text: 'var(--color-text-warning, #fcd34d)', weight: 500 },
  descendant: { bg: 'var(--color-background-success, rgba(5,150,105,0.15))',   border: '0.5px solid var(--color-border-success, #10b981)', text: 'var(--color-text-success, #6ee7b7)', weight: 500 },
  spouse:     { bg: 'var(--color-background-secondary, rgba(88,28,135,0.15))', border: '0.5px solid var(--color-border-secondary,#7c3aed)', text: 'var(--color-text-secondary, #c4b5fd)', weight: 500 },
  sibling:    { bg: 'var(--color-background-primary,  rgba(30,41,59,0.6))',    border: '0.5px solid var(--color-border-tertiary, #475569)', text: 'var(--color-text-primary,   #e2e8f0)', weight: 500 },
}

function TreeBox({ person, isFocal = false, role = 'sibling', childCount = 0, onClick }) {
  if (!person) return null
  const baseName = person.full_name || [person.first_name, person.last_name].filter(Boolean).join(' ')
  const name = [person.title, baseName, person.generation_suffix].filter(Boolean).join(' ') || '?'
  const bYear = (person.date_of_birth_verbatim || '').match(/\b(1[5-9]\d{2}|20\d{2})\b/)?.[1]
  const dYear = (person.date_of_death_verbatim || '').match(/\b(1[5-9]\d{2}|20\d{2})\b/)?.[1]
  const c = TREE_COLORS[isFocal ? 'focal' : role] || TREE_COLORS.sibling
  return (
    <div onClick={isFocal ? undefined : onClick} title={isFocal ? name : `View ${name}`} style={{
      width: 124, padding: '7px 9px', borderRadius: 'var(--border-radius-md)', flexShrink: 0,
      border: c.border,
      background: c.bg,
      cursor: isFocal ? 'default' : 'pointer',
    }}>
      <p style={{ fontSize: 11, fontWeight: c.weight, margin: '0 0 2px', lineHeight: 1.3,
        color: c.text,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</p>
      {person.maiden_name && person.maiden_name !== person.last_name && (
        <p style={{ fontSize: 9, color: 'var(--color-text-secondary)', margin: '0 0 2px', lineHeight: 1,
          fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          née {person.maiden_name}
        </p>
      )}
      {(bYear || dYear) && (
        <p style={{ fontSize: 10, color: 'var(--color-text-secondary)', margin: '0 0 4px', lineHeight: 1 }}>
          {bYear && `b.${bYear}`}{bYear && dYear && ' '}{dYear && `d.${dYear}`}
        </p>
      )}
      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        {person.is_occupant && <span style={{ fontSize: 9, padding: '0 4px', borderRadius: 99, background: 'var(--color-background-success)', color: 'var(--color-text-success)', border: '0.5px solid var(--color-border-success)' }}>⬛</span>}
        {person.is_mentioned && <span style={{ fontSize: 9, padding: '0 4px', borderRadius: 99, background: 'var(--color-background-warning)', color: 'var(--color-text-warning)', border: '0.5px solid var(--color-border-warning)' }}>📝</span>}
        {childCount > 0 && <span style={{ fontSize: 9, padding: '0 4px', borderRadius: 99, background: 'var(--color-background-secondary)', color: 'var(--color-text-tertiary)', border: '0.5px solid var(--color-border-tertiary)' }}>{childCount}↓</span>}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function PersonView({ onBack }) {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState(null)       // full person record
  const [stoneLinks, setStoneLinks] = useState([])     // all stone_deceased rows with nested stone+photos
  const [kinship, setKinship] = useState([])           // relationships
  const [loading, setLoading] = useState(false)
  const [photoIndex, setPhotoIndex] = useState(0)      // current photo in carousel
  const [expandedPhoto, setExpandedPhoto] = useState(null) // full-screen URL
  const [deletingPhotoUrl, setDeletingPhotoUrl] = useState(null)
  const [togglingRole, setTogglingRole] = useState(null) // stone_id being toggled

  // Edit states
  const [editingPerson, setEditingPerson] = useState(false)
  const [editForm, setEditForm] = useState({})
  const [savingPerson, setSavingPerson] = useState(false)

  // Relationship edit/remove
  const [editingRelId, setEditingRelId] = useState(null)
  const [editRelForm, setEditRelForm] = useState({})
  const [removingRelId, setRemovingRelId] = useState(null)
  const [savingRel, setSavingRel] = useState(false)

  // Add relationship
  const [showAddRel, setShowAddRel] = useState(false)
  const [addRelSearch, setAddRelSearch] = useState('')
  const [addRelResults, setAddRelResults] = useState([])
  const [addRelSearched, setAddRelSearched] = useState(false)
  const [addRelForm, setAddRelForm] = useState({ relationship_type: 'child', confidence: 'probable', notes: '' })
  const [addRelTarget, setAddRelTarget] = useState(null)
  const [savingAddRel, setSavingAddRel] = useState(false)
  const [showCreateNew, setShowCreateNew] = useState(false)
  const [createNewForm, setCreateNewForm] = useState({ first_name: '', last_name: '', date_of_birth_verbatim: '', date_of_death_verbatim: '' })
  const [creatingNew, setCreatingNew] = useState(false)

  // Co-parent panel (shown after adding a spouse when focal person has children)
  const [coParentPanel, setCoParentPanel] = useState(null) // { spouse, children: kinship[] }
  const [coParentSelections, setCoParentSelections] = useState(new Set())
  const [coParentConfidence, setCoParentConfidence] = useState('probable')
  const [savingCoParents, setSavingCoParents] = useState(false)

  // Sources
  const [personSources, setPersonSources] = useState([])

  // Family tree
  const [treeGrandparents, setTreeGrandparents] = useState({})     // parentId → [person, ...]
  const [childDescendantCounts, setChildDescendantCounts] = useState({}) // childId → count
  const [spouseChildIds, setSpouseChildIds] = useState({})          // spouseId → Set<childId>
  const [derivedSiblings, setDerivedSiblings] = useState([])

  // Duplicate finder / merge
  const [dupCandidates, setDupCandidates]         = useState([])
  const [findingDups, setFindingDups]             = useState(false)
  const [mergeTarget, setMergeTarget]             = useState(null)
  const [mergeFieldChoices, setMergeFieldChoices] = useState({})
  const [merging, setMerging]                     = useState(false)
  const [mergeLog, setMergeLog]                   = useState(null)

  // ── Search ──────────────────────────────────────────────────────────────────
  const handleSearch = async () => {
    if (!searchQuery.trim()) return
    setSearching(true)
    setSearchResults(null)
    setSelected(null)
    const terms = searchQuery.trim().split(/[\s,]+/).filter(Boolean)
    let q = supabase.from('v_deceased_search').select('*')
    if (terms.length === 1) {
      q = q.or(`first_name.ilike.%${terms[0]}%,last_name.ilike.%${terms[0]}%,maiden_name.ilike.%${terms[0]}%`)
    } else {
      const last = terms[terms.length - 1]
      q = q.ilike('last_name', `%${last}%`)
      terms.slice(0, -1).forEach(t => {
        q = q.or(`first_name.ilike.%${t}%,middle_name.ilike.%${t}%,maiden_name.ilike.%${t}%`)
      })
    }
    const { data } = await q.order('last_name').order('first_name').limit(50)
    setSearchResults(data || [])
    setSearching(false)
  }

  // ── Load full person record ─────────────────────────────────────────────────
  const loadPerson = useCallback(async (record) => {
    setLoading(true)
    setSelected(null)
    setStoneLinks([])
    setPhotoIndex(0)
    setExpandedPhoto(null)
    setKinship([])
    setEditingPerson(false)
    setShowAddRel(false)
    setDupCandidates([])
    setMergeTarget(null)
    setMergeFieldChoices({})
    setMergeLog(null)
    setTreeGrandparents({})
    setChildDescendantCounts({})
    setSpouseChildIds({})
    setDerivedSiblings([])
    setPersonSources([])

    // Full deceased record
    const { data: person, error: personError } = await supabase
      .from('deceased')
      .select('*')
      .eq('deceased_id', record.deceased_id)
      .single()
    if (personError && personError.code !== 'PGRST116') {
      console.error('Error loading person:', personError)
    }
    setSelected(person || null)
    setEditForm(person || {})

    // All stone links (may appear on multiple stones as occupant or mentioned)
    // Note: stone_id omitted from top-level select — PostgREST shadows it when stones(stone_id,...) is also selected.
    // Use link.stones.stone_id throughout instead.
    const { data: sd, error: sdError } = await supabase
      .from('stone_deceased')
      .select('role, stones(stone_id, inscription_text, stone_condition, condition_notes, volunteer_notes, flags, stone_photos(*))')
      .eq('deceased_id', record.deceased_id)
      .order('role', { ascending: false }) // 'occupant' > 'mentioned' alphabetically
    if (sdError) console.error('Error loading stone data:', sdError)
    setStoneLinks(sd || [])
    setPhotoIndex(0)

    // Kinship
    const { data: kin } = await supabase
      .from('kinship')
      .select('*')
      .eq('primary_deceased_id', record.deceased_id)
      .order('relationship_type')
    if (kin && kin.length > 0) {
      const relativeIds = kin.map(k => k.relative_deceased_id)
      const { data: relatives } = await supabase
        .from('v_deceased_search')
        .select('*')
        .in('deceased_id', relativeIds)
      const relMap = {}
      ;(relatives || []).forEach(r => { relMap[r.deceased_id] = r })
      setKinship(kin.filter(k => k.relative_deceased_id !== record.deceased_id).map(k => ({ ...k, relative: relMap[k.relative_deceased_id] || null })))
    } else {
      setKinship([])
    }

    // Tree: load grandparents, child descendant counts, spouse→children map, and siblings in parallel
    const validKin = (kin || []).filter(k => k.relative_deceased_id !== record.deceased_id)
    const parentIds = validKin.filter(k => k.relationship_type === 'child').map(k => k.relative_deceased_id)
    const childIds  = validKin.filter(k => k.relationship_type === 'parent').map(k => k.relative_deceased_id)
    const spouseIds = validKin.filter(k => k.relationship_type === 'spouse').map(k => k.relative_deceased_id)
    const [gpRows, ccRows, scRows, sibRows] = await Promise.all([
      parentIds.length > 0
        ? supabase.from('kinship').select('primary_deceased_id, relative_deceased_id')
            .in('primary_deceased_id', parentIds).eq('relationship_type', 'child')
        : { data: [] },
      childIds.length > 0
        ? supabase.from('kinship').select('primary_deceased_id')
            .in('primary_deceased_id', childIds).eq('relationship_type', 'parent')
        : { data: [] },
      spouseIds.length > 0
        ? supabase.from('kinship').select('primary_deceased_id, relative_deceased_id')
            .in('primary_deceased_id', spouseIds).eq('relationship_type', 'parent')
        : { data: [] },
      parentIds.length > 0
        ? supabase.from('kinship').select('relative_deceased_id')
            .in('primary_deceased_id', parentIds).eq('relationship_type', 'parent')
            .neq('relative_deceased_id', record.deceased_id)
        : { data: [] },
    ])
    const gpMap = {}
    const gpIds = [...new Set((gpRows.data || []).map(k => k.relative_deceased_id))]
    if (gpIds.length > 0) {
      const { data: gpRecs } = await supabase.from('v_deceased_search').select('*').in('deceased_id', gpIds)
      const gpLookup = {}
      ;(gpRecs || []).forEach(r => { gpLookup[r.deceased_id] = r })
      ;(gpRows.data || []).forEach(k => {
        if (!gpMap[k.primary_deceased_id]) gpMap[k.primary_deceased_id] = []
        const gp = gpLookup[k.relative_deceased_id]
        if (gp) gpMap[k.primary_deceased_id].push(gp)
      })
    }
    setTreeGrandparents(gpMap)
    const childCountMap = {}
    ;(ccRows.data || []).forEach(k => {
      childCountMap[k.primary_deceased_id] = (childCountMap[k.primary_deceased_id] || 0) + 1
    })
    setChildDescendantCounts(childCountMap)
    const scMap = {}
    ;(scRows.data || []).forEach(k => {
      if (!scMap[k.primary_deceased_id]) scMap[k.primary_deceased_id] = new Set()
      scMap[k.primary_deceased_id].add(k.relative_deceased_id)
    })
    setSpouseChildIds(scMap)
    const sibIds = [...new Set((sibRows.data || []).map(k => k.relative_deceased_id))]
    if (sibIds.length > 0) {
      const { data: sibRecs } = await supabase.from('v_deceased_search').select('*').in('deceased_id', sibIds)
      setDerivedSiblings(sibRecs || [])
    } else {
      setDerivedSiblings([])
    }

    // Sources: fetch deceased_sources rows, then fetch source records separately
    // (avoids PostgREST schema cache issues with recently-added columns)
    const { data: srcLinks } = await supabase
      .from('deceased_sources')
      .select('deceased_source_id, source_id, source_type, church_event_type, church_event_date_verbatim')
      .eq('deceased_id', record.deceased_id)

    // Collect unique source IDs — deceased_sources rows + deceased.source_id as fallback
    const sourceIds = [...new Set([
      ...(srcLinks || []).map(l => l.source_id),
      ...(person?.source_id ? [person.source_id] : []),
    ])]
    let sourceMap = {}
    if (sourceIds.length > 0) {
      const { data: sourceRecs } = await supabase
        .from('sources')
        .select('source_id, title, author, date_range, reliability')
        .in('source_id', sourceIds)
      ;(sourceRecs || []).forEach(s => { sourceMap[s.source_id] = s })
    }

    // If no deceased_sources rows, fall back to the primary source on the deceased record
    const mergedSources = srcLinks && srcLinks.length > 0
      ? srcLinks.map(l => ({ ...l, sources: sourceMap[l.source_id] || null }))
      : person?.source_id
        ? [{ deceased_source_id: 'primary', source_type: null, church_event_type: null, church_event_date_verbatim: null, sources: sourceMap[person.source_id] || null }]
        : []
    setPersonSources(mergedSources)

    setLoading(false)
  }, [])

  // ── Save person edits ───────────────────────────────────────────────────────
  const savePerson = async () => {
    setSavingPerson(true)
    const { error } = await supabase
      .from('deceased')
      .update({
        title: editForm.title || null,
        first_name: editForm.first_name,
        middle_name: editForm.middle_name,
        last_name: editForm.last_name,
        generation_suffix: editForm.generation_suffix || null,
        maiden_name: editForm.maiden_name,
        date_of_birth_verbatim: editForm.date_of_birth_verbatim,
        date_of_death_verbatim: editForm.date_of_death_verbatim,
        patriot_affiliations: editForm.patriot_affiliations || [],
        notes: editForm.notes,
        biography: editForm.biography,
      })
      .eq('deceased_id', selected.deceased_id)
    if (error) { alert('Save failed: ' + error.message) }
    else {
      const { data: refreshed } = await supabase.from('deceased').select('*').eq('deceased_id', selected.deceased_id).single()
      setSelected(refreshed || { ...selected, ...editForm })
      setEditForm(refreshed || { ...selected, ...editForm })
      setEditingPerson(false)
    }
    setSavingPerson(false)
  }

  // ── Save relationship edit ──────────────────────────────────────────────────
  const saveRel = async (kinshipId) => {
    setSavingRel(true)
    const { error } = await supabase
      .from('kinship')
      .update({ confidence: editRelForm.confidence, notes: editRelForm.notes, source: editRelForm.source })
      .eq('kinship_id', kinshipId)
    if (error) { alert('Save failed: ' + error.message) }
    else {
      setKinship(prev => prev.map(k => k.kinship_id === kinshipId ? { ...k, ...editRelForm } : k))
      setEditingRelId(null)
    }
    setSavingRel(false)
  }

  // ── Remove relationship ─────────────────────────────────────────────────────
  const removeRel = async (kinshipId) => {
    const row = kinship.find(k => k.kinship_id === kinshipId)
    const { error } = await supabase.from('kinship').delete().eq('kinship_id', kinshipId)
    if (error) { alert('Remove failed: ' + error.message); setRemovingRelId(null); return }
    // Delete the inverse row to avoid orphaning one direction of the bidirectional pair
    if (row) {
      const inverseType = INVERSE_REL[row.relationship_type] || row.relationship_type
      await supabase.from('kinship').delete()
        .eq('primary_deceased_id', row.relative_deceased_id)
        .eq('relative_deceased_id', row.primary_deceased_id)
        .eq('relationship_type', inverseType)
    }
    setKinship(prev => prev.filter(k => k.kinship_id !== kinshipId))
    setRemovingRelId(null)
  }

  // ── Search for add-relationship target ──────────────────────────────────────
  const searchForRel = async () => {
    if (!addRelSearch.trim()) return
    const terms = addRelSearch.trim().split(/[\s,]+/).filter(Boolean)
    let q = supabase.from('v_deceased_search').select('*')
    if (terms.length === 1) {
      q = q.or(`first_name.ilike.*${terms[0]}*,last_name.ilike.*${terms[0]}*,maiden_name.ilike.*${terms[0]}*`)
    } else {
      const lastName = terms[terms.length - 1]
      const firstTerms = terms.slice(0, -1)
      q = q.ilike('last_name', `%${lastName}%`)
      firstTerms.forEach(term => { q = q.or(`first_name.ilike.%${term}%,middle_name.ilike.%${term}%,maiden_name.ilike.%${term}%`) })
    }
    const { data } = await q.order('last_name').order('first_name').limit(20)
    setAddRelResults(data || [])
    setAddRelSearched(true)
    // Pre-fill create-new form from search terms
    const parts = addRelSearch.trim().split(/[\s,]+/).filter(Boolean)
    if (parts.length >= 2) setCreateNewForm(p => ({ ...p, first_name: parts.slice(0, -1).join(' '), last_name: parts[parts.length - 1] }))
    else setCreateNewForm(p => ({ ...p, last_name: parts[0] || '' }))
  }

  const createNewForRel = async () => {
    if (!createNewForm.first_name.trim() || !createNewForm.last_name.trim()) return
    setCreatingNew(true)
    const { data, error } = await supabase.from('deceased').insert({
      first_name: createNewForm.first_name.trim(),
      last_name: createNewForm.last_name.trim(),
      date_of_birth_verbatim: createNewForm.date_of_birth_verbatim.trim() || null,
      date_of_death_verbatim: createNewForm.date_of_death_verbatim.trim() || null,
      cemetery_id: 'd8bd1f88-cdde-4ef2-a448-5ab04d2d8107',
    }).select('*').single()
    setCreatingNew(false)
    if (error) { alert('Error creating record: ' + error.message); return }
    setAddRelTarget({ ...data, full_name: [data.first_name, data.last_name].filter(Boolean).join(' ') })
    setShowCreateNew(false)
  }

  // ── Photo management ────────────────────────────────────────────────────────
  const makePrimary = async (photo) => {
    const { stone_id, id: photoId, photo_url } = photo
    // Clear all primary flags for this stone, then set the chosen one
    await supabase.from('stone_photos').update({ is_primary: false }).eq('stone_id', stone_id)
    const identifier = photoId ? { id: photoId } : { photo_url }
    await supabase.from('stone_photos').update({ is_primary: true }).match(identifier)
    await refreshStoneLinks(selected.deceased_id)
  }

  const deletePhoto = async (photo) => {
    if (!window.confirm('Delete this photo? This cannot be undone.')) return
    setDeletingPhotoUrl(photo.photo_url)
    const identifier = photo.id ? { id: photo.id } : { photo_url: photo.photo_url }
    await supabase.from('stone_photos').delete().match(identifier)
    await refreshStoneLinks(selected.deceased_id)
    setPhotoIndex(0)
    setDeletingPhotoUrl(null)
  }

  const refreshStoneLinks = async (deceasedId) => {
    const { data: sd } = await supabase
      .from('stone_deceased')
      .select('role, stones(stone_id, inscription_text, stone_condition, condition_notes, volunteer_notes, flags, stone_photos(*))')
      .eq('deceased_id', deceasedId)
      .order('role', { ascending: false })
    setStoneLinks(sd || [])
  }

  const toggleRole = async (link) => {
    const stoneId = link.stones?.stone_id
    if (!stoneId) { alert('Cannot toggle role: stone ID missing.'); return }
    const newRole = link.role === 'occupant' ? 'mentioned' : 'occupant'
    if (newRole === 'mentioned' && kinship.length === 0) {
      if (!window.confirm('Switching to "Mentioned" requires a relationship to be recorded. Continue and add a relationship after?')) return
    }
    setTogglingRole(stoneId)
    const { data: { session } } = await supabase.auth.getSession()
    const resp = await fetch('/api/toggle-role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
      body: JSON.stringify({ stone_id: stoneId, deceased_id: selected.deceased_id, role: newRole }),
    })
    if (!resp.ok) {
      const { error } = await resp.json().catch(() => ({}))
      alert('Could not update role: ' + (error || resp.statusText))
      setTogglingRole(null)
      return
    }
    // If promoting to occupant, make that stone's first photo primary
    if (newRole === 'occupant' && link.stones?.stone_photos?.length > 0) {
      const firstPhoto = link.stones.stone_photos[0]
      await supabase.from('stone_photos').update({ is_primary: false }).neq('stone_id', stoneId)
      await supabase.from('stone_photos').update({ is_primary: true })
        .match(firstPhoto.id ? { id: firstPhoto.id } : { photo_url: firstPhoto.photo_url })
    }
    await refreshStoneLinks(selected.deceased_id)
    setTogglingRole(null)
  }

  // ── Add relationship ────────────────────────────────────────────────────────
  const addRel = async () => {
    if (!addRelTarget) return
    setSavingAddRel(true)
    const rows = [
      {
        primary_deceased_id: selected.deceased_id,
        relative_deceased_id: addRelTarget.deceased_id,
        relationship_type: addRelForm.relationship_type,
        confidence: addRelForm.confidence,
        notes: addRelForm.notes,
        source: 'admin',
      },
      {
        primary_deceased_id: addRelTarget.deceased_id,
        relative_deceased_id: selected.deceased_id,
        relationship_type: INVERSE_REL[addRelForm.relationship_type] || 'unknown',
        confidence: addRelForm.confidence,
        notes: addRelForm.notes,
        source: 'admin',
      },
    ]
    const { error } = await supabase.from('kinship').insert(rows)
    if (error) {
      if (error.code === '23505') {
        alert('A relationship with this person already exists — it may be stored with inverted direction. Check the list below and remove the incorrect entry before re-adding.')
      } else {
        alert('Add failed: ' + error.message)
      }
    }
    else {
      const childrenBeforeReload = addRelForm.relationship_type === 'spouse'
        ? kinship.filter(k => k.relationship_type === 'parent')
        : []
      await loadPerson(selected)
      setShowAddRel(false)
      setAddRelTarget(null)
      setAddRelSearch('')
      setAddRelResults([])
      if (childrenBeforeReload.length > 0) {
        setCoParentPanel({ spouse: addRelTarget, children: childrenBeforeReload })
        setCoParentSelections(new Set(childrenBeforeReload.map(r => r.relative_deceased_id)))
        setCoParentConfidence('probable')
      }
    }
    setSavingAddRel(false)
  }

  // ── Link co-parents ─────────────────────────────────────────────────────────
  const saveCoParents = async () => {
    if (!coParentPanel) return
    setSavingCoParents(true)
    const selectedChildren = coParentPanel.children.filter(r => coParentSelections.has(r.relative_deceased_id))
    if (selectedChildren.length > 0) {
      const note = `Co-parent linked via spouse of ${selected.first_name} ${selected.last_name}`
      const rows = selectedChildren.flatMap(r => [
        {
          primary_deceased_id: coParentPanel.spouse.deceased_id,
          relative_deceased_id: r.relative_deceased_id,
          relationship_type: 'parent',
          confidence: coParentConfidence,
          notes: note,
          source: 'admin',
        },
        {
          primary_deceased_id: r.relative_deceased_id,
          relative_deceased_id: coParentPanel.spouse.deceased_id,
          relationship_type: 'child',
          confidence: coParentConfidence,
          notes: note,
          source: 'admin',
        },
      ])
      const { error } = await supabase.from('kinship').insert(rows)
      if (error) {
        if (error.code === '23505') {
          alert('Some relationships already existed and were skipped. Check individual child records.')
        } else {
          alert('Error linking co-parents: ' + error.message)
          setSavingCoParents(false)
          return
        }
      }
    }
    setCoParentPanel(null)
    setCoParentSelections(new Set())
    setSavingCoParents(false)
  }

  // ── Duplicate finder ────────────────────────────────────────────────────────
  const findDuplicates = async (person) => {
    setFindingDups(true)
    setDupCandidates([])
    setMergeTarget(null)
    setMergeFieldChoices({})
    setMergeLog(null)
    const norm = normaliseName(person)
    // Include full_name fallback so records imported without separate first/last fields
    // (e.g. original Seaview cemetery data) are still found by the query.
    const lastName = norm.last_name
    const maidenName = norm.maiden_name
    const filters = [
      `last_name.ilike.%${lastName}%`,
      `maiden_name.ilike.%${lastName}%`,
      `full_name.ilike.%${lastName}%`,
    ]
    if (maidenName) {
      filters.push(`last_name.ilike.%${maidenName}%`)
      filters.push(`full_name.ilike.%${maidenName}%`)
    }
    const { data, error } = await supabase
      .from('v_deceased_search')
      .select('*')
      .or(filters.join(','))
      .neq('deceased_id', person.deceased_id)
      .limit(300)
    if (error) {
      setDupCandidates([{ _error: error.message }])
      setFindingDups(false)
      return
    }
    const all = (data || []).map(r => {
      const { score, reasons } = matchScoreDetails(person, r)
      return { record: r, score, reasons }
    })
    // Always show top 10 sorted by score; confidence label set in render.
    // Showing below-threshold results lets users review low-confidence matches
    // and diagnose scoring issues.
    const sorted = all.sort((a, b) => b.score - a.score).slice(0, 10)
    setDupCandidates(sorted.length > 0 ? sorted : [])
    setFindingDups(false)
  }

  const confirmMerge = async () => {
    setMerging(true)
    const fieldOverrides = {}
    for (const [field, useFromDup] of Object.entries(mergeFieldChoices)) {
      if (useFromDup) fieldOverrides[field] = mergeTarget[field]
    }
    const result = await mergePersons(supabase, selected.deceased_id, mergeTarget.deceased_id, fieldOverrides)
    setMergeLog(result.log)
    if (result.ok) {
      setMergeTarget(null)
      setMergeFieldChoices({})
      await loadPerson(selected)
    } else {
      alert('Merge failed: ' + result.error)
    }
    setMerging(false)
  }

  // ── Derived ─────────────────────────────────────────────────────────────────
  const birthYearOf = rel => {
    const m = (rel.relative?.date_of_birth_verbatim || '').match(/\b(1[0-9]\d{2}|20\d{2})\b/)
    return m ? parseInt(m[1]) : 9999
  }
  const sortByBirth = arr => [...arr].sort((a, b) => birthYearOf(a) - birthYearOf(b))
  const grouped = {
    parent:  sortByBirth(kinship.filter(k => k.relationship_type === 'parent')),
    spouse:  kinship.filter(k => k.relationship_type === 'spouse'),
    child:   sortByBirth(kinship.filter(k => k.relationship_type === 'child')),
    sibling: sortByBirth(kinship.filter(k => k.relationship_type === 'sibling')),
    unknown: kinship.filter(k => k.relationship_type === 'unknown'),
  }

  // Flatten all photos across all stones, occupant stones first, primary photos first within each
  const allPhotos = stoneLinks.flatMap(link =>
    (link.stones?.stone_photos || [])
      .sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0))
      .map(p => ({ ...p, stone_id: link.stones.stone_id, role: link.role }))
  )
  const stoneData = stoneLinks.find(l => l.role === 'occupant')?.stones || stoneLinks[0]?.stones || null
  const currentPhoto = allPhotos[photoIndex] || null

  const MERGE_FIELDS = [
    { key: 'first_name', label: 'first name' },
    { key: 'middle_name', label: 'middle name' },
    { key: 'last_name', label: 'last name' },
    { key: 'maiden_name', label: 'maiden name' },
    { key: 'date_of_birth_verbatim', label: 'birth date' },
    { key: 'date_of_death_verbatim', label: 'death date' },
    { key: 'church_event_type', label: 'church event type' },
    { key: 'church_event_date_verbatim', label: 'church event date' },
    { key: 'notes', label: 'notes' },
    { key: 'biography', label: 'biography' },
  ]
  const diffFields = mergeTarget
    ? MERGE_FIELDS.filter(({ key }) => {
        const a = (selected[key] || '').toString().trim()
        const b = (mergeTarget[key] || '').toString().trim()
        return a !== b && (a !== '' || b !== '')
      })
    : []

  // ── Styles ──────────────────────────────────────────────────────────────────
  const card = {
    background: 'var(--color-background-primary)',
    border: '0.5px solid var(--color-border-tertiary)',
    borderRadius: 'var(--border-radius-lg)',
    padding: '1rem 1.25rem',
  }
  const fieldLabel = { fontSize: 11, color: 'var(--color-text-secondary)', margin: '0 0 2px', fontWeight: 500 }
  const fieldValue = { fontSize: 13, color: 'var(--color-text-primary)', margin: 0 }
  const sectionLabel = {
    fontSize: 11, color: 'var(--color-text-tertiary)', margin: '0 0 8px',
    textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 500,
  }

  // ── RENDER ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-background-tertiary)', padding: '1rem' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 500, margin: '0 0 2px' }}>Person research &amp; QA</h1>
            <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: 0 }}>Search, review, and curate community records</p>
          </div>
          {onBack && <button onClick={onBack}>← Admin</button>}
        </div>

        {/* Search bar */}
        <div style={{ ...card, marginBottom: '1rem', display: 'flex', gap: 8 }}>
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder="Search by name — e.g. Samuel Hopkins, or just Hopkins"
            style={{ flex: 1 }}
            autoFocus
          />
          <button onClick={handleSearch} disabled={searching}>
            {searching ? 'Searching…' : 'Search'}
          </button>
          {selected && (
            <button onClick={() => { setSelected(null); setSearchResults(null); setSearchQuery('') }}>
              Clear
            </button>
          )}
        </div>

        {/* Search results */}
        {searchResults && !selected && (
          <div style={{ ...card, marginBottom: '1rem' }}>
            <p style={{ ...sectionLabel, marginBottom: 12 }}>{searchResults.length} result{searchResults.length !== 1 ? 's' : ''}</p>
            {searchResults.length === 0 && (
              <p style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>No records found.</p>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 400, overflowY: 'auto' }}>
              {searchResults.map(r => (
                <div key={r.deceased_id} onClick={() => loadPerson(r)}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 'var(--border-radius-md)', border: '0.5px solid var(--color-border-tertiary)', cursor: 'pointer', background: 'var(--color-background-secondary)' }}>
                  <Avatar name={r.full_name} size={36} color={r.is_photographed ? 'success' : 'secondary'} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontWeight: 500, fontSize: 14, margin: 0 }}>{r.full_name}</p>
                    <div style={{ display: 'flex', gap: 12, marginTop: 2 }}>
                      {r.date_of_birth_verbatim && <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>b. {fmtDate(r.date_of_birth_verbatim, r.date_of_birth_parsed)}</span>}
                      {r.date_of_death_verbatim && <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>d. {fmtDate(r.date_of_death_verbatim, r.date_of_death_parsed)}</span>}
                      {r.maiden_name && <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>nee {r.maiden_name}</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
                    {r.is_occupant && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: 'var(--color-background-success)', color: 'var(--color-text-success)', border: '0.5px solid var(--color-border-success)' }}>⬛ buried</span>}
                    {r.is_mentioned && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: 'var(--color-background-warning)', color: 'var(--color-text-warning)', border: '0.5px solid var(--color-border-warning)' }}>📝 mentioned</span>}
                    {r.stone_count > 0 && <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>{r.stone_count} stone{r.stone_count !== 1 ? 's' : ''}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div style={{ ...card, textAlign: 'center', padding: '2rem' }}>
            <p style={{ color: 'var(--color-text-secondary)', fontSize: 14 }}>Loading record…</p>
          </div>
        )}

        {/* Main two-column view */}
        {selected && !loading && (
          <div style={{ display: 'grid', gridTemplateColumns: '280px minmax(0, 1fr)', gap: '1rem', alignItems: 'start' }}>

            {/* ── LEFT COLUMN ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

              {/* Stone photos + role management */}
              <div style={card}>
                {/* Expanded photo modal */}
                {expandedPhoto && (
                  <div onClick={() => setExpandedPhoto(null)}
                    style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out' }}>
                    <img src={expandedPhoto} alt="Expanded" style={{ maxWidth: '95vw', maxHeight: '95vh', objectFit: 'contain', borderRadius: 'var(--border-radius-md)' }} />
                  </div>
                )}

                {allPhotos.length > 0 ? (
                  <>
                    {/* Main photo display */}
                    <div style={{ position: 'relative', marginBottom: 8 }}>
                      <img
                        src={currentPhoto.photo_url} alt="Gravestone"
                        onClick={() => setExpandedPhoto(currentPhoto.photo_url)}
                        style={{ width: '100%', borderRadius: 'var(--border-radius-md)', display: 'block', cursor: 'zoom-in' }}
                      />
                      {/* Role badge on photo */}
                      <span style={{
                        position: 'absolute', top: 8, left: 8, fontSize: 11, padding: '2px 8px',
                        borderRadius: 99, fontWeight: 600,
                        background: currentPhoto.role === 'occupant' ? 'var(--color-background-success)' : 'var(--color-background-warning)',
                        color: currentPhoto.role === 'occupant' ? 'var(--color-text-success)' : 'var(--color-text-warning)',
                        border: currentPhoto.role === 'occupant' ? '0.5px solid var(--color-border-success)' : '0.5px solid var(--color-border-warning)',
                      }}>
                        {currentPhoto.role === 'occupant' ? '⬛ Buried' : '📝 Mentioned'}
                      </span>
                      {currentPhoto.is_primary && currentPhoto.role === 'occupant' && (
                        <span style={{ position: 'absolute', top: 8, right: 8, fontSize: 11, padding: '2px 8px', borderRadius: 99, background: 'rgba(0,0,0,0.6)', color: '#fff' }}>
                          ★ Primary
                        </span>
                      )}
                    </div>

                    {/* Photo actions */}
                    <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
                      {(!currentPhoto.is_primary || currentPhoto.role !== 'occupant') && (
                        <button onClick={() => makePrimary(currentPhoto)} style={{ fontSize: 11 }}>★ Make primary</button>
                      )}
                      <button
                        onClick={() => deletePhoto(currentPhoto)}
                        disabled={deletingPhotoUrl === currentPhoto.photo_url}
                        style={{ fontSize: 11, color: 'var(--color-text-danger, #dc2626)' }}>
                        {deletingPhotoUrl === currentPhoto.photo_url ? 'Deleting…' : 'Delete photo'}
                      </button>
                    </div>

                    {/* Thumbnail carousel (only if >1 photo) */}
                    {allPhotos.length > 1 && (
                      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, marginBottom: 10 }}>
                        {allPhotos.map((p, i) => (
                          <div key={p.photo_url} onClick={() => setPhotoIndex(i)} style={{
                            flexShrink: 0, width: 56, height: 56, borderRadius: 'var(--border-radius-sm)',
                            overflow: 'hidden', cursor: 'pointer',
                            border: i === photoIndex ? '2px solid var(--color-border-info)' : '2px solid transparent',
                            opacity: i === photoIndex ? 1 : 0.6,
                          }}>
                            <img src={p.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ width: '100%', aspectRatio: '3/4', background: 'var(--color-background-secondary)', borderRadius: 'var(--border-radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
                    <span style={{ fontSize: 13, color: 'var(--color-text-tertiary)' }}>no photo</span>
                  </div>
                )}

                {/* Stone links — inscription, condition, role toggle */}
                {stoneLinks.map(link => (
                  <div key={link.stones?.stone_id} style={{ marginBottom: 12 }}>
                    {link.stones?.inscription_text && (
                      <>
                        <p style={{ ...sectionLabel }}>Inscription</p>
                        <p style={{ fontSize: 12, fontFamily: 'var(--font-mono)', lineHeight: 1.7, margin: '0 0 8px', background: 'var(--color-background-secondary)', padding: '8px 10px', borderRadius: 'var(--border-radius-md)', color: 'var(--color-text-primary)' }}>
                          {link.stones.inscription_text}
                        </p>
                      </>
                    )}
                    {link.stones?.volunteer_notes && (
                      <>
                        <p style={{ ...sectionLabel }}>Field notes</p>
                        <p style={{ fontSize: 12, lineHeight: 1.6, margin: '0 0 8px', background: 'var(--color-background-secondary)', padding: '8px 10px', borderRadius: 'var(--border-radius-md)', color: 'var(--color-text-primary)', fontStyle: 'italic' }}>
                          {link.stones.volunteer_notes}
                        </p>
                      </>
                    )}
                    {link.stones?.flags?.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
                        {link.stones.flags.map(flag => (
                          <span key={flag} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: 'var(--color-background-warning)', color: 'var(--color-text-warning)', border: '0.5px solid var(--color-border-warning)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            ⚑ {flag}
                          </span>
                        ))}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      {/* Role toggle */}
                      <button
                        onClick={() => toggleRole(link)}
                        disabled={togglingRole === link.stones?.stone_id}
                        style={{
                          fontSize: 11, padding: '2px 10px', borderRadius: 99, fontWeight: 600, cursor: 'pointer',
                          background: link.role === 'occupant' ? 'var(--color-background-success)' : 'var(--color-background-warning)',
                          color: link.role === 'occupant' ? 'var(--color-text-success)' : 'var(--color-text-warning)',
                          border: link.role === 'occupant' ? '0.5px solid var(--color-border-success)' : '0.5px solid var(--color-border-warning)',
                        }}>
                        {togglingRole === link.stones?.stone_id ? '…' : link.role === 'occupant' ? '⬛ Buried — click to mark Mentioned' : '📝 Mentioned — click to mark Buried'}
                      </button>
                      {link.stones?.stone_condition && (
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: 'var(--color-background-secondary)', color: 'var(--color-text-secondary)', border: '0.5px solid var(--color-border-tertiary)' }}>
                          {link.stones.stone_condition}
                          {link.stones.condition_notes ? ` — ${link.stones.condition_notes}` : ''}
                        </span>
                      )}
                    </div>
                  </div>
                ))}

                {stoneLinks.length === 0 && (
                  <div style={{ background: 'var(--color-background-secondary)', borderRadius: 'var(--border-radius-md)', padding: '10px 12px' }}>
                    <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-warning)', margin: '0 0 4px' }}>Kin reference — no stone at this cemetery</p>
                    <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: 0 }}>This person was named in a kinship relationship but has no cataloged stone here. They may be buried elsewhere.</p>
                  </div>
                )}
              </div>

              {/* Sources panel */}
              <div style={card}>
                <p style={sectionLabel}>Sources</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {stoneData && (
                    <SourceEntry
                      dot="var(--color-text-success)"
                      title="Gravestone inscription"
                      subtitle="Field catalog — Seaview Cemetery"
                      ref_code={null}
                    />
                  )}
                  {personSources.map(link => (
                    <SourceEntry
                      key={link.deceased_source_id}
                      dot="var(--color-text-info)"
                      title={link.sources?.title || 'Unknown source'}
                      subtitle={[link.sources?.author, link.sources?.date_range].filter(Boolean).join(' · ')}
                      ref_code={selected.mallmann_ref || selected.white_ref || null}
                      note={link.church_event_type ? `${link.church_event_type}${link.church_event_date_verbatim ? ' · ' + link.church_event_date_verbatim : ''}` : null}
                    />
                  ))}
                  {personSources.length === 0 && !stoneData && (
                    <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', margin: 0 }}>No sources recorded</p>
                  )}
                </div>
              </div>

            </div>

            {/* ── RIGHT COLUMN ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

              {/* Person identity card */}
              <div style={card}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <Avatar name={selected.first_name + ' ' + selected.last_name} size={48} color="info" />
                    <div>
                      <p style={{ fontWeight: 500, fontSize: 20, margin: 0 }}>
                        {selected.title && <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--color-text-secondary,#94a3b8)', marginRight: 6 }}>{selected.title}</span>}
                        {[selected.first_name, selected.middle_name, selected.last_name].filter(Boolean).join(' ')}
                        {selected.generation_suffix && <span style={{ fontSize: 15, fontWeight: 400, color: 'var(--color-text-secondary,#94a3b8)' }}> {selected.generation_suffix}</span>}
                        {selected.maiden_name && selected.maiden_name !== selected.last_name &&
                          <span style={{ fontSize: 15, fontWeight: 400, color: 'var(--color-text-secondary,#94a3b8)' }}> (née {selected.maiden_name})</span>}
                      </p>
                      <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: 0 }}>
                        {[selected.date_of_birth_verbatim && 'b. ' + fmtDate(selected.date_of_birth_verbatim, selected.date_of_birth_parsed),
                          selected.date_of_death_verbatim && 'd. ' + fmtDate(selected.date_of_death_verbatim, selected.date_of_death_parsed)]
                          .filter(Boolean).join('  ·  ')}
                      </p>
                      {selected.card_number && (
                        <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', margin: '2px 0 0' }}>Card #{selected.card_number}</p>
                      )}
                    </div>
                  </div>
                  {!editingPerson ? (
                    <button onClick={() => { setEditingPerson(true); setEditForm({ ...selected }) }}>Edit</button>
                  ) : (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={savePerson} disabled={savingPerson}>{savingPerson ? 'Saving…' : 'Save'}</button>
                      <button onClick={() => setEditingPerson(false)}>Cancel</button>
                    </div>
                  )}
                </div>

                {editingPerson ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: '0.5px solid var(--color-border-tertiary)', paddingTop: 14 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr 1fr 80px', gap: 8 }}>
                      <div>
                        <p style={fieldLabel}>title</p>
                        <input value={editForm.title || ''} onChange={e => setEditForm(p => ({ ...p, title: e.target.value }))} placeholder="Judge, Capt…" />
                      </div>
                      {['first_name', 'middle_name', 'last_name'].map(f => (
                        <div key={f}>
                          <p style={fieldLabel}>{f.replace('_', ' ')}</p>
                          <input value={editForm[f] || ''} onChange={e => setEditForm(p => ({ ...p, [f]: e.target.value }))} />
                        </div>
                      ))}
                      <div>
                        <p style={fieldLabel}>suffix</p>
                        <input value={editForm.generation_suffix || ''} onChange={e => setEditForm(p => ({ ...p, generation_suffix: e.target.value }))} placeholder="II, III…" />
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                      <div>
                        <p style={fieldLabel}>maiden name</p>
                        <input value={editForm.maiden_name || ''} onChange={e => setEditForm(p => ({ ...p, maiden_name: e.target.value }))} />
                      </div>
                      <div>
                        <p style={fieldLabel}>birth date</p>
                        <input value={editForm.date_of_birth_verbatim || ''} onChange={e => setEditForm(p => ({ ...p, date_of_birth_verbatim: e.target.value }))} />
                      </div>
                      <div>
                        <p style={fieldLabel}>death date</p>
                        <input value={editForm.date_of_death_verbatim || ''} onChange={e => setEditForm(p => ({ ...p, date_of_death_verbatim: e.target.value }))} />
                      </div>
                    </div>
                    <div>
                      <p style={fieldLabel}>patriot affiliations</p>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                        {PATRIOT_AFFILIATIONS.map(a => {
                          const checked = (editForm.patriot_affiliations || []).includes(a.value)
                          return (
                            <label key={a.value} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer',
                              fontSize: 12, padding: '3px 10px', borderRadius: 99,
                              border: `0.5px solid ${checked ? a.color : 'var(--color-border-tertiary,#475569)'}`,
                              background: checked ? a.bg : 'transparent',
                              color: checked ? a.color : 'var(--color-text-secondary,#94a3b8)',
                            }}>
                              <input type="checkbox" checked={checked} style={{ display: 'none' }}
                                onChange={e => setEditForm(p => ({
                                  ...p,
                                  patriot_affiliations: e.target.checked
                                    ? [...(p.patriot_affiliations || []), a.value]
                                    : (p.patriot_affiliations || []).filter(v => v !== a.value)
                                }))} />
                              {a.label}
                            </label>
                          )
                        })}
                      </div>
                    </div>
                    <div>
                      <p style={fieldLabel}>notes</p>
                      <textarea value={editForm.notes || ''} onChange={e => setEditForm(p => ({ ...p, notes: e.target.value }))}
                        style={{ width: '100%', minHeight: 60, resize: 'vertical', boxSizing: 'border-box' }} />
                    </div>
                    <div>
                      <p style={fieldLabel}>biography</p>
                      <textarea value={editForm.biography || ''} onChange={e => setEditForm(p => ({ ...p, biography: e.target.value }))}
                        style={{ width: '100%', minHeight: 80, resize: 'vertical', boxSizing: 'border-box' }} />
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, borderTop: '0.5px solid var(--color-border-tertiary)', paddingTop: 14 }}>
                    {selected.maiden_name && (
                      <div>
                        <p style={fieldLabel}>maiden name</p>
                        <p style={fieldValue}>{selected.maiden_name}</p>
                      </div>
                    )}
                    {selected.church_event_type && (
                      <div>
                        <p style={fieldLabel}>church event</p>
                        <p style={fieldValue}>{selected.church_event_type}{selected.church_event_date_verbatim ? ' — ' + selected.church_event_date_verbatim : ''}</p>
                      </div>
                    )}
                    {selected.patriot_affiliations?.length > 0 && (
                      <div style={{ gridColumn: '1 / -1' }}>
                        <p style={fieldLabel}>patriot affiliations</p>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                          {selected.patriot_affiliations.map(v => {
                            const a = PATRIOT_AFFILIATIONS.find(x => x.value === v)
                            return (
                              <span key={v} style={{ fontSize: 12, padding: '2px 10px', borderRadius: 99,
                                border: `0.5px solid ${a?.color || '#94a3b8'}`,
                                background: a?.bg || 'transparent',
                                color: a?.color || '#94a3b8',
                              }}>{a?.label || v}</span>
                            )
                          })}
                        </div>
                      </div>
                    )}
                    {selected.biography && (
                      <div style={{ gridColumn: '1 / -1' }}>
                        <p style={fieldLabel}>biography</p>
                        <p style={{ ...fieldValue, lineHeight: 1.6 }}>{selected.biography}</p>
                      </div>
                    )}
                    {!selected.maiden_name && !selected.church_event_type && !selected.biography && (
                      <p style={{ fontSize: 13, color: 'var(--color-text-tertiary)', margin: 0, gridColumn: '1 / -1' }}>No additional details recorded.</p>
                    )}
                    <div style={{ gridColumn: '1 / -1' }}>
                      <p style={fieldLabel}>notes</p>
                      <p style={{ ...fieldValue, color: selected.notes ? undefined : 'var(--color-text-tertiary)', fontStyle: selected.notes ? 'normal' : 'italic' }}>
                        {selected.notes || 'No notes — click Edit to add'}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Family tree */}
              <div style={card}>
                <p style={sectionLabel}>Family tree</p>
                {kinship.length === 0 ? (
                  <p style={{ fontSize: 13, color: 'var(--color-text-tertiary)', textAlign: 'center', margin: 0 }}>No family connections recorded.</p>
                ) : (
                  <div>
                    {/* Grandparents */}
                    {Object.keys(treeGrandparents).length > 0 && (<>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
                        {kinship.filter(k => k.relationship_type === 'child').map((rel, i) => {
                          const gps = treeGrandparents[rel.relative_deceased_id] || []
                          if (gps.length === 0) return null
                          return (
                            <div key={rel.relative_deceased_id} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                              {i > 0 && <div style={{ width: 1, background: 'var(--color-border-tertiary)', alignSelf: 'stretch', margin: '4px 2px' }} />}
                              {gps.map(gp => <TreeBox key={gp.deceased_id} person={gp} role="ancestor" onClick={() => loadPerson(gp)} />)}
                            </div>
                          )
                        })}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'center', height: 14 }}>
                        <div style={{ width: 1, background: 'var(--color-border-tertiary)' }} />
                      </div>
                    </>)}

                    {/* Parents */}
                    {kinship.filter(k => k.relationship_type === 'child').length > 0 && (<>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
                        {kinship.filter(k => k.relationship_type === 'child').map(rel => (
                          <TreeBox key={rel.relative_deceased_id} person={rel.relative} role="ancestor" onClick={() => rel.relative && loadPerson(rel.relative)} />
                        ))}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'center', height: 14 }}>
                        <div style={{ width: 1, background: 'var(--color-border-tertiary)' }} />
                      </div>
                    </>)}

                    {/* Focal person + spouses */}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center' }}>
                      <TreeBox isFocal person={{
                        ...selected,
                        full_name: [selected.first_name, selected.middle_name, selected.last_name].filter(Boolean).join(' '),
                        is_occupant: stoneLinks.some(l => l.role === 'occupant'),
                        is_mentioned: stoneLinks.some(l => l.role === 'mentioned'),
                      }} />
                      {kinship.filter(k => k.relationship_type === 'spouse').map((rel, i) => (<>
                        {i === 0 && <span key="dash" style={{ fontSize: 14, color: 'var(--color-text-tertiary)' }}>—</span>}
                        <TreeBox key={rel.relative_deceased_id} person={rel.relative} role="spouse" onClick={() => rel.relative && loadPerson(rel.relative)} />
                      </>))}
                    </div>

                    {/* Children — grouped by spouse if spouse→child data available */}
                    {kinship.filter(k => k.relationship_type === 'parent').length > 0 && (() => {
                      const children = kinship.filter(k => k.relationship_type === 'parent')
                      const spouses = kinship.filter(k => k.relationship_type === 'spouse')
                      const hasGrouping = spouses.some(s => spouseChildIds[s.relative_deceased_id]?.size > 0)
                      // Build groups: one per spouse (with children), then unattributed
                      const attributed = new Set()
                      const groups = spouses
                        .map(s => {
                          const ids = spouseChildIds[s.relative_deceased_id] || new Set()
                          const sortedKids = [...children].sort((a, b) => (a.relative?.date_of_birth_parsed || '').localeCompare(b.relative?.date_of_birth_parsed || ''))
                          const kids = sortedKids.filter(c => ids.has(c.relative_deceased_id))
                          kids.forEach(c => attributed.add(c.relative_deceased_id))
                          return { spouse: s.relative, kids }
                        })
                        .filter(g => g.kids.length > 0)
                      const unattributed = children.filter(c => !attributed.has(c.relative_deceased_id))
                      return (<>
                        <div style={{ display: 'flex', justifyContent: 'center', height: 14 }}>
                          <div style={{ width: 1, background: 'var(--color-border-tertiary)' }} />
                        </div>
                        {hasGrouping ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
                            {groups.map(g => (
                              <div key={g.spouse?.deceased_id || 'unattr'}>
                                {g.spouse && <p style={{ fontSize: 10, color: 'var(--color-text-tertiary)', textAlign: 'center', margin: '0 0 4px' }}>
                                  with {g.spouse.first_name} {g.spouse.maiden_name ? `(née ${g.spouse.maiden_name})` : g.spouse.last_name}
                                </p>}
                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
                                  {g.kids.map(rel => (
                                    <TreeBox key={rel.relative_deceased_id} person={rel.relative}
                                      role="descendant"
                                      childCount={childDescendantCounts[rel.relative_deceased_id] || 0}
                                      onClick={() => rel.relative && loadPerson(rel.relative)} />
                                  ))}
                                </div>
                              </div>
                            ))}
                            {unattributed.length > 0 && (
                              <div>
                                <p style={{ fontSize: 10, color: 'var(--color-text-tertiary)', textAlign: 'center', margin: '0 0 4px' }}>mother unknown</p>
                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
                                  {unattributed.map(rel => (
                                    <TreeBox key={rel.relative_deceased_id} person={rel.relative}
                                      role="descendant"
                                      childCount={childDescendantCounts[rel.relative_deceased_id] || 0}
                                      onClick={() => rel.relative && loadPerson(rel.relative)} />
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
                            {children.map(rel => (
                              <TreeBox key={rel.relative_deceased_id} person={rel.relative}
                                role="descendant"
                                childCount={childDescendantCounts[rel.relative_deceased_id] || 0}
                                onClick={() => rel.relative && loadPerson(rel.relative)} />
                            ))}
                          </div>
                        )}
                      </>)
                    })()}

                    {/* Siblings — derived from shared parents */}
                    {derivedSiblings.length > 0 && (<>
                      <div style={{ marginTop: 10, marginBottom: 4, textAlign: 'center' }}>
                        <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>siblings ({derivedSiblings.length})</span>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
                        {[...derivedSiblings].sort((a, b) => (a.date_of_birth_parsed || '').localeCompare(b.date_of_birth_parsed || '')).map(sib => (
                          <TreeBox key={sib.deceased_id} person={sib}
                            role="sibling"
                            childCount={childDescendantCounts[sib.deceased_id] || 0}
                            onClick={() => loadPerson(sib)} />
                        ))}
                      </div>
                    </>)}
                  </div>
                )}
              </div>

              {/* Family connections */}
              <div style={card}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <p style={sectionLabel}>Family connections ({kinship.length})</p>
                  <button onClick={() => { setShowAddRel(!showAddRel); setAddRelTarget(null); setAddRelResults([]); setAddRelSearch(''); setAddRelSearched(false); setShowCreateNew(false); setCreateNewForm({ first_name: '', last_name: '', date_of_birth_verbatim: '', date_of_death_verbatim: '' }) }}>
                    {showAddRel ? 'Cancel' : '+ Add relationship'}
                  </button>
                </div>

                {/* Add relationship panel */}
                {showAddRel && (
                  <div style={{ background: 'var(--color-background-secondary)', borderRadius: 'var(--border-radius-md)', padding: '12px 14px', marginBottom: 16, border: '0.5px solid var(--color-border-secondary)' }}>

                    {/* Step 1: relationship type (always visible) */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                      <div>
                        <p style={fieldLabel}>{selected.first_name} is…</p>
                        <select value={addRelForm.relationship_type} onChange={e => setAddRelForm(p => ({ ...p, relationship_type: e.target.value }))}>
                          <option value="child">child of</option>
                          <option value="parent">parent of</option>
                          <option value="spouse">spouse of</option>
                          <option value="sibling">sibling of</option>
                          <option value="unknown">unknown relation of</option>
                        </select>
                      </div>
                      <div>
                        <p style={fieldLabel}>confidence</p>
                        <select value={addRelForm.confidence} onChange={e => setAddRelForm(p => ({ ...p, confidence: e.target.value }))}>
                          {CONFIDENCE_LEVELS.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                    </div>

                    {/* Step 2: search or pick target */}
                    {!addRelTarget ? (
                      <>
                        <p style={{ ...fieldLabel, marginBottom: 6 }}>Search for person</p>
                        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                          <input value={addRelSearch} onChange={e => { setAddRelSearch(e.target.value); setAddRelSearched(false) }}
                            onKeyDown={e => e.key === 'Enter' && searchForRel()}
                            placeholder="First Last or Last, First…" style={{ flex: 1 }} />
                          <button onClick={searchForRel}>Search</button>
                        </div>
                        {addRelResults.length > 0 && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflowY: 'auto', marginBottom: 8 }}>
                            {addRelResults.map(r => (
                              <div key={r.deceased_id} onClick={() => setAddRelTarget(r)}
                                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', borderRadius: 'var(--border-radius-md)', border: '0.5px solid var(--color-border-tertiary)', cursor: 'pointer', background: 'var(--color-background-primary)' }}>
                                <div>
                                  <p style={{ fontSize: 13, margin: 0, fontWeight: 500 }}>{r.full_name}</p>
                                  <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: 0 }}>
                                    {[r.date_of_birth_verbatim && 'b. ' + fmtDate(r.date_of_birth_verbatim, r.date_of_birth_parsed), r.date_of_death_verbatim && 'd. ' + fmtDate(r.date_of_death_verbatim, r.date_of_death_parsed)].filter(Boolean).join(' · ')}
                                  </p>
                                </div>
                                <div style={{ display: 'flex', gap: 4 }}>
                                  {r.is_occupant && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 99, background: 'var(--color-background-success)', color: 'var(--color-text-success)', border: '0.5px solid var(--color-border-success)' }}>⬛ buried</span>}
                                  {r.is_mentioned && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 99, background: 'var(--color-background-warning)', color: 'var(--color-text-warning)', border: '0.5px solid var(--color-border-warning)' }}>📝 mentioned</span>}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        {addRelSearched && addRelResults.length === 0 && (
                          <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginBottom: 8 }}>No results found.</p>
                        )}
                        {addRelSearched && !showCreateNew && (
                          <button onClick={() => setShowCreateNew(true)} style={{ fontSize: 12, marginBottom: 8 }}>
                            + Create new record{addRelSearch.trim() ? ` for "${addRelSearch.trim()}"` : ''}
                          </button>
                        )}
                        {showCreateNew && (
                          <div style={{ borderTop: '0.5px solid var(--color-border-tertiary)', paddingTop: 10, marginTop: 4 }}>
                            <p style={{ ...fieldLabel, marginBottom: 8 }}>New person record</p>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                              <div>
                                <p style={fieldLabel}>first name *</p>
                                <input value={createNewForm.first_name} onChange={e => setCreateNewForm(p => ({ ...p, first_name: e.target.value }))} />
                              </div>
                              <div>
                                <p style={fieldLabel}>last name *</p>
                                <input value={createNewForm.last_name} onChange={e => setCreateNewForm(p => ({ ...p, last_name: e.target.value }))} />
                              </div>
                              <div>
                                <p style={fieldLabel}>birth date</p>
                                <input value={createNewForm.date_of_birth_verbatim} onChange={e => setCreateNewForm(p => ({ ...p, date_of_birth_verbatim: e.target.value }))} placeholder="as inscribed" />
                              </div>
                              <div>
                                <p style={fieldLabel}>death date</p>
                                <input value={createNewForm.date_of_death_verbatim} onChange={e => setCreateNewForm(p => ({ ...p, date_of_death_verbatim: e.target.value }))} placeholder="as inscribed" />
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button onClick={createNewForRel} disabled={creatingNew || !createNewForm.first_name.trim() || !createNewForm.last_name.trim()}>
                                {creatingNew ? 'Creating…' : 'Create & select'}
                              </button>
                              <button onClick={() => setShowCreateNew(false)}>Cancel</button>
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      /* Step 3: confirm with selected target */
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--color-background-info)', borderRadius: 'var(--border-radius-md)', marginBottom: 10 }}>
                          <Avatar name={addRelTarget.full_name} size={28} color="info" />
                          <p style={{ fontSize: 13, margin: 0, fontWeight: 500, color: 'var(--color-text-info)' }}>{addRelTarget.full_name}</p>
                          <button onClick={() => { setAddRelTarget(null); setShowCreateNew(false) }} style={{ marginLeft: 'auto', fontSize: 11 }}>change</button>
                        </div>
                        <div style={{ marginBottom: 10 }}>
                          <p style={fieldLabel}>notes (evidence)</p>
                          <input value={addRelForm.notes} onChange={e => setAddRelForm(p => ({ ...p, notes: e.target.value }))}
                            placeholder="e.g. Son of per stone inscription" />
                        </div>
                        <button onClick={addRel} disabled={savingAddRel}>
                          {savingAddRel ? 'Adding…' : `Add — ${selected.first_name} is ${REL_LABEL[addRelForm.relationship_type]?.toLowerCase() || addRelForm.relationship_type} ${addRelTarget.first_name}`}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {kinship.length === 0 && !showAddRel && (
                  <p style={{ fontSize: 13, color: 'var(--color-text-tertiary)' }}>No relationships recorded yet.</p>
                )}

                {/* Relationship groups */}
                {['child', 'spouse', 'parent', 'sibling', 'unknown'].map(relType => {
                  const group = grouped[relType]
                  if (group.length === 0) return null
                  return (
                    <div key={relType} style={{ marginBottom: 16 }}>
                      <p style={sectionLabel}>{relType === 'parent' ? `children (${group.length})` : relType === 'child' ? `parents (${group.length})` : relType === 'spouse' ? 'spouse(s)' : relType + 's'}</p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {group.map(rel => {
                          const isEditing = editingRelId === rel.kinship_id
                          const isRemoving = removingRelId === rel.kinship_id
                          const relative = rel.relative
                          const isDuplicate = group.filter(r => r.relative?.full_name === relative?.full_name).length > 1

                          return (
                            <div key={rel.kinship_id} style={{
                              padding: '10px 12px',
                              borderRadius: 'var(--border-radius-md)',
                              border: isDuplicate
                                ? '0.5px solid var(--color-border-warning)'
                                : '0.5px solid var(--color-border-tertiary)',
                              background: isDuplicate
                                ? 'var(--color-background-warning)'
                                : 'var(--color-background-secondary)',
                            }}>
                              {isRemoving ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                  <p style={{ fontSize: 13, margin: 0, flex: 1, color: 'var(--color-text-danger)' }}>
                                    Remove relationship with {relative?.full_name}?
                                  </p>
                                  <button onClick={() => removeRel(rel.kinship_id)} style={{ color: 'var(--color-text-danger)', fontSize: 12 }}>Yes, remove</button>
                                  <button onClick={() => setRemovingRelId(null)} style={{ fontSize: 12 }}>Cancel</button>
                                </div>
                              ) : isEditing ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <Avatar name={relative?.full_name} size={28} color="secondary" />
                                    <p style={{ fontWeight: 500, fontSize: 13, margin: 0 }}>{relative?.full_name}</p>
                                  </div>
                                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                    <div>
                                      <p style={fieldLabel}>confidence</p>
                                      <select value={editRelForm.confidence || rel.confidence}
                                        onChange={e => setEditRelForm(p => ({ ...p, confidence: e.target.value }))}>
                                        {CONFIDENCE_LEVELS.map(t => <option key={t} value={t}>{t}</option>)}
                                      </select>
                                    </div>
                                    <div>
                                      <p style={fieldLabel}>source</p>
                                      <select value={editRelForm.source || rel.source}
                                        onChange={e => setEditRelForm(p => ({ ...p, source: e.target.value }))}>
                                        {SOURCE_TYPES.map(t => <option key={t} value={t}>{SOURCE_LABEL[t] || t}</option>)}
                                      </select>
                                    </div>
                                  </div>
                                  <div>
                                    <p style={fieldLabel}>notes</p>
                                    <input value={editRelForm.notes !== undefined ? editRelForm.notes : (rel.notes || '')}
                                      onChange={e => setEditRelForm(p => ({ ...p, notes: e.target.value }))} />
                                  </div>
                                  <div style={{ display: 'flex', gap: 6 }}>
                                    <button onClick={() => saveRel(rel.kinship_id)} disabled={savingRel}>{savingRel ? 'Saving…' : 'Save'}</button>
                                    <button onClick={() => setEditingRelId(null)}>Cancel</button>
                                  </div>
                                </div>
                              ) : (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                  <Avatar name={relative?.full_name} size={30}
                                    color={isDuplicate ? 'warning' : relative?.is_occupant ? 'success' : relative?.is_mentioned ? 'warning' : 'secondary'} />
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                      <p style={{ fontWeight: 500, fontSize: 13, margin: 0 }}>
                                        {relative?.full_name || '(unmatched)'}
                                        {relative?.maiden_name && relative.maiden_name !== relative.last_name &&
                                          <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--color-text-secondary)' }}> (née {relative.maiden_name})</span>}
                                      </p>
                                      {isDuplicate && (
                                        <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 99, background: 'var(--color-background-warning)', color: 'var(--color-text-warning)', border: '0.5px solid var(--color-border-warning)' }}>
                                          duplicate — review
                                        </span>
                                      )}
                                    </div>
                                    <div style={{ display: 'flex', gap: 8, marginTop: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                                      {relative?.date_of_birth_verbatim && <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>b. {relative.date_of_birth_verbatim}</span>}
                                      {relative?.date_of_death_verbatim && <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>d. {relative.date_of_death_verbatim}</span>}
                                      {relative?.is_occupant && <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 99, background: 'var(--color-background-success)', color: 'var(--color-text-success)', border: '0.5px solid var(--color-border-success)' }}>⬛</span>}
                                      {relative?.is_mentioned && <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 99, background: 'var(--color-background-warning)', color: 'var(--color-text-warning)', border: '0.5px solid var(--color-border-warning)' }}>📝</span>}
                                      <ConfidenceBadge value={rel.confidence} />
                                      <SourceBadge value={rel.source} />
                                    </div>
                                    {rel.notes && <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '2px 0 0' }}>{rel.notes}</p>}
                                  </div>
                                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                                    {relative && (
                                      <button onClick={() => loadPerson(relative)} style={{ fontSize: 11, padding: '2px 8px' }}>view</button>
                                    )}
                                    <button onClick={() => { setEditingRelId(rel.kinship_id); setEditRelForm({ confidence: rel.confidence, notes: rel.notes || '', source: rel.source }) }}
                                      style={{ fontSize: 11, padding: '2px 8px' }}>edit</button>
                                    <button onClick={() => setRemovingRelId(rel.kinship_id)}
                                      style={{ fontSize: 11, padding: '2px 8px', color: 'var(--color-text-danger)' }}>remove</button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Co-parent linking panel */}
              {coParentPanel && (() => {
                const spouseName = coParentPanel.spouse.full_name ||
                  [coParentPanel.spouse.first_name, coParentPanel.spouse.last_name].filter(Boolean).join(' ')
                const spouseBY = parseInt((coParentPanel.spouse.date_of_birth_verbatim || '').match(/\b(1[0-9]\d{2}|20\d{2})\b/)?.[1])
                const spouseDY = parseInt((coParentPanel.spouse.date_of_death_verbatim || '').match(/\b(1[0-9]\d{2}|20\d{2})\b/)?.[1])
                return (
                  <div style={{ ...card, border: '0.5px solid var(--color-border-info)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <p style={sectionLabel}>Link co-parent relationships</p>
                      <button onClick={() => setCoParentPanel(null)} style={{ fontSize: 12 }}>Skip</button>
                    </div>
                    <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '0 0 12px' }}>
                      Select which of <strong>{selected.first_name}</strong>'s children to also link as children of <strong>{spouseName}</strong>.
                      Date indicators show plausibility — use your judgement.
                    </p>
                    <div style={{ marginBottom: 12 }}>
                      <p style={fieldLabel}>confidence for all selected</p>
                      <select value={coParentConfidence} onChange={e => setCoParentConfidence(e.target.value)}>
                        {CONFIDENCE_LEVELS.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 14 }}>
                      {coParentPanel.children.map(rel => {
                        const child = rel.relative
                        const childBY = parseInt((child?.date_of_birth_verbatim || '').match(/\b(1[0-9]\d{2}|20\d{2})\b/)?.[1])
                        let plausibility = 'unknown'
                        if (childBY && spouseBY) {
                          const gap = childBY - spouseBY
                          if (gap < 0) plausibility = 'impossible'        // child older than potential parent
                          else if (gap < 13) plausibility = 'warn'        // parent younger than 13
                          else plausibility = 'ok'
                        }
                        if (plausibility === 'ok' && childBY && spouseDY && childBY > spouseDY + 1) {
                          plausibility = 'impossible'                      // born >1yr after parent died
                        }
                        const icon = { impossible: '✗', warn: '⚠', ok: '✓', unknown: '?' }[plausibility]
                        const iconColor = {
                          impossible: 'var(--color-text-danger)',
                          warn: 'var(--color-text-warning)',
                          ok: 'var(--color-text-success)',
                          unknown: 'var(--color-text-tertiary)',
                        }[plausibility]
                        const hint = {
                          impossible: childBY && spouseDY && childBY > spouseDY + 1
                            ? `born ${childBY}, ${spouseName.split(' ')[0]} died ${spouseDY}`
                            : `child b.${childBY} older than ${spouseName.split(' ')[0]} b.${spouseBY}`,
                          warn: `${spouseName.split(' ')[0]} only ${childBY - spouseBY} yrs old`,
                          ok: '',
                          unknown: 'insufficient dates',
                        }[plausibility]
                        const isChecked = coParentSelections.has(rel.relative_deceased_id)
                        return (
                          <label key={rel.kinship_id} style={{
                            display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                            borderRadius: 'var(--border-radius-md)', cursor: 'pointer',
                            border: `0.5px solid ${plausibility === 'impossible' ? 'var(--color-border-danger)' : 'var(--color-border-tertiary)'}`,
                            background: plausibility === 'impossible' ? 'var(--color-background-danger)' : 'var(--color-background-secondary)',
                            opacity: plausibility === 'impossible' ? 0.7 : 1,
                          }}>
                            <input type="checkbox" checked={isChecked}
                              onChange={e => setCoParentSelections(prev => {
                                const next = new Set(prev)
                                if (e.target.checked) next.add(rel.relative_deceased_id)
                                else next.delete(rel.relative_deceased_id)
                                return next
                              })} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>{child?.full_name || '(unnamed)'}</p>
                              <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: 0 }}>
                                {childBY ? `b. ${childBY}` : 'birth year unknown'}
                              </p>
                            </div>
                            <span title={hint} style={{ fontSize: 13, color: iconColor, flexShrink: 0 }}>{icon}</span>
                            {hint && <span style={{ fontSize: 10, color: iconColor, maxWidth: 120, lineHeight: 1.2 }}>{hint}</span>}
                          </label>
                        )
                      })}
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <button onClick={saveCoParents} disabled={savingCoParents || coParentSelections.size === 0}>
                        {savingCoParents ? 'Linking…' : `Link ${coParentSelections.size} child${coParentSelections.size !== 1 ? 'ren' : ''} to ${spouseName.split(' ')[0]}`}
                      </button>
                      <button onClick={() => setCoParentPanel(null)}>Skip — link manually</button>
                    </div>
                  </div>
                )
              })()}

              {/* Potential duplicates */}
              {!editingPerson && (
                <div style={card}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: dupCandidates.length > 0 || findingDups ? 14 : 0 }}>
                    <p style={sectionLabel}>Potential duplicates</p>
                    <button onClick={() => findDuplicates(selected)} disabled={findingDups}>
                      {findingDups ? 'Searching…' : dupCandidates.length > 0 ? 'Search again' : 'Find duplicates'}
                    </button>
                  </div>

                  {mergeLog && (
                    <div style={{ background: 'var(--color-background-secondary)', borderRadius: 'var(--border-radius-md)', padding: '8px 12px', marginBottom: 14 }}>
                      <p style={{ ...sectionLabel, marginBottom: 4 }}>Merge log</p>
                      {mergeLog.map((line, i) => (
                        <p key={i} style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '1px 0', fontFamily: 'var(--font-mono)' }}>{line}</p>
                      ))}
                      <button onClick={() => { setMergeLog(null); findDuplicates(selected) }} style={{ marginTop: 6, fontSize: 11 }}>
                        Find duplicates again
                      </button>
                    </div>
                  )}

                  {!mergeLog && dupCandidates.length === 0 && !findingDups && (
                    <p style={{ fontSize: 13, color: 'var(--color-text-tertiary)' }}>
                      Click "Find duplicates" to search for records that may represent the same individual.
                    </p>
                  )}

                  {dupCandidates[0]?._error && (
                    <p style={{ fontSize: 12, color: 'var(--color-text-danger)' }}>Error: {dupCandidates[0]._error}</p>
                  )}
                  {dupCandidates[0]?._debug && (
                    <p style={{ fontSize: 12, color: 'var(--color-text-warning)' }}>{dupCandidates[0]._debug}</p>
                  )}

                  {dupCandidates.length > 0 && !mergeLog && !dupCandidates[0]?._error && !dupCandidates[0]?._debug && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {dupCandidates.map(({ record: cand, score, reasons }) => {
                        const isTarget = mergeTarget?.deceased_id === cand.deceased_id
                        const scoreColor = score >= 80 ? 'var(--color-text-danger)'
                          : score >= 60 ? 'var(--color-text-warning)'
                          : score >= 40 ? 'var(--color-text-secondary)'
                          : 'var(--color-text-tertiary)'
                        const scoreLabel = score >= 80 ? 'strong match'
                          : score >= 60 ? 'likely match'
                          : score >= 40 ? 'possible match'
                          : 'low confidence'
                        return (
                          <div key={cand.deceased_id} style={{
                            border: isTarget ? '0.5px solid var(--color-border-warning)' : '0.5px solid var(--color-border-tertiary)',
                            borderRadius: 'var(--border-radius-md)',
                            padding: '10px 12px',
                            background: isTarget ? 'var(--color-background-warning)' : 'var(--color-background-secondary)',
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <Avatar name={cand.full_name} size={30} color={score >= 80 ? 'warning' : 'secondary'} />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                  <p style={{ fontWeight: 500, fontSize: 13, margin: 0 }}>{cand.full_name}</p>
                                  <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 99, border: `0.5px solid ${scoreColor}`, color: scoreColor }}>
                                    {score} pts · {scoreLabel}
                                  </span>
                                </div>
                                <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                                  {cand.date_of_birth_verbatim && <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>b. {fmtDate(cand.date_of_birth_verbatim, cand.date_of_birth_parsed)}</span>}
                                  {cand.date_of_death_verbatim && <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>d. {fmtDate(cand.date_of_death_verbatim, cand.date_of_death_parsed)}</span>}
                                  {cand.church_event_type && <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{cand.church_event_type}</span>}
                                </div>
                                {reasons && reasons.length > 0 && (
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px 6px', marginTop: 5 }}>
                                    {reasons.map((r, i) => (
                                      <span key={i} style={{ fontSize: 10, color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}>
                                        {r.label}: {r.detail} <span style={{ color: scoreColor }}>+{r.points}</span>
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                              {!isTarget && (
                                <button onClick={() => { setMergeTarget(cand); setMergeFieldChoices({}) }} style={{ fontSize: 11, padding: '3px 10px' }}>
                                  Review merge
                                </button>
                              )}
                              {isTarget && (
                                <button onClick={() => setMergeTarget(null)} style={{ fontSize: 11 }}>Cancel</button>
                              )}
                            </div>

                            {/* Merge field diff */}
                            {isTarget && (
                              <div style={{ marginTop: 12, borderTop: '0.5px solid var(--color-border-tertiary)', paddingTop: 12 }}>
                                <p style={{ ...fieldLabel, marginBottom: 8 }}>
                                  Merging <strong>{cand.full_name}</strong> into <strong>{selected.first_name} {selected.last_name}</strong> — choose which values to keep:
                                </p>
                                {diffFields.length === 0 && (
                                  <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 10 }}>All overlapping fields are identical — no field choices needed.</p>
                                )}
                                {diffFields.map(({ key, label }) => (
                                  <div key={key} style={{ marginBottom: 10 }}>
                                    <p style={fieldLabel}>{label}</p>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                      <label style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'flex-start', cursor: 'pointer' }}>
                                        <input type="radio" name={key}
                                          checked={!mergeFieldChoices[key]}
                                          onChange={() => setMergeFieldChoices(p => ({ ...p, [key]: false }))}
                                          style={{ marginTop: 2 }}
                                        />
                                        <span>
                                          <span style={{ color: 'var(--color-text-tertiary)' }}>Keep canonical: </span>
                                          {selected[key] || <em style={{ color: 'var(--color-text-tertiary)' }}>empty</em>}
                                        </span>
                                      </label>
                                      <label style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'flex-start', cursor: 'pointer' }}>
                                        <input type="radio" name={key}
                                          checked={!!mergeFieldChoices[key]}
                                          onChange={() => setMergeFieldChoices(p => ({ ...p, [key]: true }))}
                                          style={{ marginTop: 2 }}
                                        />
                                        <span>
                                          <span style={{ color: 'var(--color-text-tertiary)' }}>Use from duplicate: </span>
                                          {cand[key] || <em style={{ color: 'var(--color-text-tertiary)' }}>empty</em>}
                                        </span>
                                      </label>
                                    </div>
                                  </div>
                                ))}
                                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
                                  <button
                                    onClick={confirmMerge}
                                    disabled={merging}
                                    style={{ background: 'var(--color-background-danger)', color: 'var(--color-text-danger)', border: '0.5px solid var(--color-border-danger)' }}
                                  >
                                    {merging ? 'Merging…' : `Confirm — absorb ${cand.full_name} into ${mergeFieldChoices['first_name'] ? mergeTarget?.first_name : selected.first_name} ${mergeFieldChoices['last_name'] ? mergeTarget?.last_name : selected.last_name}`}
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

            </div>
          </div>
        )}
      </div>
    </div>
  )
}
