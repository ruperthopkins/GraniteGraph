import { useState, useEffect, useRef } from 'react'
import { supabase } from '../supabaseClient'
import { CEMETERY_ID, REL_LABEL, INVERSE_REL } from '../constants'

// ── Kinship hint parser ───────────────────────────────────────────────────────
function parseKinshipHints(hints) {
  if (!hints?.length) return []
  const out = []
  hints.forEach(hint => {
    const h = hint.trim()
    if (/\b(his|her)\s+wife\b/i.test(h)) { out.push({ type: 'spouse', rawNames: [], hint, implicit: true }); return }
    const spouseM = h.match(/\b(?:wife|husband|spouse|consort)\s+of\s+(.+)/i)
    if (spouseM) { out.push({ type: 'spouse', rawNames: [spouseM[1].trim().replace(/\.$/, '')], hint, implicit: false }); return }
    const childM = h.match(/\b(?:son|daughter|child)\s+of\s+(.+)/i)
    if (childM) {
      const names = childM[1].trim().replace(/\.$/, '').split(/\s+and\s+|\s*&\s*/i).map(n => n.trim()).filter(n => n.length > 2)
      out.push({ type: 'child', rawNames: names, hint, implicit: false }); return
    }
    if (/\btheir\s+(?:son|daughter|child)\b/i.test(h)) { out.push({ type: 'child', rawNames: [], hint, implicit: true, theirChild: true }); return }
    const parentM = h.match(/\b(?:father|mother|parent)\s+of\s+(.+)/i)
    if (parentM) {
      const names = parentM[1].trim().replace(/\.$/, '').split(/\s+and\s+|\s*&\s*/i).map(n => n.trim()).filter(n => n.length > 2)
      out.push({ type: 'parent', rawNames: names, hint, implicit: false }); return
    }
    const sibM = h.match(/\b(?:brother|sister|sibling)\s+of\s+(.+)/i)
    if (sibM) {
      const names = sibM[1].trim().replace(/\.$/, '').split(/\s+and\s+|\s*&\s*/i).map(n => n.trim()).filter(n => n.length > 2)
      out.push({ type: 'sibling', rawNames: names, hint, implicit: false })
    }
  })
  return out
}

async function urlToBase64(url) {
  const resp = await fetch(url)
  const blob = await resp.blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(blob)
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
  const [stoneMatrix, setStoneMatrix] = useState(null)
  const [matchingIndex, setMatchingIndex] = useState(0)
  const [matchSearchQuery, setMatchSearchQuery] = useState('')
  const [matchSearchResults, setMatchSearchResults] = useState([])
  const [matchSearching, setMatchSearching] = useState(false)
  const [matchSearchAttempted, setMatchSearchAttempted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const autoSearchTimer = useRef(null)
  const stoneMatrixRef = useRef(null)

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
        .select('photo_id, stone_id, photo_url, is_primary, stones(inscription_text, stone_condition)')
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
    setStoneMatrix(null)
    setMatchingIndex(0)
    setMatchSearchQuery('')
    setMatchSearchResults([])
    setMatchSearchAttempted(false)
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
      const people = (extracted.people || []).map((p, index) => ({
        index,
        geminiData: p,
        correctedName: [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' '),
        role: 'occupant',
        relationships: parseKinshipHints(p.kinship_hints || []),
        confirmedRelationships: [],
        matchedRecord: null,
        matchStatus: 'pending',
      }))
      const matrix = {
        stone_condition: extracted.stone_condition || currentEntry.stone_condition || 'fair',
        stone_notes: extracted.stone_notes || '',
        people,
      }
      stoneMatrixRef.current = matrix
      setStoneMatrix(matrix)
      setPhase('matrix')
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  // ── Matrix handlers ───────────────────────────────────────────────────────
  const updatePersonRole = (index, role) =>
    setStoneMatrix(prev => ({ ...prev, people: prev.people.map((p, i) => i === index ? { ...p, role } : p) }))

  const updateCorrectedName = (index, name) => {
    setStoneMatrix(prev => {
      const next = { ...prev, people: prev.people.map((p, i) => i === index ? { ...p, correctedName: name } : p) }
      stoneMatrixRef.current = next
      return next
    })
    if (autoSearchTimer.current) clearTimeout(autoSearchTimer.current)
    autoSearchTimer.current = setTimeout(() => preSearchPerson(index, name), 800)
  }

  const preSearchPerson = async (index, name) => {
    if (!name.trim() || name.trim().length < 3) return
    const terms = name.trim().split(/[\s,]+/).filter(Boolean)
    let q = supabase.from('v_deceased_search').select('*')
    if (terms.length === 1) {
      q = q.or(`first_name.ilike.*${terms[0]}*,last_name.ilike.*${terms[0]}*,maiden_name.ilike.*${terms[0]}*`)
    } else {
      q = q.ilike('last_name', `%${terms[terms.length - 1]}%`)
      terms.slice(0, -1).forEach(t => q = q.or(`first_name.ilike.%${t}%,middle_name.ilike.%${t}%,maiden_name.ilike.%${t}%`))
    }
    const yr = (stoneMatrixRef.current?.people?.[index]?.geminiData?.date_of_death_verbatim || '').match(/\d{4}/)?.[0]
    if (yr) {
      const y = parseInt(yr)
      if (y >= 1700 && y <= 2030)
        q = q.or(`date_of_death.is.null,and(date_of_death.gte.${y - 15}-01-01,date_of_death.lte.${y + 15}-12-31)`)
    }
    const { data } = await q.order('last_name').order('first_name').limit(20)
    if (data) setStoneMatrix(prev => {
      const next = { ...prev, people: prev.people.map((p, i) => i === index ? { ...p, preSearchResults: data } : p) }
      stoneMatrixRef.current = next
      return next
    })
  }

  const updateRelField = (pIndex, rIndex, field, value) =>
    setStoneMatrix(prev => ({
      ...prev,
      people: prev.people.map((p, i) => i !== pIndex ? p : {
        ...p, relationships: p.relationships.map((r, ri) => ri !== rIndex ? r : { ...r, [field]: value })
      })
    }))

  const searchRelatedPerson = async (pIndex, rIndex, name) => {
    if (!name.trim()) return
    setStoneMatrix(prev => ({
      ...prev,
      people: prev.people.map((p, i) => i !== pIndex ? p : {
        ...p, relationships: p.relationships.map((r, ri) => ri !== rIndex ? r : { ...r, relSearching: true, relSearchResults: null })
      })
    }))
    const terms = name.trim().split(/\s+/)
    let q = supabase.from('v_deceased_search').select('*')
    if (terms.length === 1) {
      q = q.or(`first_name.ilike.*${terms[0]}*,last_name.ilike.*${terms[0]}*,maiden_name.ilike.*${terms[0]}*`)
    } else {
      q = q.ilike('last_name', `%${terms[terms.length - 1]}%`)
      terms.slice(0, -1).forEach(t => q = q.or(`first_name.ilike.%${t}%,middle_name.ilike.%${t}%,maiden_name.ilike.%${t}%`))
    }
    const { data } = await q.limit(5)
    setStoneMatrix(prev => ({
      ...prev,
      people: prev.people.map((p, i) => i !== pIndex ? p : {
        ...p, relationships: p.relationships.map((r, ri) => ri !== rIndex ? r : { ...r, relSearching: false, relSearchResults: data || [] })
      })
    }))
  }

  const confirmRelationship = (personIndex, rel, objectIndex) =>
    setStoneMatrix(prev => {
      const people = [...prev.people]
      const person = { ...people[personIndex] }
      person.confirmedRelationships = [...person.confirmedRelationships, {
        type: rel.type, hint: rel.hint, objectIndex,
        objectName: people[objectIndex]?.correctedName || rel.rawNames[0] || 'Unknown'
      }]
      people[personIndex] = person
      return { ...prev, people }
    })

  const skipRelationship = (personIndex, relIndex) =>
    setStoneMatrix(prev => ({
      ...prev,
      people: prev.people.map((p, i) => i !== personIndex ? p : {
        ...p, relationships: p.relationships.filter((_, ri) => ri !== relIndex)
      })
    }))

  const confirmRelationshipExternal = (pIndex, rIndex, rel, record) => {
    const objectName = record.full_name || [record.first_name, record.last_name].filter(Boolean).join(' ')
    setStoneMatrix(prev => {
      const people = [...prev.people]
      const person = { ...people[pIndex] }
      const rels = [...person.relationships]; rels.splice(rIndex, 1)
      person.relationships = rels
      person.confirmedRelationships = [...person.confirmedRelationships,
        { type: rel.type, hint: rel.hint, objectIndex: null, objectDeceasedId: record.deceased_id, objectName }]
      people[pIndex] = person
      return { ...prev, people }
    })
  }

  const confirmRelationshipNameOnly = (pIndex, rIndex, rel) => {
    const objectName = rel.relatedName || rel.rawNames[0] || 'Unknown'
    setStoneMatrix(prev => {
      const people = [...prev.people]
      const person = { ...people[pIndex] }
      const rels = [...person.relationships]; rels.splice(rIndex, 1)
      person.relationships = rels
      person.confirmedRelationships = [...person.confirmedRelationships,
        { type: rel.type, hint: rel.hint, objectIndex: null, objectDeceasedId: null, objectName }]
      people[pIndex] = person
      return { ...prev, people }
    })
  }

  // ── Match handlers ────────────────────────────────────────────────────────
  const cleanName = (name) =>
    name.replace(/\b[A-Z]\.\s*/g, '').replace(/\([^)]*\)/g, '').replace(/[.,;:'"]/g, '').replace(/\s+/g, ' ').trim()

  const proceedToMatch = () => {
    supabase.from('v_deceased_search').select('deceased_id').limit(1) // warm connection
    setMatchingIndex(0)
    const first = stoneMatrix?.people?.[0]
    if (first) {
      setMatchSearchQuery(cleanName(first.correctedName))
      setMatchSearchResults(first.preSearchResults || [])
      setMatchSearchAttempted(!!first.preSearchResults)
    }
    setPhase('match')
  }

  const handleMatchSearch = async (query) => {
    if (!query.trim()) return
    setMatchSearching(true); setMatchSearchResults([]); setMatchSearchAttempted(true)
    const buildQ = () => {
      const terms = query.trim().split(/[\s,]+/).filter(Boolean)
      let q = supabase.from('v_deceased_search').select('*')
      if (terms.length === 1) {
        q = q.or(`first_name.ilike.*${terms[0]}*,last_name.ilike.*${terms[0]}*,maiden_name.ilike.*${terms[0]}*`)
      } else {
        q = q.ilike('last_name', `%${terms[terms.length - 1]}%`)
        terms.slice(0, -1).forEach(t => q = q.or(`first_name.ilike.%${t}%,middle_name.ilike.%${t}%,maiden_name.ilike.%${t}%`))
      }
      const yr = (stoneMatrix?.people?.[matchingIndex]?.geminiData?.date_of_death_verbatim || '').match(/\d{4}/)?.[0]
      if (yr) {
        const y = parseInt(yr)
        if (y >= 1700 && y <= 2030)
          q = q.or(`date_of_death.is.null,and(date_of_death.gte.${y - 15}-01-01,date_of_death.lte.${y + 15}-12-31)`)
      }
      return q.order('last_name').order('first_name').limit(20)
    }
    let { data, error } = await buildQ()
    if (error || !data) { await new Promise(r => setTimeout(r, 400)); ;({ data, error } = await buildQ()) }
    if (!error) setMatchSearchResults(data || [])
    setMatchSearching(false)
  }

  const selectMatch = (record) =>
    setStoneMatrix(prev => ({
      ...prev,
      people: prev.people.map((p, i) => i === matchingIndex ? { ...p, matchedRecord: record, matchStatus: 'matched' } : p)
    }))

  const advancePerson = () => {
    const next = matchingIndex + 1
    if (next < stoneMatrix.people.length) {
      setMatchingIndex(next)
      const nextP = stoneMatrix.people[next]
      setMatchSearchQuery(cleanName(nextP.correctedName))
      setMatchSearchResults(nextP.preSearchResults || [])
      setMatchSearchAttempted(!!nextP.preSearchResults)
    } else {
      setMatchingIndex(stoneMatrix.people.length) // sentinel: all done, show save button
    }
  }

  const skipMatch = () => {
    setStoneMatrix(prev => ({
      ...prev,
      people: prev.people.map((p, i) => i === matchingIndex ? { ...p, matchStatus: 'skipped' } : p)
    }))
    advancePerson()
  }

  const markAsNewRecord = () => {
    setStoneMatrix(prev => ({
      ...prev,
      people: prev.people.map((p, i) => i === matchingIndex ? { ...p, matchStatus: 'new' } : p)
    }))
    advancePerson()
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  const saveStoneQA = async () => {
    setSaving(true)
    try {
      let resolvedPeople = [...stoneMatrix.people]

      // Create new deceased records for unmatched people marked as new
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

      // Update stone record
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

      // stone_deceased links
      for (const person of resolvedPeople) {
        if (!person.matchedRecord) continue
        await supabase.from('stone_deceased').insert({
          stone_id: currentEntry.stone_id,
          deceased_id: person.matchedRecord.deceased_id,
          match_method: 'desktop_qa',
          role: person.role,
        })
        if (person.geminiData.maiden_name && !person.matchedRecord.maiden_name) {
          await supabase.from('deceased')
            .update({ maiden_name: person.geminiData.maiden_name })
            .eq('deceased_id', person.matchedRecord.deceased_id)
        }
      }

      // Kinship
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
      setStoneMatrix(null)
      setPhase('queue')
    } catch (err) {
      alert('Error saving: ' + err.message)
    }
    setSaving(false)
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
        {currentEntry.inscription_text && (
          <div style={{ background: 'var(--color-background-secondary)', borderRadius: 8, padding: 12, marginBottom: 16, border: '0.5px solid var(--color-border-tertiary)' }}>
            <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: 1 }}>Existing inscription</p>
            <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: 0 }}>{currentEntry.inscription_text}</p>
          </div>
        )}
        {error && <p style={{ fontSize: 12, color: 'var(--color-text-danger)', marginBottom: 12 }}>{error}</p>}
      </div>
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: 'var(--color-background-secondary)', padding: '12px 16px', borderTop: '0.5px solid var(--color-border-secondary)' }}>
        <div style={{ maxWidth: 600, margin: '0 auto' }}>
          <button onClick={analyzePhoto} disabled={loading}
            style={{ width: '100%', padding: 14, fontSize: 14, fontWeight: 600 }}>
            {loading ? 'Analyzing… (15-30s)' : 'Run Gemini Analysis'}
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
        {/* Thumbnail + condition */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
          <img src={currentEntry.photo_url} alt="" style={{ width: 72, height: 96, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
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
              <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: 0, fontStyle: 'italic' }}>{stoneMatrix.stone_notes}</p>
            )}
          </div>
        </div>

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
                  {rel.rawNames.length > 0 && <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{rel.rawNames.join(' & ')}</span>}
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
          {/* Progress summary */}
          <div style={{ background: 'var(--color-background-secondary)', borderRadius: 8, padding: 12, marginBottom: 16, border: '0.5px solid var(--color-border-tertiary)' }}>
            <div style={{ display: 'flex', gap: 16 }}>
              {[['matched', 'var(--color-text-success)'], ['new', 'var(--color-text-warning)'], ['skipped', 'var(--color-text-tertiary)'], ['pending', 'var(--color-text-info)']].map(([status, color]) => (
                <span key={status} style={{ fontSize: 12, color }}>
                  {stoneMatrix.people.filter(p => p.matchStatus === status).length} {status}
                </span>
              ))}
            </div>
          </div>

          {/* Current person or all-done state */}
          {allDone ? (
            <div style={{ background: 'var(--color-background-secondary)', borderRadius: 8, padding: 24, border: '0.5px solid var(--color-border-success)', textAlign: 'center' }}>
              <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-success)', margin: '0 0 8px' }}>All people resolved</p>
              <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: 0 }}>
                {stoneMatrix.people.filter(p => p.matchedRecord || p.matchStatus === 'new').length} will be linked to this stone.
              </p>
            </div>
          ) : person ? (
            <div style={{ background: 'var(--color-background-secondary)', borderRadius: 8, padding: 14, marginBottom: 16, border: '0.5px solid var(--color-border-tertiary)' }}>
              <p style={{ fontSize: 11, color: person.role === 'occupant' ? 'var(--color-text-success)' : 'var(--color-text-warning)', fontWeight: 600, margin: '0 0 4px' }}>
                {person.role === 'occupant' ? '⬛ Occupant' : '📝 Mentioned'}
              </p>
              <p style={{ fontSize: 17, fontWeight: 700, margin: '0 0 4px' }}>{person.correctedName}</p>
              {person.geminiData.date_of_birth_verbatim && <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '0 0 2px' }}>b. {person.geminiData.date_of_birth_verbatim}</p>}
              {person.geminiData.date_of_death_verbatim && <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: 0 }}>d. {person.geminiData.date_of_death_verbatim}</p>}

              {person.matchStatus === 'matched' ? (
                <div style={{ marginTop: 10, background: 'rgba(16,185,129,0.1)', borderRadius: 6, padding: 10 }}>
                  <p style={{ fontSize: 13, color: 'var(--color-text-success)', margin: '0 0 4px' }}>✓ Matched: {person.matchedRecord.full_name}</p>
                  <button onClick={() => { setStoneMatrix(prev => ({ ...prev, people: prev.people.map((p, i) => i === matchingIndex ? { ...p, matchedRecord: null, matchStatus: 'pending' } : p) })); setMatchSearchResults([]) }}
                    style={{ fontSize: 11, color: 'var(--color-text-tertiary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                    Change match
                  </button>
                </div>
              ) : (
                <div style={{ marginTop: 12 }}>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                    <input type="text" value={matchSearchQuery}
                      onChange={e => setMatchSearchQuery(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleMatchSearch(matchSearchQuery)}
                      placeholder="Search database…"
                      style={{ flex: 1, background: '#fff', border: '2px solid var(--color-border-success)', borderRadius: 6, padding: '8px 10px', fontSize: 13, color: '#111', outline: 'none' }} />
                    <button onClick={() => handleMatchSearch(matchSearchQuery)} disabled={matchSearching}
                      style={{ padding: '8px 14px', fontSize: 13, fontWeight: 600, borderRadius: 6, cursor: 'pointer', background: 'var(--color-background-success)', color: 'var(--color-text-success)', border: 'none' }}>
                      {matchSearching ? '…' : 'Search'}
                    </button>
                  </div>
                  {matchSearchResults.map(record => (
                    <div key={record.deceased_id} onClick={() => selectMatch(record)}
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
              )}
            </div>
          ) : null}
        </div>

        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: 'var(--color-background-secondary)', padding: '12px 16px', borderTop: '0.5px solid var(--color-border-secondary)' }}>
          <div style={{ maxWidth: 640, margin: '0 auto', display: 'flex', gap: 8 }}>
            {allDone ? (
              <button onClick={saveStoneQA} disabled={saving}
                style={{ flex: 1, padding: 14, fontSize: 14, fontWeight: 600 }}>
                Save Stone QA
              </button>
            ) : person?.matchStatus === 'matched' ? (
              <button onClick={advancePerson}
                style={{ flex: 1, padding: 14, fontSize: 14, fontWeight: 600 }}>
                {matchingIndex + 1 < stoneMatrix.people.length ? 'Next Person →' : 'Review & Save →'}
              </button>
            ) : matchSearchAttempted && !matchSearching ? (
              <>
                <button onClick={skipMatch}
                  style={{ flex: 1, padding: 12, fontSize: 13, background: 'transparent', border: '0.5px solid var(--color-border-secondary)', color: 'var(--color-text-secondary)', borderRadius: 6, cursor: 'pointer' }}>
                  Skip — no match
                </button>
                <button onClick={markAsNewRecord}
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

  return null
}
