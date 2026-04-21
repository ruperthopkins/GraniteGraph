// src/admin/PersonView.jsx
// Granite Graph — Person Research & QA View
// Add to AdminHome tools list and App.js routing

import { useState, useCallback } from 'react'
import { supabase } from '../supabaseClient'
import { normaliseName, matchScore } from '../utils/nameNorm'
import { mergePersons } from '../utils/mergePersons'

const RELATIONSHIP_TYPES = ['spouse', 'parent', 'child', 'sibling', 'unknown']
const CONFIDENCE_LEVELS = ['confirmed', 'probable', 'possible', 'uncertain']
const SOURCE_TYPES = ['stone_inscription', 'document', 'church_record', 'census', 'colonial_document', 'family_record', 'ai_extracted', 'volunteer', 'admin']

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
    stone_inscription: 'stone',
    document: 'document',
    church_record: 'church',
    census: 'census',
    family_record: 'family record',
    ai_extracted: 'AI',
    genealogy_record: 'genealogy',
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
  const [stoneData, setStoneData] = useState(null)     // stone + photo
  const [kinship, setKinship] = useState([])           // relationships
  const [loading, setLoading] = useState(false)

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
  const [addRelForm, setAddRelForm] = useState({ relationship_type: 'spouse', confidence: 'probable', notes: '' })
  const [addRelTarget, setAddRelTarget] = useState(null)
  const [savingAddRel, setSavingAddRel] = useState(false)

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
    setStoneData(null)
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

    // Stone + photo
    const { data: sd, error: sdError } = await supabase
      .from('stone_deceased')
      .select('role, stones(stone_id, inscription_text, stone_condition, condition_notes, volunteer_notes, flags, stone_photos(photo_url, is_primary, side))')
      .eq('deceased_id', record.deceased_id)
      .limit(1)
      .single()
    if (sdError && sdError.code !== 'PGRST116') {
      console.error('Error loading stone data:', sdError)
    }
    if (sd?.stones) setStoneData(sd.stones)

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
      q = q.or(`first_name.ilike.%${terms[0]}%,last_name.ilike.%${terms[0]}%`)
    } else {
      q = q.ilike('last_name', `%${terms[terms.length-1]}%`)
    }
    const { data } = await q.order('last_name').order('first_name').limit(20)
    setAddRelResults(data || [])
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
    const { data } = await supabase
      .from('v_deceased_search')
      .select('*')
      .ilike('last_name', `%${norm.last_name}%`)
      .neq('deceased_id', person.deceased_id)
      .limit(30)
    const scored = (data || [])
      .map(r => ({ record: r, score: matchScore(person, r) }))
      .filter(c => c.score >= 50)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
    setDupCandidates(scored)
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

  const photo = stoneData?.stone_photos?.find(p => p.is_primary) || stoneData?.stone_photos?.[0]

  const MERGE_FIELDS = [
    { key: 'date_of_birth_verbatim', label: 'birth date' },
    { key: 'date_of_death_verbatim', label: 'death date' },
    { key: 'maiden_name', label: 'maiden name' },
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
                      {r.date_of_birth_verbatim && <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>b. {r.date_of_birth_verbatim}</span>}
                      {r.date_of_death_verbatim && <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>d. {r.date_of_death_verbatim}</span>}
                      {r.maiden_name && <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>nee {r.maiden_name}</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    {r.is_photographed && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: 'var(--color-background-success)', color: 'var(--color-text-success)', border: '0.5px solid var(--color-border-success)' }}>stone</span>}
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

              {/* Stone photo */}
              <div style={card}>
                {photo ? (
                  <img src={photo.photo_url} alt="Gravestone"
                    style={{ width: '100%', borderRadius: 'var(--border-radius-md)', marginBottom: 12, display: 'block' }} />
                ) : (
                  <div style={{ width: '100%', aspectRatio: '3/4', background: 'var(--color-background-secondary)', borderRadius: 'var(--border-radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
                    <span style={{ fontSize: 13, color: 'var(--color-text-tertiary)' }}>no photo</span>
                  </div>
                )}

                {stoneData?.inscription_text && (
                  <>
                    <p style={{ ...sectionLabel }}>Inscription</p>
                    <p style={{ fontSize: 12, fontFamily: 'var(--font-mono)', lineHeight: 1.7, margin: '0 0 10px', background: 'var(--color-background-secondary)', padding: '8px 10px', borderRadius: 'var(--border-radius-md)', color: 'var(--color-text-primary)' }}>
                      {stoneData.inscription_text}
                    </p>
                  </>
                )}

                {stoneData && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: 'var(--color-background-success)', color: 'var(--color-text-success)', border: '0.5px solid var(--color-border-success)' }}>photographed</span>
                    {stoneData.stone_condition && (
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: 'var(--color-background-secondary)', color: 'var(--color-text-secondary)', border: '0.5px solid var(--color-border-tertiary)' }}>
                        {stoneData.stone_condition}
                      </span>
                    )}
                    {stoneData.flags?.length > 0 && (
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: 'var(--color-background-warning)', color: 'var(--color-text-warning)', border: '0.5px solid var(--color-border-warning)' }}>
                        flagged
                      </span>
                    )}
                  </div>
                )}

                {!stoneData && (
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
                        {[selected.date_of_birth_verbatim && 'b. ' + selected.date_of_birth_verbatim,
                          selected.date_of_death_verbatim && 'd. ' + selected.date_of_death_verbatim]
                          .filter(Boolean).join('  ·  ')}
                      </p>
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
                    {selected.notes && (
                      <div style={{ gridColumn: '1 / -1' }}>
                        <p style={fieldLabel}>notes</p>
                        <p style={fieldValue}>{selected.notes}</p>
                      </div>
                    )}
                    {selected.biography && (
                      <div style={{ gridColumn: '1 / -1' }}>
                        <p style={fieldLabel}>biography</p>
                        <p style={{ ...fieldValue, lineHeight: 1.6 }}>{selected.biography}</p>
                      </div>
                    )}
                    {!selected.maiden_name && !selected.church_event_type && !selected.notes && !selected.biography && (
                      <p style={{ fontSize: 13, color: 'var(--color-text-tertiary)', margin: 0, gridColumn: '1 / -1' }}>No additional details recorded.</p>
                    )}
                  </div>
                )}
              </div>

              {/* Family connections */}
              <div style={card}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <p style={sectionLabel}>Family connections ({kinship.length})</p>
                  <button onClick={() => { setShowAddRel(!showAddRel); setAddRelTarget(null); setAddRelResults([]); setAddRelSearch('') }}>
                    {showAddRel ? 'Cancel' : '+ Add relationship'}
                  </button>
                </div>

                {/* Add relationship panel */}
                {showAddRel && (
                  <div style={{ background: 'var(--color-background-secondary)', borderRadius: 'var(--border-radius-md)', padding: '12px 14px', marginBottom: 16, border: '0.5px solid var(--color-border-secondary)' }}>
                    <p style={{ ...fieldLabel, marginBottom: 8 }}>Search for person to link</p>
                    <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                      <input value={addRelSearch} onChange={e => setAddRelSearch(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && searchForRel()}
                        placeholder="Name…" style={{ flex: 1 }} />
                      <button onClick={searchForRel}>Search</button>
                    </div>
                    {addRelResults.length > 0 && !addRelTarget && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflowY: 'auto', marginBottom: 10 }}>
                        {addRelResults.map(r => (
                          <div key={r.deceased_id} onClick={() => setAddRelTarget(r)}
                            style={{ padding: '6px 10px', borderRadius: 'var(--border-radius-md)', border: '0.5px solid var(--color-border-tertiary)', cursor: 'pointer', background: 'var(--color-background-primary)' }}>
                            <p style={{ fontSize: 13, margin: 0, fontWeight: 500 }}>{r.full_name}</p>
                            <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: 0 }}>
                              {[r.date_of_birth_verbatim && 'b. ' + r.date_of_birth_verbatim, r.date_of_death_verbatim && 'd. ' + r.date_of_death_verbatim].filter(Boolean).join(' · ')}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                    {addRelTarget && (
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--color-background-info)', borderRadius: 'var(--border-radius-md)', marginBottom: 10 }}>
                          <Avatar name={addRelTarget.full_name} size={28} color="info" />
                          <p style={{ fontSize: 13, margin: 0, fontWeight: 500, color: 'var(--color-text-info)' }}>{addRelTarget.full_name}</p>
                          <button onClick={() => setAddRelTarget(null)} style={{ marginLeft: 'auto', fontSize: 11 }}>change</button>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                          <div>
                            <p style={fieldLabel}>relationship type</p>
                            <select value={addRelForm.relationship_type} onChange={e => setAddRelForm(p => ({ ...p, relationship_type: e.target.value }))}>
                              {RELATIONSHIP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </div>
                          <div>
                            <p style={fieldLabel}>confidence</p>
                            <select value={addRelForm.confidence} onChange={e => setAddRelForm(p => ({ ...p, confidence: e.target.value }))}>
                              {CONFIDENCE_LEVELS.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </div>
                        </div>
                        <div style={{ marginBottom: 10 }}>
                          <p style={fieldLabel}>notes (evidence)</p>
                          <input value={addRelForm.notes} onChange={e => setAddRelForm(p => ({ ...p, notes: e.target.value }))}
                            placeholder="e.g. wife of Samuel Hopkins per Malman p.183" />
                        </div>
                        <button onClick={addRel} disabled={savingAddRel}>
                          {savingAddRel ? 'Adding…' : `Add — ${selected.first_name} is ${addRelForm.relationship_type} of ${addRelTarget.first_name}`}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {kinship.length === 0 && !showAddRel && (
                  <p style={{ fontSize: 13, color: 'var(--color-text-tertiary)' }}>No relationships recorded yet.</p>
                )}

                {/* Relationship groups */}
                {['parent', 'spouse', 'child', 'sibling', 'unknown'].map(relType => {
                  const group = grouped[relType]
                  if (group.length === 0) return null
                  return (
                    <div key={relType} style={{ marginBottom: 16 }}>
                      <p style={sectionLabel}>{relType === 'child' ? `children (${group.length})` : relType === 'parent' ? 'parents' : relType === 'spouse' ? 'spouse(s)' : relType + 's'}</p>
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
                                        {SOURCE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
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
                                    color={isDuplicate ? 'warning' : relative?.is_photographed ? 'success' : 'secondary'} />
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

                  {dupCandidates.length > 0 && !mergeLog && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {dupCandidates.map(({ record: cand, score }) => {
                        const isTarget = mergeTarget?.deceased_id === cand.deceased_id
                        const scoreColor = score >= 80
                          ? 'var(--color-text-danger)'
                          : score >= 65
                            ? 'var(--color-text-warning)'
                            : 'var(--color-text-secondary)'
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
                                    {score}% match
                                  </span>
                                </div>
                                <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                                  {cand.date_of_birth_verbatim && <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>b. {cand.date_of_birth_verbatim}</span>}
                                  {cand.date_of_death_verbatim && <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>d. {cand.date_of_death_verbatim}</span>}
                                  {cand.church_event_type && <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{cand.church_event_type}</span>}
                                </div>
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
                                    {merging ? 'Merging…' : `Confirm — delete ${cand.full_name}, keep ${selected.first_name} ${selected.last_name}`}
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
