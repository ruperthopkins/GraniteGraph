import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { CEMETERY_ID, REL_LABEL, INVERSE_REL } from '../constants'
import { useStoneMatrix } from '../hooks/useStoneMatrix'
import { parseKinshipHints } from '../utils/stoneMatrixUtils'

async function urlToBase64(url) {
  const resp = await fetch(url)
  const blob = await resp.blob()
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
  // Resize to max 1024px before sending — Vercel's 4.5 MB request body limit
  // is easily exceeded by full-resolution QField photos (3–12 MB).
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      const maxSize = 1024
      let w = img.width, h = img.height
      if (w > h && w > maxSize) { h = (h * maxSize) / w; w = maxSize }
      else if (h > maxSize) { w = (w * maxSize) / h; h = maxSize }
      canvas.width = w; canvas.height = h
      canvas.getContext('2d').drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL('image/jpeg', 0.8).split(',')[1])
    }
    img.src = dataUrl
  })
}

function parseInscriptionToPeople(inscriptionText) {
  if (!inscriptionText) return []
  return inscriptionText.split('|').map(s => s.trim()).filter(Boolean).map((seg, index) => {
    const years = [...seg.matchAll(/\b(\d{4})\b/g)].map(m => m[1])
    const withoutYears = seg.replace(/\b\d{4}\b/g, '').trim()
    const kinshipIdx = withoutYears.search(/\b(WIFE|HUSBAND|SON|DAUGHTER|MOTHER|FATHER|CHILD|CHILDREN|THEIR|HIS|HER)\b/i)
    const nameRaw = kinshipIdx > 0 ? withoutYears.slice(0, kinshipIdx).trim() : withoutYears
    const kinshipHint = kinshipIdx >= 0 ? withoutYears.slice(kinshipIdx).trim() : ''
    const name = nameRaw.split(/\s+/).filter(Boolean)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
    const kinship_hints = kinshipHint ? [kinshipHint] : []
    return {
      index,
      geminiData: {
        date_of_birth_verbatim: years.length >= 2 ? years[0] : null,
        date_of_death_verbatim: years.length >= 2 ? years[1] : (years[0] || null),
        kinship_hints,
        maiden_name: null,
      },
      correctedName: name,
      role: 'occupant',
      relationships: parseKinshipHints(kinship_hints),
      confirmedRelationships: [],
      matchedRecord: null,
      matchStatus: 'pending',
    }
  })
}

function Header({ title, subtitle, onBack }) {
  return (
    <div style={{ background: 'var(--color-background-secondary)', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '0.5px solid var(--color-border-secondary)' }}>
      <div>
        <p style={{ fontWeight: 700, fontSize: 16, margin: 0, color: 'var(--color-text-success)' }}>{title}</p>
        <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', margin: 0 }}>{subtitle}</p>
      </div>
      <button onClick={onBack} style={{ fontSize: 13, color: 'var(--color-text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}>← Admin</button>
    </div>
  )
}


export default function StoneQA({ onBack }) {
  const [phase, setPhase] = useState('queue')
  const [queue, setQueue] = useState([])
  const [loading, setLoading] = useState(false)
  const [currentEntry, setCurrentEntry] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const {
    stoneMatrix, setStoneMatrix, stoneMatrixRef,
    matchingIndex,
    matchSearchQuery, setMatchSearchQuery,
    matchSearchResults, setMatchSearchResults,
    matchSearching, matchSearchAttempted,
    initMatrix, resetMatrix, prepareMatch,
    updatePersonRole, updateCorrectedName, updateRelField,
    searchRelatedPerson,
    confirmRelationship, skipRelationship,
    confirmRelationshipExternal, confirmRelationshipNameOnly,
    handleMatchSearch, selectMatch, advancePerson, skipMatch, markAsNewRecord, addBlankPerson,
  } = useStoneMatrix()

  useEffect(() => { loadQueue() }, [])

  // ── Queue ─────────────────────────────────────────────────────────────────
  const loadQueue = async () => {
    setLoading(true)
    setError(null)
    try {
      const { data: linked } = await supabase.from('stone_deceased').select('stone_id')
      const linkedIds = new Set((linked || []).map(r => r.stone_id))

      const { data: photos, error: photosErr } = await supabase
        .from('stone_photos')
        .select('photo_id, stone_id, photo_url, is_primary, stones(inscription_text, stone_condition, field_notes, field_status)')
        .order('stone_id')
        .order('is_primary', { ascending: false })
      if (photosErr) throw photosErr

      const seen = new Set()
      const entries = []
      for (const p of (photos || [])) {
        if (linkedIds.has(p.stone_id) || seen.has(p.stone_id)) continue
        seen.add(p.stone_id)
        entries.push({
          stone_id: p.stone_id,
          photo_id: p.photo_id,
          photo_url: p.photo_url,
          inscription_text: p.stones?.inscription_text,
          stone_condition: p.stones?.stone_condition,
          field_notes: p.stones?.field_notes,
        })
      }
      setQueue(entries)
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  const openStone = (entry) => {
    setCurrentEntry(entry)
    resetMatrix()
    setPhase('photo')
  }

  // ── Analyze ───────────────────────────────────────────────────────────────
  const analyzePhoto = async () => {
    setLoading(true)
    setError(null)
    try {
      const base64 = await urlToBase64(currentEntry.photo_url)
      const resp = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64 })
      })
      const geminiData = await resp.json()
      if (!geminiData.candidates?.length)
        throw new Error('Gemini error: ' + (geminiData.error?.message || JSON.stringify(geminiData)))
      const extracted = JSON.parse(
        geminiData.candidates[0].content.parts[0].text.replace(/```json|```/g, '').trim()
      )
      initMatrix(
        extracted.people || [],
        extracted.stone_condition || currentEntry.stone_condition,
        extracted.stone_notes,
      )
      setPhase('matrix')
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  const skipToMatch = () => {
    const people = parseInscriptionToPeople(currentEntry.inscription_text)
    const matrix = {
      stone_condition: currentEntry.stone_condition || 'fair',
      stone_notes: '',
      people,
    }
    stoneMatrixRef.current = matrix
    setStoneMatrix(matrix)
    prepareMatch()
    setPhase('match')
  }

  const proceedToMatch = () => {
    prepareMatch()
    setPhase('match')
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  const saveStoneQA = async () => {
    setSaving(true)
    try {
      let resolvedPeople = [...stoneMatrix.people]

      for (let i = 0; i < resolvedPeople.length; i++) {
        const p = resolvedPeople[i]
        if (p.matchStatus !== 'new') continue
        const parts = (p.correctedName || '').trim().split(/\s+/)
        const firstName = parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0]
        const lastName = parts.length > 1 ? parts[parts.length - 1] : null
        const { data: newRec } = await supabase.from('deceased').insert({
          first_name: firstName, last_name: lastName,
          maiden_name: p.geminiData.maiden_name || null,
          date_of_birth_verbatim: p.geminiData.date_of_birth_verbatim || null,
          date_of_death_verbatim: p.geminiData.date_of_death_verbatim || null,
          cemetery_id: CEMETERY_ID,
          notes: 'Identified via StoneQA desktop analysis. Requires curation in Person Research.',
        }).select().single()
        if (newRec) resolvedPeople[i] = { ...p, matchedRecord: newRec }
      }

      const inscriptionText = resolvedPeople.map(p =>
        [p.correctedName, p.geminiData.date_of_birth_verbatim, p.geminiData.date_of_death_verbatim,
          ...(p.geminiData.kinship_hints || [])].filter(Boolean).join(' ')
      ).join(' | ')

      await supabase.from('stones').update({
        inscription_text: inscriptionText,
        stone_condition: stoneMatrix.stone_condition,
        condition_notes: stoneMatrix.stone_notes || null,
        field_status: 'complete',
      }).eq('stone_id', currentEntry.stone_id)

      for (const person of resolvedPeople) {
        if (!person.matchedRecord) continue
        const { error: sdErr } = await supabase.from('stone_deceased').insert({
          stone_id: currentEntry.stone_id,
          deceased_id: person.matchedRecord.deceased_id,
          match_method: 'desktop_qa',
          role: person.role,
        })
        if (sdErr) throw sdErr
        if (person.geminiData.maiden_name && !person.matchedRecord.maiden_name) {
          await supabase.from('deceased')
            .update({ maiden_name: person.geminiData.maiden_name })
            .eq('deceased_id', person.matchedRecord.deceased_id)
        }
      }

      const saveKinshipPair = async (aId, bId, type, hint) => {
        const inv = INVERSE_REL[type] || 'unknown'
        await Promise.all([
          supabase.from('kinship').upsert(
            { primary_deceased_id: aId, relative_deceased_id: bId, relationship_type: type, source: 'stone_inscription', confidence: 'probable', notes: hint },
            { onConflict: 'primary_deceased_id,relative_deceased_id,relationship_type', ignoreDuplicates: true }
          ),
          supabase.from('kinship').upsert(
            { primary_deceased_id: bId, relative_deceased_id: aId, relationship_type: inv, source: 'stone_inscription', confidence: 'probable', notes: hint },
            { onConflict: 'primary_deceased_id,relative_deceased_id,relationship_type', ignoreDuplicates: true }
          ),
        ])
      }

      const createKinStub = async (rawName, note) => {
        const parts = rawName.trim().split(/\s+/)
        const { data: stub } = await supabase.from('deceased').insert({
          first_name: parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0],
          last_name: parts.length > 1 ? parts[parts.length - 1] : null,
          cemetery_id: CEMETERY_ID, notes: note,
        }).select('deceased_id').single()
        return stub?.deceased_id || null
      }

      for (const person of resolvedPeople) {
        if (!person.matchedRecord) continue
        const personId = person.matchedRecord.deceased_id
        const personLabel = person.correctedName || person.matchedRecord.full_name || 'unknown'
        for (const rel of person.confirmedRelationships) {
          if (rel.objectDeceasedId) {
            await saveKinshipPair(personId, rel.objectDeceasedId, rel.type, rel.hint)
          } else if (rel.objectIndex != null) {
            const obj = resolvedPeople[rel.objectIndex]
            if (obj?.matchedRecord) await saveKinshipPair(personId, obj.matchedRecord.deceased_id, rel.type, rel.hint)
          } else if (rel.objectName && rel.objectName !== 'Unknown') {
            const stubId = await createKinStub(rel.objectName,
              `Kin reference: ${rel.type} of ${personLabel}. Named on stone inscription (StoneQA, stone ${currentEntry.stone_id}).`)
            if (stubId) await saveKinshipPair(personId, stubId, rel.type, rel.hint)
          }
        }
      }

      setQueue(prev => prev.filter(s => s.stone_id !== currentEntry.stone_id))
      setCurrentEntry(null)
      resetMatrix()
      setPhase('queue')
    } catch (err) {
      alert('Error saving: ' + err.message)
    }
    setSaving(false)
  }

  // ── Status layer download ─────────────────────────────────────────────────
  const downloadStatusLayer = async () => {
    try {
      const [{ data: photoedData }, { data: stones }] = await Promise.all([
        supabase.from('stone_photos').select('stone_id'),
        supabase.rpc('get_stones_with_coordinates'),
      ])
      const photoedIds = new Set((photoedData || []).map(r => r.stone_id))
      const features = (stones || [])
        .filter(s => photoedIds.has(s.stone_id) && s.lat != null && s.lng != null)
        .map(s => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
          properties: { stone_id: s.stone_id, status: 'photographed' },
        }))
      const blob = new Blob(
        [JSON.stringify({ type: 'FeatureCollection', features }, null, 2)],
        { type: 'application/json' }
      )
      const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(blob),
        download: 'seaview_photographed.geojson',
      })
      a.click()
      URL.revokeObjectURL(a.href)
    } catch (err) {
      alert('Export failed: ' + err.message)
    }
  }

  // ── Render: queue ─────────────────────────────────────────────────────────
  if (phase === 'queue') return (
    <div style={{ minHeight: '100vh', background: 'var(--color-background-primary)', color: 'var(--color-text-primary)', paddingBottom: 60 }}>
      <Header title="Stone QA" subtitle={loading ? 'Loading…' : `${queue.length} stones need QA`} onBack={onBack} />
      <div style={{ maxWidth: 740, margin: '0 auto', padding: 16 }}>
        {error && <p style={{ fontSize: 13, color: 'var(--color-text-danger)', marginBottom: 12 }}>{error}</p>}
        {loading && <p style={{ color: 'var(--color-text-tertiary)', textAlign: 'center', padding: 40 }}>Loading queue…</p>}
        {!loading && queue.length === 0 && (
          <div style={{ textAlign: 'center', padding: 48 }}>
            <p style={{ fontSize: 20, marginBottom: 8 }}>All caught up</p>
            <p style={{ fontSize: 13, color: 'var(--color-text-tertiary)' }}>Every stone with a photo has been matched to a deceased record.</p>
          </div>
        )}
        {queue.map(entry => (
          <div key={entry.stone_id} onClick={() => openStone(entry)}
            style={{ display: 'flex', gap: 12, padding: '10px 12px', borderRadius: 'var(--border-radius-md)', border: '0.5px solid var(--color-border-tertiary)', background: 'var(--color-background-secondary)', marginBottom: 8, cursor: 'pointer' }}>
            <img src={entry.photo_url} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', margin: '0 0 3px', fontFamily: 'monospace' }}>
                {entry.stone_id.slice(0, 8)}…
              </p>
              {entry.field_notes && (
                <p style={{ fontSize: 12, color: 'var(--color-text-success)', margin: '0 0 2px' }}>{entry.field_notes.slice(0, 80)}{entry.field_notes.length > 80 ? '…' : ''}</p>
              )}
              {entry.inscription_text
                ? <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: 0 }}>{entry.inscription_text.slice(0, 100)}{entry.inscription_text.length > 100 ? '…' : ''}</p>
                : <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', margin: 0, fontStyle: 'italic' }}>No inscription yet — Gemini analysis needed</p>}
            </div>
            <span style={{ fontSize: 20, alignSelf: 'center', flexShrink: 0, color: 'var(--color-text-tertiary)' }}>›</span>
          </div>
        ))}
      </div>
    </div>
  )

  // ── Render: photo ─────────────────────────────────────────────────────────
  if (phase === 'photo') return (
    <div style={{ minHeight: '100vh', background: 'var(--color-background-primary)', color: 'var(--color-text-primary)', paddingBottom: 80 }}>
      <Header title="Stone QA" subtitle="Run Gemini to extract inscription data" onBack={() => setPhase('queue')} />
      <div style={{ maxWidth: 600, margin: '0 auto', padding: 16 }}>
        <img src={currentEntry.photo_url} alt="Gravestone" style={{ width: '100%', borderRadius: 8, marginBottom: 16 }} />
        {currentEntry.field_notes && (
          <div style={{ background: 'rgba(34,197,94,0.08)', borderRadius: 8, padding: 12, marginBottom: 12, border: '0.5px solid rgba(34,197,94,0.3)' }}>
            <p style={{ fontSize: 11, color: 'var(--color-text-success)', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: 1 }}>Field notes</p>
            <p style={{ fontSize: 13, color: 'var(--color-text-primary)', margin: 0, fontWeight: 500 }}>{currentEntry.field_notes}</p>
          </div>
        )}
        {currentEntry.inscription_text && (
          <div style={{ background: 'var(--color-background-secondary)', borderRadius: 8, padding: 12, marginBottom: 16, border: '0.5px solid var(--color-border-tertiary)' }}>
            <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: 1 }}>Existing inscription</p>
            <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: 0 }}>{currentEntry.inscription_text}</p>
          </div>
        )}
        {error && <p style={{ fontSize: 12, color: 'var(--color-text-danger)', marginBottom: 12 }}>{error}</p>}
      </div>
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: 'var(--color-background-secondary)', padding: '12px 16px', borderTop: '0.5px solid var(--color-border-secondary)' }}>
        <div style={{ maxWidth: 600, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {currentEntry.inscription_text && (
            <button onClick={skipToMatch}
              style={{ width: '100%', padding: 12, fontSize: 13, fontWeight: 600, background: 'var(--color-background-info)', color: 'var(--color-text-info)', border: '0.5px solid var(--color-border-info)', borderRadius: 6, cursor: 'pointer' }}>
              Match from existing inscription →
            </button>
          )}
          <button onClick={analyzePhoto} disabled={loading}
            style={{ width: '100%', padding: currentEntry.inscription_text ? 10 : 14, fontSize: currentEntry.inscription_text ? 13 : 14, fontWeight: 600 }}>
            {loading ? 'Analyzing… (15-30s)' : currentEntry.inscription_text ? 'Re-run Gemini Analysis' : 'Run Gemini Analysis'}
          </button>
        </div>
      </div>
    </div>
  )

  // ── Render: matrix ────────────────────────────────────────────────────────
  if (phase === 'matrix') return (
    <div style={{ minHeight: '100vh', background: 'var(--color-background-primary)', color: 'var(--color-text-primary)', paddingBottom: 100 }}>
      <Header title="Stone QA — Review" subtitle={`${stoneMatrix.people.length} person${stoneMatrix.people.length !== 1 ? 's' : ''} extracted`} onBack={() => setPhase('photo')} />
      <div style={{ maxWidth: 640, margin: '0 auto', padding: 16 }}>
        <img src={currentEntry.photo_url} alt="Gravestone" style={{ width: '100%', borderRadius: 8, marginBottom: 12 }} />
        {currentEntry.field_notes && (
          <div style={{ background: 'rgba(34,197,94,0.08)', borderRadius: 8, padding: 12, marginBottom: 12, border: '0.5px solid rgba(34,197,94,0.3)' }}>
            <p style={{ fontSize: 11, color: 'var(--color-text-success)', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: 1 }}>Field notes</p>
            <p style={{ fontSize: 13, color: 'var(--color-text-primary)', margin: 0, fontWeight: 500 }}>{currentEntry.field_notes}</p>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
          {['good', 'fair', 'poor', 'illegible'].map(c => (
            <button key={c} onClick={() => setStoneMatrix(prev => ({ ...prev, stone_condition: c }))}
              style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, cursor: 'pointer',
                background: stoneMatrix.stone_condition === c ? 'var(--color-background-success)' : 'var(--color-background-secondary)',
                color: stoneMatrix.stone_condition === c ? 'var(--color-text-success)' : 'var(--color-text-tertiary)',
                border: `0.5px solid ${stoneMatrix.stone_condition === c ? 'var(--color-border-success)' : 'var(--color-border-tertiary)'}` }}>
              {c}
            </button>
          ))}
        </div>
        {stoneMatrix.stone_notes && (
          <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '0 0 16px', fontStyle: 'italic' }}>{stoneMatrix.stone_notes}</p>
        )}
        {!stoneMatrix.stone_notes && <div style={{ marginBottom: 16 }} />}

        {stoneMatrix.people.length === 0 && (
          <div style={{ background: 'var(--color-background-secondary)', borderRadius: 8, padding: 16, marginBottom: 16, border: '0.5px solid var(--color-border-tertiary)' }}>
            <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: 0 }}>Gemini found no people in this photo. Go back and re-analyze, or skip this stone.</p>
          </div>
        )}

        {stoneMatrix.people.map((person, pIndex) => (
          <div key={pIndex} style={{ background: 'var(--color-background-secondary)', borderRadius: 8, padding: 14, marginBottom: 12, border: '0.5px solid var(--color-border-tertiary)' }}>
            <p style={{ fontSize: 11, color: 'var(--color-text-success)', fontWeight: 600, margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: 0.5 }}>Person {pIndex + 1}</p>

            <input type="text" value={person.correctedName}
              onChange={e => updateCorrectedName(pIndex, e.target.value)}
              placeholder="Full name"
              style={{ width: '100%', boxSizing: 'border-box', background: '#fff', border: '2px solid var(--color-border-success)', borderRadius: 6, padding: '8px 10px', fontSize: 14, color: '#111', marginBottom: 8, outline: 'none' }} />

            {person.preSearchResults && (
              <p style={{ fontSize: 11, color: 'var(--color-text-success)', margin: '0 0 8px' }}>
                ✓ {person.preSearchResults.length} database match{person.preSearchResults.length !== 1 ? 'es' : ''} found
              </p>
            )}

            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input type="text" value={person.geminiData.date_of_birth_verbatim || ''}
                onChange={e => setStoneMatrix(prev => ({ ...prev, people: prev.people.map((p, i) => i !== pIndex ? p : { ...p, geminiData: { ...p.geminiData, date_of_birth_verbatim: e.target.value } }) }))}
                placeholder="Born"
                style={{ flex: 1, background: '#fff', border: '1.5px solid var(--color-border-secondary)', borderRadius: 6, padding: '6px 8px', fontSize: 12, color: '#111', outline: 'none' }} />
              <input type="text" value={person.geminiData.date_of_death_verbatim || ''}
                onChange={e => setStoneMatrix(prev => ({ ...prev, people: prev.people.map((p, i) => i !== pIndex ? p : { ...p, geminiData: { ...p.geminiData, date_of_death_verbatim: e.target.value } }) }))}
                placeholder="Died"
                style={{ flex: 1, background: '#fff', border: '1.5px solid var(--color-border-secondary)', borderRadius: 6, padding: '6px 8px', fontSize: 12, color: '#111', outline: 'none' }} />
            </div>
            <input type="text" value={person.geminiData.maiden_name || ''}
              onChange={e => setStoneMatrix(prev => ({ ...prev, people: prev.people.map((p, i) => i !== pIndex ? p : { ...p, geminiData: { ...p.geminiData, maiden_name: e.target.value } }) }))}
              placeholder="Maiden name (nee)"
              style={{ width: '100%', boxSizing: 'border-box', background: '#fff', border: '1.5px solid var(--color-border-secondary)', borderRadius: 6, padding: '6px 8px', fontSize: 12, color: '#111', marginBottom: 8, outline: 'none' }} />

            {person.geminiData.kinship_hints?.length > 0 && (
              <p style={{ fontSize: 11, color: 'var(--color-text-warning)', margin: '0 0 8px' }}>{person.geminiData.kinship_hints.join(', ')}</p>
            )}

            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              {['occupant', 'mentioned'].map(r => (
                <button key={r} onClick={() => updatePersonRole(pIndex, r)}
                  style={{ flex: 1, padding: '6px 0', fontSize: 12, fontWeight: 600, borderRadius: 6, cursor: 'pointer', border: 'none',
                    background: person.role === r ? (r === 'occupant' ? 'var(--color-background-success)' : 'var(--color-background-warning)') : 'var(--color-background-primary)',
                    color: person.role === r ? (r === 'occupant' ? 'var(--color-text-success)' : 'var(--color-text-warning)') : 'var(--color-text-tertiary)' }}>
                  {r === 'occupant' ? '⬛ Buried here' : '📝 Mentioned only'}
                </button>
              ))}
            </div>

            {person.relationships.map((rel, rIndex) => (
              <div key={rIndex} style={{ background: 'var(--color-background-primary)', borderRadius: 6, padding: 10, marginBottom: 8 }}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 4, alignItems: 'center' }}>
                  <select value={rel.type}
                    onChange={e => setStoneMatrix(prev => ({ ...prev, people: prev.people.map((p, i) => i !== pIndex ? p : { ...p, relationships: p.relationships.map((r, ri) => ri !== rIndex ? r : { ...r, type: e.target.value }) }) }))}
                    style={{ fontSize: 11, background: 'var(--color-background-secondary)', color: 'var(--color-text-warning)', border: '0.5px solid var(--color-border-secondary)', borderRadius: 4, padding: '2px 4px', outline: 'none' }}>
                    <option value="spouse">Spouse of</option>
                    <option value="child">Child of</option>
                    <option value="parent">Parent of</option>
                    <option value="sibling">Sibling of</option>
                  </select>
                  <input
                    type="text"
                    value={rel.relatedName ?? rel.rawNames[0] ?? ''}
                    onChange={e => updateRelField(pIndex, rIndex, 'relatedName', e.target.value)}
                    placeholder="name…"
                    style={{ flex: 1, background: '#fff', border: '1.5px solid var(--color-border-warning)', borderRadius: 4, padding: '2px 6px', fontSize: 11, color: '#111', outline: 'none' }}
                  />
                </div>
                {rel.hint && <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '0 0 6px', fontStyle: 'italic' }}>"{rel.hint}"</p>}

                {stoneMatrix.people.filter((_, i) => i !== pIndex).length > 0 && (
                  <div style={{ marginBottom: 6 }}>
                    <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '0 0 4px' }}>Link to person on this stone:</p>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {stoneMatrix.people.filter((_, i) => i !== pIndex).map((other, oIdx) => {
                        const actualIndex = oIdx >= pIndex ? oIdx + 1 : oIdx
                        return (
                          <button key={actualIndex}
                            onClick={() => { confirmRelationship(pIndex, rel, actualIndex); skipRelationship(pIndex, rIndex) }}
                            style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, cursor: 'pointer', background: 'var(--color-background-success)', color: 'var(--color-text-success)', border: 'none' }}>
                            {other.correctedName || `Person ${actualIndex + 1}`}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '0 0 4px' }}>Search database:</p>
                <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                  <input type="text" value={rel.relatedName ?? rel.rawNames[0] ?? ''}
                    onChange={e => updateRelField(pIndex, rIndex, 'relatedName', e.target.value)}
                    placeholder="Name to search…"
                    style={{ flex: 1, background: '#fff', border: '1.5px solid var(--color-border-secondary)', borderRadius: 4, padding: '4px 6px', fontSize: 11, color: '#111', outline: 'none' }} />
                  <button onClick={() => searchRelatedPerson(pIndex, rIndex, rel.relatedName ?? rel.rawNames[0] ?? '')}
                    style={{ fontSize: 11, padding: '4px 8px', borderRadius: 4, cursor: 'pointer', background: 'var(--color-background-info)', color: 'var(--color-text-info)', border: 'none' }}>
                    {rel.relSearching ? '…' : 'Search'}
                  </button>
                </div>
                {rel.relSearchResults?.map((record, ri) => (
                  <button key={ri} onClick={() => confirmRelationshipExternal(pIndex, rIndex, rel, record)}
                    style={{ display: 'block', width: '100%', textAlign: 'left', fontSize: 11, padding: '4px 6px', borderRadius: 4, marginBottom: 2, cursor: 'pointer', background: 'var(--color-background-secondary)', color: 'var(--color-text-primary)', border: '0.5px solid var(--color-border-tertiary)' }}>
                    {record.full_name || [record.first_name, record.last_name].filter(Boolean).join(' ')}
                    {record.date_of_death_verbatim ? ` · d. ${record.date_of_death_verbatim}` : ''}
                  </button>
                ))}
                {(rel.relatedName || rel.rawNames[0]) && (
                  <button onClick={() => confirmRelationshipNameOnly(pIndex, rIndex, rel)}
                    style={{ fontSize: 11, color: 'var(--color-text-warning)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'block', marginBottom: 2 }}>
                    Confirm "{rel.relatedName || rel.rawNames[0]}" without DB match
                  </button>
                )}
                <button onClick={() => skipRelationship(pIndex, rIndex)}
                  style={{ fontSize: 11, color: 'var(--color-text-tertiary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                  Skip relationship
                </button>
              </div>
            ))}

            <button onClick={() => setStoneMatrix(prev => ({ ...prev, people: prev.people.map((p, i) => i !== pIndex ? p : { ...p, relationships: [...p.relationships, { type: 'spouse', rawNames: [], hint: '', implicit: false }] }) }))}
              style={{ fontSize: 11, color: 'var(--color-text-success)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 6 }}>
              + Add relationship
            </button>

            {person.confirmedRelationships.length > 0 && (
              <div>{person.confirmedRelationships.map((rel, i) => (
                <p key={i} style={{ fontSize: 11, color: 'var(--color-text-success)', margin: '2px 0' }}>✓ {REL_LABEL[rel.type] || rel.type} {rel.objectName}</p>
              ))}</div>
            )}
          </div>
        ))}
      </div>

      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: 'var(--color-background-secondary)', padding: '12px 16px', borderTop: '0.5px solid var(--color-border-secondary)' }}>
        <div style={{ maxWidth: 640, margin: '0 auto', display: 'flex', gap: 8 }}>
          <button onClick={() => setPhase('photo')}
            style={{ padding: '10px 16px', fontSize: 13, background: 'transparent', border: '0.5px solid var(--color-border-secondary)', color: 'var(--color-text-secondary)', borderRadius: 6, cursor: 'pointer' }}>
            ← Re-analyze
          </button>
          <button onClick={proceedToMatch} disabled={stoneMatrix.people.length === 0}
            style={{ flex: 1, padding: 12, fontSize: 14, fontWeight: 600 }}>
            Continue → Match to Database
          </button>
        </div>
      </div>
    </div>
  )

  // ── Render: match ─────────────────────────────────────────────────────────
  if (phase === 'match') {
    const allDone = matchingIndex >= stoneMatrix.people.length
    const person = stoneMatrix.people[matchingIndex]

    return (
      <div style={{ minHeight: '100vh', background: 'var(--color-background-primary)', color: 'var(--color-text-primary)', paddingBottom: 100 }}>
        <Header title="Stone QA — Match" subtitle={allDone ? 'Ready to save' : `Person ${matchingIndex + 1} of ${stoneMatrix.people.length}`} onBack={() => setPhase('matrix')} />

        {saving && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
            <div style={{ background: 'var(--color-background-secondary)', borderRadius: 12, padding: 32, textAlign: 'center' }}>
              <p style={{ fontSize: 16, margin: '0 0 8px' }}>Saving…</p>
              <p style={{ fontSize: 13, color: 'var(--color-text-tertiary)', margin: 0 }}>Please wait</p>
            </div>
          </div>
        )}

        <div style={{ maxWidth: 640, margin: '0 auto', padding: 16 }}>
          <div style={{ background: 'var(--color-background-secondary)', borderRadius: 8, padding: 12, marginBottom: 16, border: '0.5px solid var(--color-border-tertiary)' }}>
            <div style={{ display: 'flex', gap: 16 }}>
              {[['matched', 'var(--color-text-success)'], ['new', 'var(--color-text-warning)'], ['skipped', 'var(--color-text-tertiary)'], ['pending', 'var(--color-text-info)']].map(([status, color]) => (
                <span key={status} style={{ fontSize: 12, color }}>
                  {stoneMatrix.people.filter(p => p.matchStatus === status).length} {status}
                </span>
              ))}
            </div>
          </div>

          {allDone ? (
            <div style={{ background: 'var(--color-background-secondary)', borderRadius: 8, padding: 20, border: '0.5px solid var(--color-border-success)', textAlign: 'center' }}>
              <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-success)', margin: '0 0 6px' }}>All people resolved</p>
              <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: 0 }}>
                {stoneMatrix.people.filter(p => p.matchedRecord || p.matchStatus === 'new').length} will be linked · {stoneMatrix.people.filter(p => p.matchStatus === 'skipped').length} skipped
              </p>
            </div>
          ) : person ? (
            <div style={{ background: 'var(--color-background-secondary)', borderRadius: 8, padding: 14, marginBottom: 16, border: '0.5px solid var(--color-border-tertiary)' }}>
              <p style={{ fontSize: 11, color: person.role === 'occupant' ? 'var(--color-text-success)' : 'var(--color-text-warning)', fontWeight: 600, margin: '0 0 4px' }}>
                {person.role === 'occupant' ? '⬛ Occupant' : '📝 Mentioned'}
              </p>
              {person.correctedName
                ? <p style={{ fontSize: 17, fontWeight: 700, margin: '0 0 4px' }}>{person.correctedName}</p>
                : <p style={{ fontSize: 12, color: 'var(--color-text-success)', margin: '0 0 8px', fontStyle: 'italic' }}>Added person — type name to search</p>}
              {person.geminiData.date_of_birth_verbatim && <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '0 0 2px' }}>b. {person.geminiData.date_of_birth_verbatim}</p>}
              {person.geminiData.date_of_death_verbatim && <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: 0 }}>d. {person.geminiData.date_of_death_verbatim}</p>}

              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                  <input type="text" value={matchSearchQuery}
                    autoFocus={!person.correctedName}
                    onChange={e => {
                      setMatchSearchQuery(e.target.value)
                      if (!person.correctedName) updateCorrectedName(matchingIndex, e.target.value)
                    }}
                    onKeyDown={e => e.key === 'Enter' && handleMatchSearch(matchSearchQuery)}
                    placeholder={person.correctedName ? 'Search database…' : 'Name / search…'}
                    style={{ flex: 1, background: '#fff', border: '2px solid var(--color-border-success)', borderRadius: 6, padding: '8px 10px', fontSize: 13, color: '#111', outline: 'none' }} />
                  <button onClick={() => handleMatchSearch(matchSearchQuery)} disabled={matchSearching}
                    style={{ padding: '8px 14px', fontSize: 13, fontWeight: 600, borderRadius: 6, cursor: 'pointer', background: 'var(--color-background-success)', color: 'var(--color-text-success)', border: 'none' }}>
                    {matchSearching ? '…' : 'Search'}
                  </button>
                </div>
                {matchSearchResults.map(record => (
                  <div key={record.deceased_id}
                    onClick={() => {
                      if (!person.correctedName) updateCorrectedName(matchingIndex, matchSearchQuery || record.full_name)
                      selectMatch(record)
                      advancePerson()
                    }}
                    style={{ padding: '10px 12px', borderRadius: 6, marginBottom: 6, cursor: 'pointer', background: record.is_occupant ? 'rgba(234,179,8,0.1)' : 'var(--color-background-primary)', border: `0.5px solid ${record.is_occupant ? 'var(--color-border-warning)' : 'var(--color-border-tertiary)'}` }}>
                    <p style={{ fontSize: 13, fontWeight: 600, margin: '0 0 2px', color: record.is_occupant ? 'var(--color-text-warning)' : 'var(--color-text-primary)' }}>
                      {record.full_name}
                      {record.is_occupant && <span style={{ fontSize: 11, marginLeft: 6 }}>⬛ already buried</span>}
                    </p>
                    <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: 0 }}>
                      {[record.date_of_death_verbatim && `d. ${record.date_of_death_verbatim}`, record.maiden_name && `nee ${record.maiden_name}`].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                ))}
                {!matchSearching && matchSearchAttempted && matchSearchResults.length === 0 && (
                  <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', textAlign: 'center', padding: '8px 0' }}>No matches — try last name only</p>
                )}
              </div>
            </div>
          ) : null}
        </div>

        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: 'var(--color-background-secondary)', padding: '12px 16px', borderTop: '0.5px solid var(--color-border-secondary)' }}>
          <div style={{ maxWidth: 640, margin: '0 auto', display: 'flex', gap: 8 }}>
            {allDone ? (
              <>
                <button onClick={addBlankPerson}
                  style={{ padding: '12px 16px', fontSize: 13, background: 'transparent', border: '0.5px solid var(--color-border-secondary)', color: 'var(--color-text-secondary)', borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  + Add person
                </button>
                <button onClick={saveStoneQA} disabled={saving}
                  style={{ flex: 1, padding: 14, fontSize: 14, fontWeight: 600 }}>
                  Save Stone QA
                </button>
              </>
            ) : matchSearchAttempted && !matchSearching ? (
              <>
                <button onClick={() => { skipMatch(); advancePerson() }}
                  style={{ flex: 1, padding: 12, fontSize: 13, background: 'transparent', border: '0.5px solid var(--color-border-secondary)', color: 'var(--color-text-secondary)', borderRadius: 6, cursor: 'pointer' }}>
                  Skip — no match
                </button>
                <button onClick={() => { markAsNewRecord(); advancePerson() }}
                  style={{ flex: 1, padding: 12, fontSize: 13, fontWeight: 600, background: 'rgba(217,119,6,0.15)', color: 'var(--color-text-warning)', border: '0.5px solid var(--color-border-warning)', borderRadius: 6, cursor: 'pointer' }}>
                  + New record
                </button>
              </>
            ) : (
              <p style={{ fontSize: 13, color: 'var(--color-text-tertiary)', alignSelf: 'center' }}>Search above to find a match</p>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── Render: done (status layer download) ──────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-background-primary)', color: 'var(--color-text-primary)', paddingBottom: 60 }}>
      <Header title="Stone QA" subtitle="Session complete" onBack={onBack} />
      <div style={{ maxWidth: 600, margin: '24px auto', padding: '0 16px' }}>
        <div style={{ background: 'var(--color-background-secondary)', borderRadius: 'var(--border-radius-md)', padding: 20, border: '0.5px solid var(--color-border-tertiary)', marginBottom: 16 }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)', margin: '0 0 6px' }}>Update QField status layer</p>
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '0 0 14px', lineHeight: 1.6 }}>
            Download a GeoJSON of all photographed stones. Add to QGIS as a green point layer, re-package, and push to QFieldCloud.
          </p>
          <button onClick={downloadStatusLayer}
            style={{ padding: '9px 16px', fontSize: 13, fontWeight: 600, background: 'var(--color-background-info)', color: 'var(--color-text-info)', border: '0.5px solid var(--color-border-info)', borderRadius: 6, cursor: 'pointer' }}>
            Download seaview_photographed.geojson
          </button>
        </div>
        <button onClick={() => setPhase('queue')} style={{ width: '100%', padding: 12, fontSize: 13, fontWeight: 600 }}>
          Back to Queue
        </button>
      </div>
    </div>
  )
}
