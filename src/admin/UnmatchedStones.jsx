// src/admin/UnmatchedStones.jsx
// Admin curation tool: links photographed stones to deceased records.
// Shows stones with no stone_deceased rows, displays photo + inscription,
// and lets the admin search, assign Buried Here / Mentioned, and confirm kinship.

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../supabaseClient'

const REL_LABEL   = { spouse: 'spouse', child: 'child', parent: 'parent', sibling: 'sibling' }
const INVERSE_REL = { spouse: 'spouse', child: 'parent', parent: 'child', sibling: 'sibling' }

function personName(d) {
  return [d.title, d.first_name, d.middle_name, d.last_name].filter(Boolean).join(' ') || '(unnamed)'
}

function isUnreadable(stone) {
  const t = (stone.inscription_text || '').replace(/\[unreadable\]/gi, '').replace(/\s/g, '')
  return t.length < 5
}

async function loadUnmatched() {
  const [{ data: allStones, error: e1 }, { data: linked, error: e2 }] = await Promise.all([
    supabase.from('stones')
      .select('stone_id, inscription_text, condition_notes, created_at, stone_photos(photo_url, is_primary)')
      .order('created_at'),
    supabase.from('stone_deceased').select('stone_id'),
  ])
  if (e1) throw new Error(e1.message)
  if (e2) throw new Error(e2.message)
  const linkedSet = new Set((linked || []).map(r => r.stone_id))
  return (allStones || []).filter(s => !linkedSet.has(s.stone_id))
}

// ── Main component ────────────────────────────────────────────────────────────
export default function UnmatchedStones({ onBack }) {
  const [phase, setPhase]               = useState('list') // list | detail
  const [stones, setStones]             = useState([])
  const [loading, setLoading]           = useState(true)
  const [loadError, setLoadError]       = useState(null)
  const [selected, setSelected]         = useState(null)
  const [stoneLinks, setStoneLinks]     = useState([])
  const [searchQuery, setSearchQuery]   = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching]       = useState(false)
  const [searchAttempted, setSearchAttempted] = useState(false)
  const [pendingMatch, setPendingMatch] = useState(null)
  const [saving, setSaving]             = useState(false)
  const [kinshipPair, setKinshipPair]   = useState(null) // null | 'skip' | {a, b}
  const [kinshipType, setKinshipType]   = useState('spouse')
  const [newRecord, setNewRecord]       = useState(null) // null | field object when creating

  const load = useCallback(async () => {
    setLoading(true); setLoadError(null)
    try { setStones(await loadUnmatched()) }
    catch (err) { setLoadError(err.message) }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const loadLinks = async (stoneId) => {
    const { data, error } = await supabase
      .from('stone_deceased')
      .select('deceased_id, role, deceased(title, first_name, middle_name, last_name)')
      .eq('stone_id', stoneId)
    if (!error) setStoneLinks(data || [])
  }

  const selectStone = async (stone) => {
    setSelected(stone); setPhase('detail')
    setSearchQuery(''); setSearchResults([]); setSearchAttempted(false)
    setPendingMatch(null); setKinshipPair(null); setKinshipType('spouse'); setNewRecord(null)
    await loadLinks(stone.stone_id)
  }

  const goBack = async () => {
    await load()
    setPhase('list'); setSelected(null); setStoneLinks([])
  }

  // ── Search ────────────────────────────────────────────────────────────────
  const handleSearch = async () => {
    if (!searchQuery.trim()) return
    setSearching(true); setSearchResults([]); setSearchAttempted(true)
    const terms = searchQuery.trim().split(/\s+/).filter(Boolean)
    const buildQ = () => {
      let q = supabase.from('v_deceased_search').select('*')
      if (terms.length === 1) {
        q = q.or(`first_name.ilike.%${terms[0]}%,last_name.ilike.%${terms[0]}%,maiden_name.ilike.%${terms[0]}%`)
      } else {
        q = q.ilike('last_name', `%${terms[terms.length - 1]}%`)
        terms.slice(0, -1).forEach(t =>
          q = q.or(`first_name.ilike.%${t}%,middle_name.ilike.%${t}%`)
        )
      }
      return q.order('last_name').order('first_name').limit(20)
    }
    let { data, error } = await buildQ()
    if (error || !data) {
      await new Promise(r => setTimeout(r, 400))
      ;({ data, error } = await buildQ())
    }
    if (!error) setSearchResults(data || [])
    setSearching(false)
  }

  // ── Link person to stone ──────────────────────────────────────────────────
  const linkPerson = async (record, role) => {
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('stone_deceased').insert({
      stone_id: selected.stone_id,
      deceased_id: record.deceased_id,
      role,
      confirmed_by: user.id,
      confirmed_at: new Date().toISOString(),
      match_method: 'manual',
    })
    if (error) {
      alert('Link failed: ' + error.message)
    } else {
      setPendingMatch(null); setSearchQuery(''); setSearchResults([]); setSearchAttempted(false)
      setKinshipPair(null)
      await loadLinks(selected.stone_id)
    }
    setSaving(false)
  }

  const removeLink = async (deceasedId) => {
    const { error } = await supabase.from('stone_deceased')
      .delete().eq('stone_id', selected.stone_id).eq('deceased_id', deceasedId)
    if (error) alert('Remove failed: ' + error.message)
    else { setKinshipPair(null); await loadLinks(selected.stone_id) }
  }

  // ── Create new deceased record and link ──────────────────────────────────
  const createAndLink = async (role) => {
    if (!newRecord?.last_name && !newRecord?.first_name) {
      alert('Please enter at least a first or last name.')
      return
    }
    setSaving(true)
    const { data: inserted, error: ce } = await supabase
      .from('deceased')
      .insert({
        first_name:            newRecord.first_name   || null,
        middle_name:           newRecord.middle_name  || null,
        last_name:             newRecord.last_name    || null,
        maiden_name:           newRecord.maiden_name  || null,
        date_of_birth_verbatim: newRecord.born        || null,
        date_of_death_verbatim: newRecord.died        || null,
        gender:                newRecord.gender       || null,
        cemetery_id:           'd8bd1f88-cdde-4ef2-a448-5ab04d2d8107',
      })
      .select('deceased_id, first_name, middle_name, last_name, title')
      .single()
    if (ce) { alert('Create failed: ' + ce.message); setSaving(false); return }
    await linkPerson(inserted, role)
    setNewRecord(null)
    setSaving(false)
  }

  // ── Save kinship ──────────────────────────────────────────────────────────
  const saveKinship = async () => {
    if (!kinshipPair || kinshipPair === 'skip') return
    setSaving(true)
    const { a, b } = kinshipPair
    await Promise.all([
      supabase.from('kinship').insert({
        primary_deceased_id: a.deceased_id, relative_deceased_id: b.deceased_id,
        relationship_type: kinshipType, source: 'stone_inscription', confidence: 'probable',
      }),
      supabase.from('kinship').insert({
        primary_deceased_id: b.deceased_id, relative_deceased_id: a.deceased_id,
        relationship_type: INVERSE_REL[kinshipType], source: 'stone_inscription', confidence: 'probable',
      }),
    ])
    setKinshipPair('skip') // mark done so prompt doesn't reappear
    setSaving(false)
  }

  // ── List view ─────────────────────────────────────────────────────────────
  if (phase === 'list') {
    const readable    = stones.filter(s => !isUnreadable(s))
    const unreadable  = stones.filter(s =>  isUnreadable(s))
    return (
      <div style={{ minHeight: '100vh', background: 'var(--color-background-primary)', color: 'var(--color-text-primary)', paddingBottom: 60 }}>
        <div style={{ background: 'var(--color-background-secondary)', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '0.5px solid var(--color-border-secondary)' }}>
          <div>
            <p style={{ fontWeight: 700, fontSize: 16, margin: 0, color: 'var(--color-text-success)' }}>Unmatched Stones</p>
            <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', margin: 0 }}>Link photographed stones to deceased records</p>
          </div>
          <button onClick={onBack} style={{ fontSize: 13, color: 'var(--color-text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}>← Admin</button>
        </div>

        <div style={{ maxWidth: 740, margin: '0 auto', padding: '20px 16px' }}>
          {loading && <p style={{ color: 'var(--color-text-secondary)', textAlign: 'center', paddingTop: 40 }}>Loading…</p>}
          {loadError && <p style={{ color: 'var(--color-text-danger)' }}>{loadError}</p>}
          {!loading && !loadError && (
            <>
              <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 16 }}>
                {readable.length} stones with readable inscriptions · {unreadable.length} unidentifiable
              </p>
              {readable.map(stone => {
                const photo   = stone.stone_photos?.find(p => p.is_primary) || stone.stone_photos?.[0]
                const snippet = (stone.inscription_text || '').slice(0, 90) + ((stone.inscription_text || '').length > 90 ? '…' : '')
                return (
                  <div key={stone.stone_id} onClick={() => selectStone(stone)}
                    style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '12px 14px', borderRadius: 'var(--border-radius-md)', border: '0.5px solid var(--color-border-tertiary)', background: 'var(--color-background-secondary)', marginBottom: 8, cursor: 'pointer' }}>
                    {photo && <img src={photo.photo_url} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 'var(--border-radius-sm)', flexShrink: 0 }} />}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={{ fontSize: 13, fontWeight: 600, margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{snippet || '(no inscription)'}</p>
                      <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: 0 }}>Photographed {new Date(stone.created_at).toLocaleDateString()}</p>
                    </div>
                    <span style={{ fontSize: 18, color: 'var(--color-text-tertiary)', flexShrink: 0 }}>›</span>
                  </div>
                )
              })}
              {unreadable.length > 0 && (
                <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 16, fontStyle: 'italic' }}>
                  {unreadable.length} stone{unreadable.length !== 1 ? 's' : ''} hidden — inscription blank or unreadable
                </p>
              )}
              {readable.length === 0 && unreadable.length === 0 && (
                <p style={{ fontSize: 14, color: 'var(--color-text-success)', textAlign: 'center', paddingTop: 40 }}>All stones matched ✓</p>
              )}
            </>
          )}
        </div>
      </div>
    )
  }

  // ── Detail view ───────────────────────────────────────────────────────────
  const photo         = selected?.stone_photos?.find(p => p.is_primary) || selected?.stone_photos?.[0]
  const occupantLinks = stoneLinks.filter(l => l.role === 'occupant')
  const showKinshipPrompt = occupantLinks.length >= 2 && !kinshipPair

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-background-primary)', color: 'var(--color-text-primary)', paddingBottom: 60 }}>
      <div style={{ background: 'var(--color-background-secondary)', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '0.5px solid var(--color-border-secondary)' }}>
        <button onClick={goBack} style={{ fontSize: 13, color: 'var(--color-text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}>← Unmatched Stones</button>
        {stoneLinks.length > 0 && (
          <span style={{ fontSize: 12, color: 'var(--color-text-success)' }}>{stoneLinks.length} linked</span>
        )}
      </div>

      <div style={{ maxWidth: 740, margin: '0 auto', padding: '20px 16px' }}>

        {/* Photo */}
        {photo && (
          <img src={photo.photo_url} alt="Stone" style={{ width: '100%', maxHeight: 280, objectFit: 'cover', borderRadius: 'var(--border-radius-md)', marginBottom: 14 }} />
        )}

        {/* Inscription */}
        <div style={{ background: 'var(--color-background-secondary)', borderRadius: 'var(--border-radius-md)', padding: '12px 14px', marginBottom: 14, border: '0.5px solid var(--color-border-tertiary)' }}>
          <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: 1 }}>Inscription</p>
          <p style={{ fontSize: 13, lineHeight: 1.7, margin: 0, whiteSpace: 'pre-wrap' }}>{selected?.inscription_text || '(none)'}</p>
          {selected?.condition_notes && (
            <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '8px 0 0', fontStyle: 'italic' }}>{selected.condition_notes}</p>
          )}
        </div>

        {/* Linked people */}
        {stoneLinks.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: 1 }}>Linked</p>
            {stoneLinks.map(link => (
              <div key={link.deceased_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderRadius: 'var(--border-radius-sm)', background: 'var(--color-background-success)', border: '0.5px solid var(--color-border-success)', marginBottom: 6 }}>
                <div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-success)' }}>✓ {personName(link.deceased)}</span>
                  <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginLeft: 8 }}>{link.role === 'occupant' ? 'Buried here' : 'Mentioned'}</span>
                </div>
                <button onClick={() => removeLink(link.deceased_id)} style={{ fontSize: 11, color: 'var(--color-text-tertiary)', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
              </div>
            ))}
          </div>
        )}

        {/* Kinship prompt */}
        {showKinshipPrompt && (
          <div style={{ background: 'var(--color-background-secondary)', borderRadius: 'var(--border-radius-md)', padding: '12px 14px', marginBottom: 14, border: '0.5px solid var(--color-border-info)' }}>
            <p style={{ fontSize: 12, color: 'var(--color-text-info)', margin: '0 0 10px', fontWeight: 600 }}>Confirm relationship between occupants?</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {occupantLinks.map((la, ai) =>
                occupantLinks.slice(ai + 1).map(lb => (
                  <button key={la.deceased_id + lb.deceased_id}
                    onClick={() => setKinshipPair({ a: la, b: lb })}
                    style={{ fontSize: 12, padding: '4px 10px', borderRadius: 'var(--border-radius-sm)', background: 'var(--color-background-tertiary)', color: 'var(--color-text-info)', border: '0.5px solid var(--color-border-info)', cursor: 'pointer' }}>
                    {personName(la.deceased).split(' ')[0]} + {personName(lb.deceased).split(' ')[0]}
                  </button>
                ))
              )}
            </div>
            <button onClick={() => setKinshipPair('skip')} style={{ fontSize: 11, color: 'var(--color-text-tertiary)', background: 'none', border: 'none', cursor: 'pointer' }}>Skip — no relationship to record</button>
          </div>
        )}

        {/* Kinship picker */}
        {kinshipPair && kinshipPair !== 'skip' && (
          <div style={{ background: 'var(--color-background-secondary)', borderRadius: 'var(--border-radius-md)', padding: '12px 14px', marginBottom: 14, border: '0.5px solid var(--color-border-info)' }}>
            <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', margin: '0 0 8px' }}>
              {personName(kinshipPair.a.deceased)} is the
              {' '}
              <select value={kinshipType} onChange={e => setKinshipType(e.target.value)}
                style={{ background: 'var(--color-background-tertiary)', color: 'var(--color-text-primary)', border: '0.5px solid var(--color-border-secondary)', borderRadius: 4, padding: '2px 6px', fontSize: 12 }}>
                {Object.entries(REL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              {' '}of {personName(kinshipPair.b.deceased)}
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={saveKinship} disabled={saving} style={{ fontSize: 12, padding: '6px 14px' }}>{saving ? 'Saving…' : 'Confirm relationship'}</button>
              <button onClick={() => setKinshipPair(null)} style={{ fontSize: 12, padding: '6px 14px', background: 'none', color: 'var(--color-text-tertiary)', border: '0.5px solid var(--color-border-tertiary)', cursor: 'pointer' }}>Back</button>
            </div>
          </div>
        )}

        {/* Search */}
        {!pendingMatch && kinshipPair !== null && kinshipPair !== 'skip' ? null : !pendingMatch && (
          <div style={{ marginBottom: 14 }}>
            <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: 1 }}>
              {stoneLinks.length > 0 ? 'Link another person' : 'Search for a person'}
            </p>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <input type="text" value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                placeholder="Name…"
                style={{ flex: 1, background: 'white', color: '#111', border: '2px solid var(--color-border-success)', borderRadius: 'var(--border-radius-sm)', padding: '8px 10px', fontSize: 13, outline: 'none' }}
              />
              <button onClick={handleSearch} disabled={searching} style={{ fontSize: 13, padding: '0 16px' }}>
                {searching ? '…' : 'Search'}
              </button>
            </div>
            {searchResults.map(r => (
              <div key={r.deceased_id} onClick={() => setPendingMatch(r)}
                style={{ padding: '10px 12px', borderRadius: 'var(--border-radius-sm)', background: 'var(--color-background-secondary)', border: '0.5px solid var(--color-border-tertiary)', marginBottom: 6, cursor: 'pointer' }}>
                <p style={{ fontSize: 13, fontWeight: 600, margin: '0 0 2px', color: r.is_photographed ? 'var(--color-text-warning)' : 'var(--color-text-primary)' }}>
                  {r.full_name}
                  {r.is_photographed && <span style={{ fontSize: 11, marginLeft: 6, fontWeight: 400 }}>(already on another stone)</span>}
                  {r.is_mentioned && !r.is_photographed && <span style={{ fontSize: 11, marginLeft: 6, color: 'var(--color-text-info)', fontWeight: 400 }}>· mentioned elsewhere</span>}
                </p>
                <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: 0 }}>
                  {r.date_of_death_verbatim && 'd. ' + r.date_of_death_verbatim}
                  {r.maiden_name && ' · née ' + r.maiden_name}
                </p>
              </div>
            ))}
            {searchAttempted && !searching && searchResults.length === 0 && (
              <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', textAlign: 'center', padding: '8px 0' }}>No matches — try last name only</p>
            )}
            {searchAttempted && !searching && (
              <button
                onClick={() => setNewRecord({ first_name: '', middle_name: '', last_name: '', maiden_name: '', born: '', died: '', gender: '' })}
                style={{ fontSize: 12, color: 'var(--color-text-success)', background: 'none', border: '0.5px solid var(--color-border-success)', borderRadius: 'var(--border-radius-sm)', padding: '5px 12px', cursor: 'pointer', marginTop: 4, width: '100%' }}>
                + Not in database — create new record
              </button>
            )}
          </div>
        )}

        {/* New record form */}
        {newRecord && (
          <div style={{ background: 'var(--color-background-secondary)', borderRadius: 'var(--border-radius-md)', padding: '14px', marginBottom: 14, border: '0.5px solid var(--color-border-success)' }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-success)', margin: '0 0 12px' }}>New record — fill from inscription</p>
            {[
              ['First name',   'first_name'],
              ['Middle name',  'middle_name'],
              ['Last name',    'last_name'],
              ['Maiden name',  'maiden_name'],
              ['Born',         'born'],
              ['Died',         'died'],
            ].map(([label, field]) => (
              <div key={field} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', minWidth: 80 }}>{label}</span>
                <input type="text" value={newRecord[field]}
                  onChange={e => setNewRecord(r => ({ ...r, [field]: e.target.value }))}
                  style={{ flex: 1, background: 'white', color: '#111', border: '1.5px solid var(--color-border-success)', borderRadius: 'var(--border-radius-sm)', padding: '5px 8px', fontSize: 13 }}
                />
              </div>
            ))}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', minWidth: 80 }}>Gender</span>
              <select value={newRecord.gender} onChange={e => setNewRecord(r => ({ ...r, gender: e.target.value }))}
                style={{ background: 'white', color: '#111', border: '1.5px solid var(--color-border-success)', borderRadius: 'var(--border-radius-sm)', padding: '5px 8px', fontSize: 13 }}>
                <option value="">—</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={() => createAndLink('occupant')} disabled={saving} style={{ fontSize: 13, padding: '8px 14px' }}>
                ⬛ Create & link as Buried here
              </button>
              <button onClick={() => createAndLink('mentioned')} disabled={saving}
                style={{ fontSize: 13, padding: '8px 14px', background: 'var(--color-background-tertiary)', color: 'var(--color-text-secondary)', border: '0.5px solid var(--color-border-secondary)' }}>
                📝 Create & link as Mentioned
              </button>
              <button onClick={() => setNewRecord(null)} disabled={saving}
                style={{ fontSize: 13, padding: '8px 14px', background: 'none', color: 'var(--color-text-tertiary)', border: '0.5px solid var(--color-border-tertiary)', cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Role picker */}
        {pendingMatch && (
          <div style={{ background: 'var(--color-background-secondary)', borderRadius: 'var(--border-radius-md)', padding: '14px', marginBottom: 14, border: '0.5px solid var(--color-border-success)' }}>
            <p style={{ fontSize: 13, fontWeight: 600, margin: '0 0 2px' }}>{pendingMatch.full_name}</p>
            {pendingMatch.date_of_death_verbatim && (
              <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '0 0 12px' }}>d. {pendingMatch.date_of_death_verbatim}</p>
            )}
            <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', margin: '0 0 10px' }}>How does this person relate to this stone?</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={() => linkPerson(pendingMatch, 'occupant')} disabled={saving}
                style={{ fontSize: 13, padding: '8px 16px' }}>
                ⬛ Buried here
              </button>
              <button onClick={() => linkPerson(pendingMatch, 'mentioned')} disabled={saving}
                style={{ fontSize: 13, padding: '8px 16px', background: 'var(--color-background-tertiary)', color: 'var(--color-text-secondary)', border: '0.5px solid var(--color-border-secondary)' }}>
                📝 Mentioned only
              </button>
              <button onClick={() => setPendingMatch(null)} disabled={saving}
                style={{ fontSize: 13, padding: '8px 16px', background: 'none', color: 'var(--color-text-tertiary)', border: '0.5px solid var(--color-border-tertiary)', cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Done */}
        {stoneLinks.length > 0 && !pendingMatch && !showKinshipPrompt && (kinshipPair === null || kinshipPair === 'skip') && (
          <button onClick={goBack} style={{ width: '100%', padding: '12px', fontSize: 14, fontWeight: 600, marginTop: 8 }}>
            Done — next stone →
          </button>
        )}

      </div>
    </div>
  )
}
