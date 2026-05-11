// src/admin/PersonView.jsx
// Granite Graph — Person Research & QA View
// Add to AdminHome tools list and App.js routing

import { useState, useCallback } from 'react'
import { supabase } from '../supabaseClient'
import { normaliseName, matchScoreDetails, parseDate } from '../utils/nameNorm'
import { mergePersons } from '../utils/mergePersons'

const CONFIDENCE_LEVELS = ['confirmed', 'probable', 'possible', 'uncertain']
const SOURCE_TYPES = ['stone_inscription', 'document', 'church_record', 'census', 'colonial_document', 'family_record', 'ai_extracted', 'volunteer', 'admin']
// Human-readable labels — kept in sync with field tool REL_LABEL
const REL_LABEL = { spouse: 'Spouse of', parent: 'Parent of', child: 'Child of', sibling: 'Sibling of', unknown: 'Related to' }
const SOURCE_LABEL = { stone_inscription: 'Stone inscription', document: 'Document', church_record: 'Church record', census: 'Census', colonial_document: 'Colonial document', family_record: 'Family record', ai_extracted: 'AI extracted', volunteer: 'Volunteer', admin: 'Admin' }

const MONTH_ABBR = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function fmtDate(verbatim, parsed) {
  const p = parsed || parseDate(verbatim)
  if (!p) return verbatim || null
  const parts = p.split('-')
  if (parts.length === 3) return `${parseInt(parts[2])} ${MONTH_ABBR[parseInt(parts[1])]} ${parts[0]}`
  if (parts.length === 2) return `${MONTH_ABBR[parseInt(parts[1])]} ${parts[0]}`
  return parts[0]
}

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
        q = q.or(`first_name.ilike.%${t}%,middle_name.ilike.%${t}%`)
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
      setKinship(kin.map(k => ({ ...k, relative: relMap[k.relative_deceased_id] || null })))
    } else {
      setKinship([])
    }
    setLoading(false)
  }, [])

  // ── Save person edits ───────────────────────────────────────────────────────
  const savePerson = async () => {
    setSavingPerson(true)
    const { error } = await supabase
      .from('deceased')
      .update({
        first_name: editForm.first_name,
        middle_name: editForm.middle_name,
        last_name: editForm.last_name,
        maiden_name: editForm.maiden_name,
        date_of_birth_verbatim: editForm.date_of_birth_verbatim,
        date_of_death_verbatim: editForm.date_of_death_verbatim,
        notes: editForm.notes,
        biography: editForm.biography,
      })
      .eq('deceased_id', selected.deceased_id)
    if (error) { alert('Save failed: ' + error.message) }
    else {
      setSelected(prev => ({ ...prev, ...editForm }))
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
    const { error } = await supabase
      .from('kinship')
      .delete()
      .eq('kinship_id', kinshipId)
    if (error) { alert('Remove failed: ' + error.message) }
    else { setKinship(prev => prev.filter(k => k.kinship_id !== kinshipId)) }
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
      firstTerms.forEach(term => { q = q.or(`first_name.ilike.%${term}%,middle_name.ilike.%${term}%`) })
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
    console.log('toggleRole: stone_id=', stoneId, 'deceased_id=', selected.deceased_id, '→', newRole)
    const { error } = await supabase.from('stone_deceased')
      .update({ role: newRole })
      .eq('stone_id', stoneId).eq('deceased_id', selected.deceased_id)
    if (error) {
      alert('Could not update role: ' + error.message)
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
    const inverseMap = { spouse: 'spouse', parent: 'child', child: 'parent', sibling: 'sibling', unknown: 'unknown' }
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
        relationship_type: inverseMap[addRelForm.relationship_type] || 'unknown',
        confidence: addRelForm.confidence,
        notes: addRelForm.notes,
        source: 'admin',
      },
    ]
    const { error } = await supabase.from('kinship').insert(rows)
    if (error) { alert('Add failed: ' + error.message) }
    else {
      await loadPerson(selected)
      setShowAddRel(false)
      setAddRelTarget(null)
      setAddRelSearch('')
      setAddRelResults([])
    }
    setSavingAddRel(false)
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
  const grouped = {
    parent:  kinship.filter(k => k.relationship_type === 'parent'),
    spouse:  kinship.filter(k => k.relationship_type === 'spouse'),
    child:   kinship.filter(k => k.relationship_type === 'child'),
    sibling: kinship.filter(k => k.relationship_type === 'sibling'),
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
                        </span>
                      )}
                      {link.stones?.flags?.length > 0 && (
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: 'var(--color-background-warning)', color: 'var(--color-text-warning)', border: '0.5px solid var(--color-border-warning)' }}>
                          flagged
                        </span>
                      )}
                    </div>
                  </div>
                ))}

                {stoneLinks.length === 0 && (
                  <div style={{ background: 'var(--color-background-secondary)', borderRadius: 'var(--border-radius-md)', padding: '10px 12px' }}>
                    <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: 0 }}>No stone cataloged yet</p>
                  </div>
                )}
              </div>

              {/* Sources panel */}
              <div style={card}>
                <p style={sectionLabel}>Sources</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {selected.source_id && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-text-success)', flexShrink: 0 }} />
                      <span style={{ fontSize: 12 }}>
                        {selected.source_id === '800c5884-d180-42b0-9ca6-4e05c8fd64cb' ? 'Mt Sinai Church records' :
                         selected.source_id === '9cb5c6d4-83b2-4ec6-ae59-72d2d7eb1155' ? 'Malman genealogy 1899' :
                         'Reference source'}
                      </span>
                    </div>
                  )}
                  {stoneData && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-text-success)', flexShrink: 0 }} />
                      <span style={{ fontSize: 12 }}>Gravestone (field catalog)</span>
                    </div>
                  )}
                  {selected.church_event_type && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-text-info)', flexShrink: 0 }} />
                      <span style={{ fontSize: 12 }}>Church event: {selected.church_event_type} {selected.church_event_date_verbatim}</span>
                    </div>
                  )}
                  {!selected.source_id && !stoneData && (
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
                        {[selected.first_name, selected.middle_name, selected.last_name].filter(Boolean).join(' ')}
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
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                      {['first_name', 'middle_name', 'last_name'].map(f => (
                        <div key={f}>
                          <p style={fieldLabel}>{f.replace('_', ' ')}</p>
                          <input value={editForm[f] || ''} onChange={e => setEditForm(p => ({ ...p, [f]: e.target.value }))} />
                        </div>
                      ))}
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
