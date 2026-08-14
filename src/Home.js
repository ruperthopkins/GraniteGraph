import { useState, useRef } from 'react'
import { supabase } from './supabaseClient'
import { useStoneMatrix } from './hooks/useStoneMatrix'
import { cleanNameForSearch } from './utils/stoneMatrixUtils'
import { REL_LABEL, INVERSE_REL } from './constants'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const stoneIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
})

// ── HEADER ───────────────────────────────────────────────────
function Header({ onMap, onRecent, onAdmin, onHome }) {
  return (
    <div className="bg-gray-800 p-4 flex items-center justify-between">
      <h1 className="text-xl font-bold text-green-400 cursor-pointer" onClick={onHome}>
        Granite Graph
      </h1>
      <div className="flex gap-3">
        <button onClick={onMap} className="text-gray-300 text-sm hover:text-white">Map</button>
        <button onClick={onRecent} className="text-gray-300 text-sm hover:text-white">Recent</button>
        {onAdmin && (
          <button onClick={onAdmin} className="text-yellow-400 text-sm hover:text-yellow-300">Admin</button>
        )}
        <button onClick={() => supabase.auth.signOut()} className="text-gray-300 text-sm hover:text-white">Sign Out</button>
      </div>
    </div>
  )
}

// ── MAIN COMPONENT ───────────────────────────────────────────
export default function Home({ session, onMap, onRecent, onAdmin }) {
  // Core mode
  const [mode, setMode] = useState('landing') // landing | photograph | search

  // Photograph phases
  const [photoPhase, setPhotoPhase] = useState('capture') // capture | matrix | match | done

  // Image state
  const [image, setImage] = useState(null)
  const [loading, setLoading] = useState(false)
  const imageBase64Ref = useRef(null)

  const {
    stoneMatrix, setStoneMatrix,
    matchingIndex, setMatchingIndex,
    matchSearchQuery, setMatchSearchQuery,
    matchSearchResults, setMatchSearchResults,
    matchSearching, matchSearchAttempted, setMatchSearchAttempted,
    initMatrix, resetMatrix, prepareMatch,
    updatePersonRole, updateCorrectedName, updateRelField,
    searchRelatedPerson,
    confirmRelationship, skipRelationship,
    confirmRelationshipExternal, confirmRelationshipNameOnly,
    handleMatchSearch, selectMatch, advancePerson, skipMatch, markAsNewRecord,
  } = useStoneMatrix()

  const [saving, setSaving] = useState(false)

  // Plot location
  const [plotNumber, setPlotNumber] = useState('')

  // Field notes
  const [volunteerNotes, setVolunteerNotes] = useState('')
  const [selectedFlags, setSelectedFlags] = useState([])
  const [showNotes, setShowNotes] = useState(false)
  const [savingNotes, setSavingNotes] = useState(false)
  const [gpsStatus, setGpsStatus] = useState(null)

  // Search mode state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const [searchSelected, setSearchSelected] = useState(null)
  const [searchStoneData, setSearchStoneData] = useState(null)
  const [searching, setSearching] = useState(false)
  const [visitorLocation, setVisitorLocation] = useState(null)
  const [locating, setLocating] = useState(false)
  const [pendingPhotoFor, setPendingPhotoFor] = useState(null)

  const fileInput = useRef(null)
  const currentStoneRef = useRef(null)

  // ── IMAGE HANDLING ───────────────────────────────────────
  const handlePhoto = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onloadend = () => {
      const b64 = reader.result.split(',')[1]
      imageBase64Ref.current = b64
      setImage(reader.result)
    }
    reader.readAsDataURL(file)
    currentStoneRef.current = null
    resetMatrix()
    setPhotoPhase('capture')
    setPlotNumber('')
    setVolunteerNotes('')
    setSelectedFlags([])
    setShowNotes(false)
  }

  const resizeImage = (base64) => new Promise((resolve) => {
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
    img.src = 'data:image/jpeg;base64,' + base64
  })

  // ── GEMINI ANALYSIS ──────────────────────────────────────
  const analyzePhoto = async () => {
    if (!imageBase64Ref.current) return
    setLoading(true)
    try {
      const resizedBase64 = await resizeImage(imageBase64Ref.current)
      const geminiResponse = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: resizedBase64 })
      })
      const geminiData = await geminiResponse.json()
      if (!geminiData.candidates || geminiData.candidates.length === 0) {
        throw new Error('Gemini error: ' + (geminiData.error?.message || JSON.stringify(geminiData)))
      }
      const extracted = JSON.parse(geminiData.candidates[0].content.parts[0].text.replace(/```json|```/g, '').trim())
      initMatrix(extracted.people || [], extracted.stone_condition, extracted.stone_notes)
      setPhotoPhase('matrix')
    } catch (err) {
      console.error(err)
      alert('Error analyzing photo: ' + err.message)
    }
    setLoading(false)
  }

  const proceedToMatch = () => {
    if (pendingPhotoFor && stoneMatrix?.people?.[0]?.matchStatus === 'pending') {
      const nextIndex = stoneMatrix.people.length > 1 ? 1 : 0
      const next = stoneMatrix.people[nextIndex]
      setStoneMatrix(prev => ({
        ...prev,
        people: prev.people.map((p, i) =>
          i === 0 ? { ...p, matchedRecord: pendingPhotoFor, matchStatus: 'matched' } : p
        )
      }))
      setMatchingIndex(nextIndex)
      setMatchSearchQuery(cleanNameForSearch(next.correctedName))
      setMatchSearchResults(next.preSearchResults || [])
      setMatchSearchAttempted(!!(next.preSearchResults?.length))
      setPhotoPhase('match')
      return
    }
    prepareMatch()
    setPhotoPhase('match')
  }

  const nextPerson = () => { const done = advancePerson(); if (done) saveStone() }

  // ── GPS ──────────────────────────────────────────────────
  const getAccuratePosition = () => new Promise((resolve, reject) => {
    let bestPosition = null
    let resolved = false
    setGpsStatus('Acquiring GPS...')
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        bestPosition = pos
        const acc = Math.round(pos.coords.accuracy)
        setGpsStatus('GPS: ' + acc + 'm accuracy' + (acc <= 10 ? ' ✓' : ' (improving...)'))
        if (pos.coords.accuracy <= 10) {
          navigator.geolocation.clearWatch(watchId)
          setGpsStatus(null)
          resolved = true
          resolve(pos)
        }
      },
      (err) => { if (bestPosition) { setGpsStatus(null); resolved = true; resolve(bestPosition) } else { reject(err) } },
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 }
    )
    // Take best available fix after 30s rather than making volunteer stand still indefinitely
    setTimeout(() => {
      if (resolved) return
      navigator.geolocation.clearWatch(watchId)
      setGpsStatus(null)
      if (bestPosition) {
        resolve(bestPosition)
      } else { reject(new Error('Could not get GPS position')) }
    }, 30000)
  })

  // ── SAVE EVERYTHING ──────────────────────────────────────
  const saveStone = async () => {
    setSaving(true)
    try {
      // 0. Pre-create deceased records for field-discovered persons (matchStatus === 'new')
      let resolvedPeople = [...stoneMatrix.people]
      for (let i = 0; i < resolvedPeople.length; i++) {
        const p = resolvedPeople[i]
        if (p.matchStatus !== 'new') continue
        const parts = (p.correctedName || '').trim().split(/\s+/)
        const firstName = parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0]
        const lastName  = parts.length > 1 ? parts[parts.length - 1] : null
        const { data: newRec, error } = await supabase.from('deceased').insert({
          first_name: firstName,
          last_name: lastName,
          maiden_name: p.geminiData.maiden_name || null,
          date_of_birth_verbatim: p.geminiData.date_of_birth_verbatim || null,
          date_of_death_verbatim: p.geminiData.date_of_death_verbatim || null,
          cemetery_id: 'd8bd1f88-cdde-4ef2-a448-5ab04d2d8107',
          notes: 'Field-catalogued. Requires curation in Person Research.',
        }).select().single()
        if (!error && newRec) {
          resolvedPeople[i] = { ...p, matchedRecord: newRec }
          await supabase.from('activity_log').insert({
            user_id: session.user.id, action: 'new_record_created', entity_type: 'deceased',
            entity_id: newRec.deceased_id, cemetery_id: 'd8bd1f88-cdde-4ef2-a448-5ab04d2d8107',
            metadata: { full_name: p.correctedName, source: 'field_capture', notes: 'stub from field tool' }
          })
        } else console.warn('New record insert failed:', error?.message)
      }

      // 1. Upload photo
      const b64 = imageBase64Ref.current
      const byteString = atob(b64)
      const byteArray = new Uint8Array(byteString.length)
      for (let i = 0; i < byteString.length; i++) byteArray[i] = byteString.charCodeAt(i)
      const blob = new Blob([byteArray], { type: 'image/jpeg' })
      const fileName = Date.now() + '_' + session.user.id + '.jpg'

      const [position, uploadResult] = await Promise.all([
        getAccuratePosition(),
        supabase.storage.from('Stone_Images').upload(fileName, blob, { contentType: 'image/jpeg' })
      ])
      if (uploadResult.error) throw uploadResult.error

      const lat = position.coords.latitude
      const lng = position.coords.longitude
      const accuracy = position.coords.accuracy
      const { data: { publicUrl } } = supabase.storage.from('Stone_Images').getPublicUrl(fileName)

      // 2. Create stone record
      const occupants = resolvedPeople.filter(p => p.role === 'occupant')
      const inscriptionText = resolvedPeople.map(p =>
        [p.correctedName, p.geminiData.date_of_birth_verbatim, p.geminiData.date_of_death_verbatim,
          ...(p.geminiData.kinship_hints || [])].filter(Boolean).join(' ')
      ).join(' | ')

      const { data: stoneData, error: stoneError } = await supabase.from('stones').insert({
        cemetery_id: 'd8bd1f88-cdde-4ef2-a448-5ab04d2d8107',
        volunteer_notes: volunteerNotes,
        stone_condition: stoneMatrix.stone_condition,
        condition_notes: stoneMatrix.stone_notes,
        inscription_text: inscriptionText,
        field_status: selectedFlags.length > 0 ? 'needs_followup' : 'complete',
        flags: selectedFlags,
        location: 'SRID=4326;POINT(' + lng + ' ' + lat + ')',
        gps_accuracy_m: accuracy,
        plot_number: plotNumber || null
      }).select().single()
      if (stoneError) throw stoneError

      currentStoneRef.current = { stoneData, lat, lng, accuracy }

      // 3. Save photo
      await supabase.from('stone_photos').insert({
        stone_id: stoneData.stone_id, photo_url: publicUrl,
        side: 'front', taken_by: session.user.id, is_primary: true
      })

      // 4. Link matched people to stone
      for (const person of resolvedPeople) {
        if (person.matchedRecord) {
          await supabase.from('stone_deceased').insert({
            stone_id: stoneData.stone_id,
            deceased_id: person.matchedRecord.deceased_id,
            confirmed_by: session.user.id,
            confirmed_at: new Date().toISOString(),
            match_method: 'volunteer_confirmed',
            role: person.role
          })

          // Update maiden name if Gemini found one and record has none
          if (person.geminiData.maiden_name && !person.matchedRecord.maiden_name) {
            await supabase.from('deceased').update({ maiden_name: person.geminiData.maiden_name })
              .eq('deceased_id', person.matchedRecord.deceased_id)
            await supabase.from('activity_log').insert({
              user_id: session.user.id, action: 'maiden_name_added', entity_type: 'deceased',
              entity_id: person.matchedRecord.deceased_id, cemetery_id: 'd8bd1f88-cdde-4ef2-a448-5ab04d2d8107',
              metadata: { maiden_name: person.geminiData.maiden_name, source: 'gemini_stone_ocr', stone_id: stoneData.stone_id }
            })
          }

          // Log activity
          await supabase.from('activity_log').insert({
            user_id: session.user.id, action: 'match_confirmed', entity_type: 'stone_deceased',
            entity_id: stoneData.stone_id, cemetery_id: 'd8bd1f88-cdde-4ef2-a448-5ab04d2d8107',
            metadata: { deceased_name: person.matchedRecord.full_name, role: person.role, gps: { lat, lng, accuracy } }
          })
        }
      }

      // 5. Save confirmed kinship relationships
      const saveKinshipPair = async (aId, bId, typeAtoB, hint, confidence = 'probable') => {
        const typeBtoA = INVERSE_REL[typeAtoB] || 'unknown'
        await Promise.all([
          supabase.from('kinship').upsert(
            { primary_deceased_id: aId, relative_deceased_id: bId, relationship_type: typeAtoB, source: 'stone_inscription', confidence, notes: hint },
            { onConflict: 'primary_deceased_id,relative_deceased_id,relationship_type', ignoreDuplicates: true }
          ),
          supabase.from('kinship').upsert(
            { primary_deceased_id: bId, relative_deceased_id: aId, relationship_type: typeBtoA, source: 'stone_inscription', confidence, notes: hint },
            { onConflict: 'primary_deceased_id,relative_deceased_id,relationship_type', ignoreDuplicates: true }
          ),
        ])
      }

      // Helper: create a kin-reference stub for an unresolved name and return its deceased_id
      const createKinStub = async (rawName, contextNote) => {
        const parts = rawName.trim().split(/\s+/)
        const firstName = parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0]
        const lastName  = parts.length > 1 ? parts[parts.length - 1] : null
        const { data: stub, error } = await supabase.from('deceased').insert({
          first_name: firstName,
          last_name: lastName,
          cemetery_id: 'd8bd1f88-cdde-4ef2-a448-5ab04d2d8107',
          notes: contextNote,
        }).select('deceased_id').single()
        if (error) { console.warn('Kin stub insert failed:', error.message); return null }
        return stub.deceased_id
      }

      for (const person of resolvedPeople) {
        if (!person.matchedRecord) continue
        const personId = person.matchedRecord.deceased_id
        const personLabel = person.correctedName || person.matchedRecord.full_name || 'unknown'

        for (const rel of person.confirmedRelationships) {
          if (rel.objectDeceasedId) {
            // Explicitly matched to a DB record
            await saveKinshipPair(personId, rel.objectDeceasedId, rel.type, rel.hint)
          } else if (rel.objectIndex != null) {
            // Person on same stone — both matched
            const objectPerson = resolvedPeople[rel.objectIndex]
            if (!objectPerson?.matchedRecord) continue
            await saveKinshipPair(personId, objectPerson.matchedRecord.deceased_id, rel.type, rel.hint)
          } else if (rel.objectName && rel.objectName !== 'Unknown') {
            // Confirmed name-only — create a kin-reference stub
            const stubId = await createKinStub(
              rel.objectName,
              `Kin reference: ${rel.type} of ${personLabel}. Named on stone inscription (field capture, stone ${stoneData.stone_id}).`
            )
            if (stubId) await saveKinshipPair(personId, stubId, rel.type, rel.hint, 'possible')
          }
        }

        // Auto-save unconfirmed same-stone relationships by name matching
        for (const rel of person.relationships) {
          const rawName = (rel.relatedName || rel.rawNames?.[0] || '').trim().toLowerCase()
          if (!rawName) continue
          // Try to find this person on the stone
          const sameStoneMatch = resolvedPeople.find((op, oi) =>
            op !== person && op.matchedRecord &&
            (op.correctedName || '').toLowerCase().split(/\s+/).some(w => w.length > 2 && rawName.includes(w))
          )
          if (sameStoneMatch) {
            await saveKinshipPair(personId, sameStoneMatch.matchedRecord.deceased_id, rel.type, rel.hint)
          } else {
            // Unresolved name — create kin-reference stub for external person
            const displayName = rel.relatedName || rel.rawNames?.[0] || ''
            if (!displayName) continue
            const stubId = await createKinStub(
              displayName,
              `Kin reference: ${rel.type} of ${personLabel}. Named on stone inscription (field capture, stone ${stoneData.stone_id}). Needs follow-up — not in local database at time of capture.`
            )
            if (stubId) await saveKinshipPair(personId, stubId, rel.type, rel.hint, 'possible')
          }
        }
      }

      alert('Stone saved! ' + occupants.length + ' occupant(s) cataloged.')
      setPhotoPhase('done')
    } catch (err) {
      console.error(err)
      alert('Error saving stone: ' + err.message)
    }
    setSaving(false)
  }

  const saveNotes = async () => {
    if (!currentStoneRef.current) return
    setSavingNotes(true)
    try {
      const { stoneData } = currentStoneRef.current
      await supabase.from('stones').update({
        volunteer_notes: volunteerNotes,
        flags: selectedFlags,
        field_status: selectedFlags.length > 0 ? 'needs_followup' : 'complete'
      }).eq('stone_id', stoneData.stone_id)
      alert('Notes saved!')
      setShowNotes(false)
    } catch (err) { alert('Error: ' + err.message) }
    setSavingNotes(false)
  }

  const clearAndReset = () => {
    setImage(null); imageBase64Ref.current = null
    setStoneMatrix(null); setPhotoPhase('capture')
    currentStoneRef.current = null
    setVolunteerNotes(''); setSelectedFlags([]); setShowNotes(false)
    setGpsStatus(null); setMatchingIndex(0)
    setMatchSearchQuery(''); setMatchSearchResults([])
    setPendingPhotoFor(null)
    setMode('landing')
  }

  // ── SEARCH FUNCTIONS ─────────────────────────────────────
  const handleVolunteerSearch = async (overrideQuery) => {
    const q = overrideQuery || searchQuery
    if (!q.trim()) return
    setSearching(true); setSearchResults(null); setSearchSelected(null); setSearchStoneData(null)
    const terms = q.trim().split(/[\s,]+/).filter(Boolean)
    let dbQuery = supabase.from('v_deceased_search').select('*')
    if (terms.length === 1) {
      dbQuery = dbQuery.or('first_name.ilike.*' + terms[0] + '*,last_name.ilike.*' + terms[0] + '*,maiden_name.ilike.*' + terms[0] + '*')
    } else {
      const lastName = terms[terms.length - 1]
      const firstTerms = terms.slice(0, -1)
      dbQuery = dbQuery.ilike('last_name', '%' + lastName + '%')
      firstTerms.forEach(term => { dbQuery = dbQuery.or('first_name.ilike.%' + term + '%,middle_name.ilike.%' + term + '%,maiden_name.ilike.%' + term + '%') })
    }
    const { data, error } = await dbQuery.order('last_name').order('first_name').limit(50)
    if (error) { alert('Search error: ' + error.message) } else { setSearchResults(data || []) }
    setSearching(false)
  }

  const selectSearchRecord = async (record) => {
    setSearchSelected(record); setSearchStoneData(null)
    if (record.is_occupant) {
      const { data, error } = await supabase.from('stone_deceased')
        .select('stones ( stone_id, gps_accuracy_m, condition_notes, inscription_text, stone_photos ( photo_url, is_primary ) )')
        .eq('deceased_id', record.deceased_id).limit(1)
      if (!error && data?.[0]?.stones) {
        const { data: coords } = await supabase.rpc('get_stones_with_coordinates')
        const stoneCoord = coords?.find(c => c.stone_id === data[0].stones.stone_id)
        setSearchStoneData({ ...data[0].stones, lat: stoneCoord?.lat, lng: stoneCoord?.lng })
      }
    }
  }

  const getMyLocation = () => {
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      pos => { setVisitorLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setLocating(false) },
      () => { alert('Could not get your location.'); setLocating(false) },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  const openInMaps = (lat, lng) => {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    window.open(isIOS
      ? 'maps://maps.apple.com/?daddr=' + lat + ',' + lng + '&dirflg=w'
      : 'https://www.google.com/maps/dir/?api=1&destination=' + lat + ',' + lng + '&travelmode=walking', '_blank')
  }

  // ── LANDING ──────────────────────────────────────────────
  if (mode === 'landing') {
    return (
      <div className="min-h-screen bg-gray-900 text-white">
        <Header onMap={onMap} onRecent={onRecent} onAdmin={onAdmin} onHome={() => { clearAndReset(); setMode('landing') }} />
        <div className="p-6 max-w-lg mx-auto">
          <p className="text-gray-300 text-center mb-8 mt-4">What would you like to do?</p>
          <input type="file" accept="image/*" capture="environment" ref={fileInput}
            onChange={(e) => { handlePhoto(e); setMode('photograph') }} className="hidden" />
          <button onClick={() => fileInput.current.click()}
            className="w-full bg-green-700 hover:bg-green-600 text-white font-bold py-8 rounded-lg text-xl mb-4">
            📷 Photograph Stone
          </button>
          <button onClick={() => setMode('search')}
            className="w-full bg-gray-700 hover:bg-gray-600 text-white font-bold py-8 rounded-lg text-xl">
            🔍 Search Records
          </button>
        </div>
      </div>
    )
  }

  // ── SEARCH ───────────────────────────────────────────────
  if (mode === 'search') {
    return (
      <div className="min-h-screen bg-gray-900 text-white">
        <Header onMap={onMap} onRecent={onRecent} onAdmin={onAdmin} onHome={() => { clearAndReset(); setMode('landing') }} />
        <div className="p-4 max-w-lg mx-auto">
          <button onClick={() => { setMode('landing'); setSearchResults(null); setSearchSelected(null); setSearchQuery('') }}
            className="text-gray-300 text-sm hover:text-white mb-4">← Back</button>

          {!searchSelected && (
            <>
              <div className="flex gap-2 mb-4">
                <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleVolunteerSearch()}
                  placeholder="Last name, First name, or First Last"
                  className="flex-1 bg-white border-2 border-green-500 rounded-lg p-3 text-gray-900 placeholder-gray-500 outline-none focus:ring-2 focus:ring-green-400 font-medium"
                  autoFocus />
                <button onClick={() => handleVolunteerSearch()} disabled={searching}
                  className="bg-green-700 hover:bg-green-600 text-white font-bold px-4 rounded-lg">
                  {searching ? '...' : 'Search'}
                </button>
              </div>
              {searchResults && (
                <div>
                  <p className="text-green-400 font-bold mb-3">{searchResults.length} result{searchResults.length !== 1 ? 's' : ''} found</p>
                  {searchResults.length === 0 && (
                    <div className="bg-gray-800 rounded-lg p-4"><p className="text-gray-300">No records found.</p></div>
                  )}
                  {searchResults.map(record => (
                    <div key={record.deceased_id} onClick={() => selectSearchRecord(record)}
                      className="bg-gray-800 rounded-lg p-4 mb-2 cursor-pointer hover:bg-gray-700 border border-gray-600">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-bold text-white">{record.full_name}</p>
                          {record.maiden_name && <p className="text-gray-300 text-sm">nee {record.maiden_name}</p>}
                          <div className="flex gap-3 mt-1">
                            {record.date_of_birth_verbatim && <p className="text-gray-300 text-xs">b. {record.date_of_birth_verbatim}</p>}
                            {record.date_of_death_verbatim && <p className="text-gray-300 text-xs">d. {record.date_of_death_verbatim}</p>}
                          </div>
                        </div>
                        <span className={record.is_photographed ? 'text-green-400 text-xs' : 'text-gray-400 text-xs'}>
                          {record.is_photographed ? 'Photographed' : 'Not yet cataloged'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {searchSelected && (
            <div>
              <button onClick={() => { setSearchSelected(null); setSearchStoneData(null) }}
                className="text-gray-300 text-sm hover:text-white mb-4">← Back to results</button>
              {searchStoneData?.stone_photos?.length > 0 && (
                <img src={(searchStoneData.stone_photos.find(p => p.is_primary) || searchStoneData.stone_photos[0]).photo_url}
                  alt="Gravestone" className="w-full rounded-lg mb-4" />
              )}
              <div className="bg-gray-800 rounded-lg p-4 mb-4">
                <h2 className="text-xl font-bold text-white mb-1">{searchSelected.full_name}</h2>
                {searchSelected.maiden_name && <p className="text-gray-300 text-sm mb-2">nee {searchSelected.maiden_name}</p>}
                <div className="flex gap-4">
                  {searchSelected.date_of_birth_verbatim && <div><p className="text-gray-400 text-xs">Born</p><p className="text-white text-sm">{searchSelected.date_of_birth_verbatim}</p></div>}
                  {searchSelected.date_of_death_verbatim && <div><p className="text-gray-400 text-xs">Died</p><p className="text-white text-sm">{searchSelected.date_of_death_verbatim}</p></div>}
                </div>
              </div>
              {searchStoneData && (
                <div className="bg-gray-800 rounded-lg p-4 mb-4">
                  {searchStoneData.condition_notes && <p className="text-gray-300 text-sm mb-2">{searchStoneData.condition_notes}</p>}
                  {searchStoneData.inscription_text && (
                    <div className="mt-2">
                      <p className="text-gray-400 text-xs mb-1">Inscription</p>
                      <p className="text-white text-sm font-mono">{searchStoneData.inscription_text}</p>
                    </div>
                  )}
                </div>
              )}
              {searchStoneData?.lat && searchStoneData?.lng && (
                <div className="mb-4">
                  <p className="text-green-400 font-bold mb-2">Find this stone</p>
                  <div style={{ height: '200px', borderRadius: '8px', overflow: 'hidden', marginBottom: '12px' }}>
                    <MapContainer center={[searchStoneData.lat, searchStoneData.lng]} zoom={19} style={{ height: '100%', width: '100%' }}>
                      <TileLayer attribution='&copy; OpenStreetMap' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                      <Marker position={[searchStoneData.lat, searchStoneData.lng]} icon={stoneIcon}>
                        <Popup>{searchSelected.full_name}</Popup>
                      </Marker>
                    </MapContainer>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => openInMaps(searchStoneData.lat, searchStoneData.lng)}
                      className="flex-1 bg-blue-700 hover:bg-blue-600 text-white py-3 rounded-lg font-bold text-sm">
                      Open in Maps
                    </button>
                    <button onClick={getMyLocation} disabled={locating}
                      className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-3 rounded-lg font-bold text-sm">
                      {locating ? 'Locating...' : visitorLocation ? 'Update Location' : 'Show My Location'}
                    </button>
                  </div>
                </div>
              )}
              {!searchSelected.is_occupant && (
                <div className="bg-gray-800 border border-gray-600 rounded-lg p-4">
                  <p className="text-gray-300 text-sm mb-3">
                    {searchSelected.is_mentioned
                      ? 'This person is mentioned on another stone but has no photographed stone of their own.'
                      : 'This stone has not been photographed yet.'}
                  </p>
                  <label style={{
                    display: 'block', width: '100%', padding: '14px',
                    backgroundColor: '#15803d', color: 'white', fontWeight: 'bold',
                    fontSize: '1rem', borderRadius: '8px', cursor: 'pointer',
                    textAlign: 'center', boxSizing: 'border-box'
                  }}>
                    📷 Photograph this stone now
                    <input type="file" accept="image/*" capture="environment"
                      onChange={(e) => {
                        setPendingPhotoFor(searchSelected)
                        setSearchResults(null); setSearchSelected(null)
                        setSearchQuery(''); setSearchStoneData(null)
                        handlePhoto(e); setMode('photograph')
                      }}
                      style={{ display: 'none' }} />
                  </label>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── PHOTOGRAPH ───────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <Header />
      <div className="p-4 max-w-lg mx-auto">

        {/* ── PHASE: CAPTURE ── */}
        {photoPhase === 'capture' && (
          <>
            <button onClick={() => setMode('landing')} className="text-gray-300 text-sm hover:text-white mb-4">← Back</button>

            {/* Plot number — entered first to confirm location */}
            <div className="bg-gray-800 rounded-lg p-4 mb-4 border border-gray-600">
              <label className="block text-green-400 font-bold text-sm mb-2">Plot Number</label>
              <input
                type="text"
                inputMode="numeric"
                value={plotNumber}
                onChange={e => setPlotNumber(e.target.value)}
                placeholder="Enter plot number"
                className="w-full bg-white border-2 border-green-500 rounded p-3 text-gray-900 text-xl font-bold outline-none focus:ring-2 focus:ring-green-400 placeholder-gray-400"
              />
            </div>

            {pendingPhotoFor && !image && (
              <div className="bg-gray-700 rounded-lg p-4 mb-4">
                <p className="text-green-400 font-bold mb-1">📋 Ready to photograph:</p>
                <p className="text-white font-bold text-lg">{pendingPhotoFor.full_name}</p>
                {pendingPhotoFor.date_of_death_verbatim && <p className="text-gray-300 text-sm">d. {pendingPhotoFor.date_of_death_verbatim}</p>}
                <input type="file" accept="image/*" capture="environment"
                  onChange={(e) => { handlePhoto(e) }}
                  style={{
                    display: 'block', width: '100%', padding: '16px',
                    backgroundColor: '#15803d', color: 'white', fontWeight: 'bold',
                    fontSize: '1.125rem', borderRadius: '8px', marginTop: '12px',
                    cursor: 'pointer', border: 'none'
                  }} />
              </div>
            )}

            {image && (
              <div className="mb-4">
                <img src={image} alt="Gravestone" className="w-full rounded-lg mb-3" />
                <button onClick={analyzePhoto} disabled={loading}
                  className="w-full bg-blue-700 hover:bg-blue-600 disabled:bg-blue-900 text-white font-bold py-3 rounded-lg">
                  {loading ? 'Analyzing...' : 'Analyze with Gemini'}
                </button>
              </div>
            )}

            {!image && !pendingPhotoFor && (
              <input type="file" accept="image/*" capture="environment"
                onChange={(e) => { handlePhoto(e) }}
                style={{
                  display: 'block', width: '100%', padding: '16px',
                  backgroundColor: '#15803d', color: 'white', fontWeight: 'bold',
                  fontSize: '1.125rem', borderRadius: '8px',
                  cursor: 'pointer', border: 'none'
                }} />
            )}
          </>
        )}

        {/* ── PHASE: MATRIX ── */}
        {photoPhase === 'matrix' && stoneMatrix && (
          <>
            <div className="bg-gray-800 rounded-lg p-3 mb-4 border border-green-700">
              <p className="text-green-400 font-bold mb-1">📋 Stone Review</p>
              <p className="text-gray-300 text-xs">Confirm each person and their relationships before matching to the database.</p>
              {stoneMatrix.stone_notes && <p className="text-gray-400 text-xs mt-1">{stoneMatrix.stone_notes}</p>}
            </div>

            {stoneMatrix.people.map((person, pIndex) => (
              <div key={pIndex} className="bg-gray-800 rounded-lg p-4 mb-4 border border-gray-600">
                {/* Person header */}
                <p className="text-green-400 text-xs font-bold mb-2">Person {pIndex + 1}</p>

                <input
                  type="text"
                  value={person.correctedName}
                  onChange={e => updateCorrectedName(pIndex, e.target.value)}
                  className="w-full bg-white border-2 border-green-500 rounded p-2 text-gray-900 text-sm mb-2 outline-none focus:ring-2 focus:ring-green-400 placeholder-gray-500 font-medium"
                  placeholder="Full name"
                />

                {/* Pre-search indicator */}
                {person.preSearchResults && (
                  <p className="text-green-400 text-xs mb-2">
                    ✓ {person.preSearchResults.length} database match{person.preSearchResults.length !== 1 ? 'es' : ''} found
                  </p>
                )}

                <div className="flex gap-2 mb-2">
                  <div className="flex-1">
                    <p className="text-gray-200 text-xs mb-1 font-medium">Born</p>
                    <input
                      type="text"
                      value={person.geminiData.date_of_birth_verbatim || ''}
                      onChange={e => setStoneMatrix(prev => ({
                        ...prev,
                        people: prev.people.map((p, i) => i === pIndex
                          ? { ...p, geminiData: { ...p.geminiData, date_of_birth_verbatim: e.target.value } }
                          : p)
                      }))}
                      placeholder="Birth date"
                      className="w-full bg-white border-2 border-green-500 rounded p-2 text-gray-900 text-xs outline-none focus:ring-2 focus:ring-green-400 placeholder-gray-500 font-medium"
                    />
                  </div>
                  <div className="flex-1">
                    <p className="text-gray-200 text-xs mb-1 font-medium">Died</p>
                    <input
                      type="text"
                      value={person.geminiData.date_of_death_verbatim || ''}
                      onChange={e => setStoneMatrix(prev => ({
                        ...prev,
                        people: prev.people.map((p, i) => i === pIndex
                          ? { ...p, geminiData: { ...p.geminiData, date_of_death_verbatim: e.target.value } }
                          : p)
                      }))}
                      placeholder="Death date"
                      className="w-full bg-white border-2 border-green-500 rounded p-2 text-gray-900 text-xs outline-none focus:ring-2 focus:ring-green-400 placeholder-gray-500 font-medium"
                    />
                  </div>
                </div>

                {/* Maiden name */}
                <div className="mb-2">
                  <p className="text-gray-200 text-xs mb-1 font-medium">Maiden name (nee)</p>
                  <input
                    type="text"
                    value={person.geminiData.maiden_name || ''}
                    onChange={e => setStoneMatrix(prev => ({
                      ...prev,
                      people: prev.people.map((p, i) => i === pIndex
                        ? { ...p, geminiData: { ...p.geminiData, maiden_name: e.target.value } }
                        : p)
                    }))}
                    placeholder="Maiden name if shown on stone"
                    className="w-full bg-white border-2 border-green-500 rounded p-2 text-gray-900 text-xs outline-none focus:ring-2 focus:ring-green-400 placeholder-gray-500 font-medium"
                  />
                </div>

                {/* Kinship hints from Gemini */}
                {person.geminiData.kinship_hints?.length > 0 && (
                  <p className="text-yellow-400 text-xs mb-2">{person.geminiData.kinship_hints.join(', ')}</p>
                )}

                {/* Occupant toggle */}
                <div className="flex gap-2 mb-3">
                  <button
                    onClick={() => updatePersonRole(pIndex, 'occupant')}
                    className={'flex-1 py-2 rounded text-sm font-bold ' + (person.role === 'occupant' ? 'bg-green-700 text-white' : 'bg-gray-700 text-gray-300')}
                  >
                    ⬛ Buried here
                  </button>
                  <button
                    onClick={() => updatePersonRole(pIndex, 'mentioned')}
                    className={'flex-1 py-2 rounded text-sm font-bold ' + (person.role === 'mentioned' ? 'bg-yellow-700 text-white' : 'bg-gray-700 text-gray-300')}
                  >
                    📝 Mentioned only
                  </button>
                </div>

                {/* Suggested relationships */}
                {person.relationships.map((rel, rIndex) => (
                  <div key={rIndex} className="bg-gray-700 rounded p-3 mb-2">
                    {/* Editable type dropdown */}
                    <div className="flex items-center gap-2 mb-1">
                      <select
                        value={rel.type}
                        onChange={e => setStoneMatrix(prev => ({
                          ...prev,
                          people: prev.people.map((p, i) => i !== pIndex ? p : {
                            ...p,
                            relationships: p.relationships.map((r, ri) => ri !== rIndex ? r : { ...r, type: e.target.value })
                          })
                        }))}
                        className="bg-gray-600 text-yellow-400 text-xs font-bold border border-gray-500 rounded px-1 py-0.5 outline-none"
                      >
                        <option value="spouse">Spouse of</option>
                        <option value="child">Child of</option>
                        <option value="parent">Parent of</option>
                        <option value="sibling">Sibling of</option>
                      </select>
                      {rel.rawNames.length > 0 && (
                        <span className="text-yellow-300 text-xs">{rel.rawNames.join(' & ')}</span>
                      )}
                    </div>
                    {rel.hint && <p className="text-gray-400 text-xs mb-2">"{rel.hint}"</p>}

                    {/* Link to another person on stone */}
                    {stoneMatrix.people.filter((_, i) => i !== pIndex).length > 0 && (
                      <>
                        <p className="text-gray-300 text-xs mb-1">Link to person on this stone:</p>
                        <div className="flex flex-wrap gap-1 mb-2">
                          {stoneMatrix.people.filter((_, i) => i !== pIndex).map((otherPerson, oIndex) => {
                            const actualIndex = oIndex >= pIndex ? oIndex + 1 : oIndex
                            return (
                              <button key={actualIndex}
                                onClick={() => { confirmRelationship(pIndex, rel, actualIndex); skipRelationship(pIndex, rIndex) }}
                                className="bg-green-700 hover:bg-green-600 text-white text-xs py-1 px-2 rounded">
                                {otherPerson.correctedName || 'Person ' + (actualIndex + 1)}
                              </button>
                            )
                          })}
                        </div>
                      </>
                    )}

                    {/* Search database for external person */}
                    <p className="text-gray-300 text-xs mb-1">Search database:</p>
                    <div className="flex gap-1 mb-1">
                      <input
                        type="text"
                        value={rel.relatedName ?? rel.rawNames[0] ?? ''}
                        onChange={e => updateRelField(pIndex, rIndex, 'relatedName', e.target.value)}
                        placeholder="Enter name to search…"
                        className="bg-white border-2 border-green-500 text-gray-900 text-xs rounded px-2 py-1 flex-1 outline-none placeholder-gray-500"
                      />
                      <button
                        onClick={() => searchRelatedPerson(pIndex, rIndex, rel.relatedName ?? rel.rawNames[0] ?? '')}
                        className="bg-blue-700 hover:bg-blue-600 text-white text-xs px-2 py-1 rounded"
                      >
                        {rel.relSearching ? '…' : 'Search'}
                      </button>
                    </div>
                    {rel.relSearchResults && rel.relSearchResults.length === 0 && (
                      <p className="text-gray-400 text-xs mb-1">No results found.</p>
                    )}
                    {rel.relSearchResults && rel.relSearchResults.map((record, ri) => (
                      <button key={ri}
                        onClick={() => confirmRelationshipExternal(pIndex, rIndex, rel, record)}
                        className="block w-full text-left bg-gray-600 hover:bg-gray-500 text-xs py-1 px-2 rounded mb-1">
                        <span className="text-white">{record.full_name || [record.first_name, record.last_name].filter(Boolean).join(' ')}</span>
                        <span className="text-gray-400">
                          {record.birth_year ? ` b.${record.birth_year}` : ''}
                          {record.death_year ? ` d.${record.death_year}` : ''}
                        </span>
                        {record.is_occupant && <span className="ml-1 text-green-400">⬛</span>}
                        {record.is_mentioned && <span className="ml-1 text-yellow-300">📝</span>}
                      </button>
                    ))}
                    {(rel.relatedName || rel.rawNames[0]) && (
                      <button
                        onClick={() => confirmRelationshipNameOnly(pIndex, rIndex, rel)}
                        className="text-yellow-400 text-xs hover:text-yellow-300 block mb-1"
                      >
                        Confirm "{rel.relatedName || rel.rawNames[0]}" without DB match
                      </button>
                    )}

                    <button onClick={() => skipRelationship(pIndex, rIndex)}
                      className="text-gray-400 text-xs hover:text-gray-200">
                      Skip this relationship
                    </button>
                  </div>
                ))}

                {/* Add a relationship Gemini missed */}
                <button
                  onClick={() => setStoneMatrix(prev => ({
                    ...prev,
                    people: prev.people.map((p, i) => i !== pIndex ? p : {
                      ...p,
                      relationships: [...p.relationships, { type: 'spouse', rawNames: [], hint: '', implicit: false }]
                    })
                  }))}
                  className="text-green-400 text-xs mb-3 hover:text-green-300"
                >
                  + Add relationship
                </button>

                {/* Confirmed relationships */}
                {person.confirmedRelationships.length > 0 && (
                  <div className="mt-2">
                    {person.confirmedRelationships.map((rel, i) => (
                      <p key={i} className="text-green-400 text-xs">
                        ✓ {REL_LABEL[rel.type] || rel.type} {rel.objectName}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            ))}

            <button onClick={proceedToMatch}
              className="w-full bg-green-700 hover:bg-green-600 text-white font-bold py-4 rounded-lg mb-3">
              Continue → Match to Database
            </button>
            <button onClick={clearAndReset}
              className="w-full bg-gray-700 hover:bg-gray-600 text-white py-3 rounded-lg text-sm">
              Start Over
            </button>
          </>
        )}

        {/* ── PHASE: MATCH ── */}
        {photoPhase === 'match' && stoneMatrix && (
          <>
            {saving && (
              <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50">
                <div className="bg-gray-800 rounded-lg p-6 text-center mx-4">
                  <p className="text-white text-xl mb-2">⏳ Saving...</p>
                  <p className="text-gray-400 text-sm">Please wait, do not tap again</p>
                </div>
              </div>
            )}

            {gpsStatus && (
              <div className="bg-gray-800 rounded-lg p-3 mb-4 border border-blue-700">
                <p className="text-blue-400 text-sm">📍 {gpsStatus}</p>
              </div>
            )}

            <div className="bg-gray-800 rounded-lg p-3 mb-4 border border-green-700">
              <p className="text-green-400 font-bold">
                Match {matchingIndex + 1} of {stoneMatrix.people.length}
              </p>
              <p className="text-gray-300 text-xs">
                {stoneMatrix.people.filter(p => p.matchStatus === 'matched').length} matched •{' '}
                {stoneMatrix.people.filter(p => p.matchStatus === 'new').length > 0 && (
                  <>{stoneMatrix.people.filter(p => p.matchStatus === 'new').length} new record •{' '}</>
                )}
                {stoneMatrix.people.filter(p => p.matchStatus === 'skipped').length} skipped •{' '}
                {stoneMatrix.people.filter(p => p.matchStatus === 'pending').length} pending
              </p>
            </div>

            {/* Current person to match */}
            {(() => {
              const person = stoneMatrix.people[matchingIndex]
              if (!person) return null
              return (
                <div className="bg-gray-800 rounded-lg p-4 mb-4 border border-gray-600">
                  <p className="text-green-400 text-xs font-bold mb-1">
                    {person.role === 'occupant' ? '⬛ Occupant' : '📝 Mentioned'}
                  </p>
                  <p className="text-white font-bold text-lg">{person.correctedName}</p>
                  {person.geminiData.date_of_birth_verbatim && (
                    <p className="text-gray-300 text-sm">b. {person.geminiData.date_of_birth_verbatim}</p>
                  )}
                  {person.geminiData.date_of_death_verbatim && (
                    <p className="text-gray-300 text-sm">d. {person.geminiData.date_of_death_verbatim}</p>
                  )}

                  {person.matchStatus === 'matched' && (
                    <div className="mt-2 bg-green-900 rounded p-2">
                      <p className="text-green-400 text-sm">✓ Matched: {person.matchedRecord.full_name}</p>
                      <button onClick={() => {
                        setStoneMatrix(prev => ({
                          ...prev,
                          people: prev.people.map((p, i) => i === matchingIndex ? { ...p, matchedRecord: null, matchStatus: 'pending' } : p)
                        }))
                        setMatchSearchResults([])
                      }} className="text-gray-400 text-xs hover:text-gray-200 mt-1">Change match</button>
                    </div>
                  )}

                  {person.matchStatus !== 'matched' && (
                    <>
                      <div className="flex gap-2 mt-3 mb-3">
                        <input
                          type="text"
                          value={matchSearchQuery}
                          onChange={e => setMatchSearchQuery(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && handleMatchSearch(matchSearchQuery)}
                          placeholder="Search database..."
                          className="flex-1 bg-white border-2 border-green-500 rounded p-2 text-gray-900 text-sm outline-none focus:ring-2 focus:ring-green-400 font-medium placeholder-gray-500"
                        />
                        <button onClick={() => handleMatchSearch(matchSearchQuery)} disabled={matchSearching}
                          className="bg-green-700 hover:bg-green-600 disabled:bg-gray-600 text-white font-bold px-3 rounded text-sm min-w-[60px]">
                          {matchSearching ? '⏳' : 'Search'}
                        </button>
                      </div>

                      {matchSearching && (
                        <div className="bg-gray-700 rounded p-3 mb-3 text-center">
                          <p className="text-green-400 text-sm">Searching...</p>
                        </div>
                      )}

                      {/* Only show results and skip/save actions when search is complete */}
                      {!matchSearching && matchSearchResults.map(record => (
                        <div key={record.deceased_id}
                          className={'p-3 rounded-lg mb-2 cursor-pointer ' + (record.is_occupant ? 'bg-gray-700 border border-yellow-600' : 'bg-gray-700')}
                          onClick={() => selectMatch(record)}>
                          <p className={'font-bold text-sm ' + (record.is_occupant ? 'text-yellow-400' : 'text-white')}>
                            {record.full_name}
                          </p>
                          <div className="flex items-center gap-2 flex-wrap mt-0.5">
                            <span className="text-gray-300 text-xs">
                              {record.date_of_death_verbatim && 'd. ' + record.date_of_death_verbatim}
                              {record.maiden_name && ' · nee ' + record.maiden_name}
                            </span>
                            {record.is_occupant && <span className="text-green-400 text-xs">⬛ Buried</span>}
                            {record.is_mentioned && <span className="text-yellow-300 text-xs">📝 Mentioned</span>}
                          </div>
                        </div>
                      ))}

                      {!matchSearching && matchSearchAttempted && matchSearchResults.length === 0 && (
                        <p className="text-gray-200 text-sm text-center py-2">No matches found — try a shorter name or last name only</p>
                      )}
                    </>
                  )}
                </div>
              )
            })()}

            <div className="flex gap-2 mb-4">
  {stoneMatrix.people[matchingIndex]?.matchStatus === 'matched' ? (
    <button onClick={nextPerson} disabled={saving}
      className="flex-1 bg-green-700 hover:bg-green-600 disabled:bg-gray-600 text-white font-bold py-3 rounded-lg">
      {saving ? '⏳ Saving...' : matchingIndex + 1 < stoneMatrix.people.length ? 'Next Person →' : '💾 Save Stone'}
    </button>
  ) : matchSearching ? (
    <p className="text-green-400 text-sm py-3">⏳ Searching...</p>
  ) : matchSearchAttempted ? (
    <>
      <button onClick={() => { skipMatch(); nextPerson() }} disabled={saving}
        className="flex-1 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 text-white py-3 rounded-lg text-sm">
        Skip — no match
      </button>
      <button onClick={() => { markAsNewRecord(); nextPerson() }} disabled={saving}
        className="flex-1 bg-amber-700 hover:bg-amber-600 disabled:bg-gray-600 text-white font-bold py-3 rounded-lg text-sm">
        + New record
      </button>
    </>
  ) : (
    <p className="text-gray-400 text-sm py-3">Search above to find a match</p>
  )}
</div>

            {/* Field notes */}
            <div className="mb-4">
              <button onClick={() => setShowNotes(!showNotes)}
                className="w-full bg-gray-800 border border-gray-600 rounded-lg py-3 px-4 text-left text-gray-300 text-sm flex items-center justify-between">
                <span>📝 Add Field Notes (optional)</span>
                <span>{showNotes ? '▲' : '▼'}</span>
              </button>
              {showNotes && (
                <div className="bg-gray-800 border border-gray-600 border-t-0 rounded-b-lg p-4">
                  <textarea value={volunteerNotes} onChange={e => setVolunteerNotes(e.target.value)}
                    placeholder="Observations about this stone..."
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg p-3 text-white placeholder-gray-400 text-sm outline-none focus:ring-2 focus:ring-green-500 mb-3"
                    rows={3} />
                  <p className="text-gray-400 text-xs mb-2">Flag for follow-up:</p>
                  {['Needs re-photographing', 'Check back or other side', 'Stone needs cleaning',
                    'Person not in database — needs new record', 'Other issue'].map(flag => (
                    <label key={flag} className="flex items-center gap-2 mb-2 cursor-pointer">
                      <input type="checkbox" checked={selectedFlags.includes(flag)}
                        onChange={e => {
                          if (e.target.checked) setSelectedFlags(prev => [...prev, flag])
                          else setSelectedFlags(prev => prev.filter(f => f !== flag))
                        }} className="w-4 h-4" />
                      <span className="text-gray-300 text-sm">{flag}</span>
                    </label>
                  ))}
                  {(volunteerNotes || selectedFlags.length > 0) && (
                    <button onClick={saveNotes} disabled={savingNotes}
                      className="w-full bg-green-700 hover:bg-green-600 disabled:bg-gray-600 text-white font-bold py-2 rounded-lg text-sm mt-2">
                      {savingNotes ? 'Saving...' : 'Save Notes'}
                    </button>
                  )}
                </div>
              )}
            </div>

            <button onClick={clearAndReset} className="w-full bg-gray-700 hover:bg-gray-600 text-white py-3 rounded-lg text-sm">
              Start Over
            </button>
          </>
        )}

        {/* ── PHASE: DONE ── */}
        {photoPhase === 'done' && (
          <div className="text-center py-12">
            <p className="text-green-400 text-4xl mb-4">✓</p>
            <p className="text-white text-xl font-bold mb-2">Stone Saved!</p>
            <p className="text-gray-300 text-sm mb-8">
              {stoneMatrix?.people?.filter(p => p.matchStatus === 'matched').length || 0} matched •{' '}
              {stoneMatrix?.people?.filter(p => p.matchStatus === 'skipped').length || 0} skipped
            </p>
            <button onClick={clearAndReset}
              className="w-full bg-green-700 hover:bg-green-600 text-white font-bold py-4 rounded-lg text-lg">
              📷 Photograph Another Stone
            </button>
          </div>
        )}

      </div>
    </div>
  )
}
