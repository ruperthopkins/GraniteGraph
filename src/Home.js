import { useState, useRef } from 'react'
import { supabase } from './supabaseClient'
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

// ── KINSHIP PARSER ───────────────────────────────────────────
const parseKinshipHints = (hints) => {
  if (!hints || hints.length === 0) return []
  const relationships = []
  hints.forEach(hint => {
    const h = hint.trim()
    if (/\b(his|her)\s+wife\b/i.test(h)) {
      relationships.push({ type: 'spouse', rawNames: [], hint, implicit: true })
      return
    }
    const spouseMatch = h.match(/\b(?:wife|husband|spouse|consort)\s+of\s+(.+)/i)
    if (spouseMatch) {
      relationships.push({ type: 'spouse', rawNames: [spouseMatch[1].trim().replace(/\.$/, '')], hint, implicit: false })
      return
    }
    const childMatch = h.match(/\b(?:son|daughter|child)\s+of\s+(.+)/i)
    if (childMatch) {
      const parentNames = childMatch[1].trim().replace(/\.$/, '').split(/\s+and\s+|\s*&\s*/i).map(n => n.trim()).filter(n => n.length > 2)
      relationships.push({ type: 'child', rawNames: parentNames, hint, implicit: false })
      return
    }
    if (/\btheir\s+(?:son|daughter|child)\b/i.test(h)) {
      relationships.push({ type: 'child', rawNames: [], hint, implicit: true, theirChild: true })
      return
    }
    const parentMatch = h.match(/\b(?:father|mother|parent)\s+of\s+(.+)/i)
    if (parentMatch) {
      const childNames = parentMatch[1].trim().replace(/\.$/, '').split(/\s+and\s+|\s*&\s*/i).map(n => n.trim()).filter(n => n.length > 2)
      relationships.push({ type: 'parent', rawNames: childNames, hint, implicit: false })
      return
    }
    const siblingMatch = h.match(/\b(?:brother|sister|sibling)\s+of\s+(.+)/i)
    if (siblingMatch) {
      const siblingNames = siblingMatch[1].trim().replace(/\.$/, '').split(/\s+and\s+|\s*&\s*/i).map(n => n.trim()).filter(n => n.length > 2)
      relationships.push({ type: 'sibling', rawNames: siblingNames, hint, implicit: false })
    }
  })
  return relationships
}

const REL_LABEL = {
  spouse: 'Spouse of',
  child: 'Child of',
  parent: 'Parent of',
  sibling: 'Sibling of',
}

const INVERSE_REL = {
  spouse: 'spouse',
  child: 'parent',
  parent: 'child',
  sibling: 'sibling',
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

  // Stone matrix — the heart of the new workflow
  const [stoneMatrix, setStoneMatrix] = useState(null)
  // stoneMatrix = {
  //   stone_condition, stone_notes,
  //   people: [{
  //     index, geminiData, correctedName,
  //     role: 'occupant'|'mentioned',
  //     relationships: [{type, rawNames, hint, implicit}],
  //     confirmedRelationships: [{type, subjectIndex, objectIndex, objectName}],
  //     matchedRecord: null | deceased record,
  //     matchStatus: 'pending'|'matched'|'skipped'|'new'
  //   }]
  // }

  // Match phase state
  const [matchingIndex, setMatchingIndex] = useState(0)
  const [matchSearchQuery, setMatchSearchQuery] = useState('')
  const [matchSearchResults, setMatchSearchResults] = useState([])
  const [matchSearching, setMatchSearching] = useState(false)
  const [matchSearchAttempted, setMatchSearchAttempted] = useState(false)
  const [saving, setSaving] = useState(false)

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
  const autoSearchTimer = useRef(null)

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
    setStoneMatrix(null)
    setPhotoPhase('capture')
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

      // Build initial stone matrix from Gemini output
      const people = (extracted.people || []).map((p, index) => {
        const fullName = [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' ')
        return {
          index,
          geminiData: p,
          correctedName: fullName,
          role: 'occupant', // default — volunteer can change
          relationships: parseKinshipHints(p.kinship_hints || []),
          confirmedRelationships: [],
          matchedRecord: null,
          matchStatus: 'pending'
        }
      })

      setStoneMatrix({
        stone_condition: extracted.stone_condition || 'fair',
        stone_notes: extracted.stone_notes || '',
        people
      })
      setPhotoPhase('matrix')
    } catch (err) {
      console.error(err)
      alert('Error analyzing photo: ' + err.message)
    }
    setLoading(false)
  }

  // ── MATRIX PHASE — build relationship matrix ─────────────
  const updatePersonRole = (index, role) => {
    setStoneMatrix(prev => ({
      ...prev,
      people: prev.people.map((p, i) => i === index ? { ...p, role } : p)
    }))
  }

  const updateCorrectedName = (index, name) => {
    setStoneMatrix(prev => ({
      ...prev,
      people: prev.people.map((p, i) => i === index ? { ...p, correctedName: name } : p)
    }))
    if (autoSearchTimer.current) clearTimeout(autoSearchTimer.current)
    autoSearchTimer.current = setTimeout(() => {
      preSearchPerson(index, name)
    }, 800)
  }

  const preSearchPerson = async (index, name) => {
    if (!name.trim() || name.trim().length < 3) return
    const terms = name.trim().split(/[\s,]+/).filter(Boolean)
    let dbQuery = supabase.from('v_deceased_search').select('*')
    if (terms.length === 1) {
      dbQuery = dbQuery.or('first_name.ilike.*' + terms[0] + '*,last_name.ilike.*' + terms[0] + '*,maiden_name.ilike.*' + terms[0] + '*')
    } else {
      const lastName = terms[terms.length - 1]
      const firstTerms = terms.slice(0, -1)
      dbQuery = dbQuery.ilike('last_name', '%' + lastName + '%')
      firstTerms.forEach(term => {
        dbQuery = dbQuery.or('first_name.ilike.%' + term + '%,middle_name.ilike.%' + term + '%')
      })
    }
    const person = stoneMatrix?.people?.[index]
    const deathYearMatch = (person?.geminiData?.date_of_death_verbatim || '').match(/\d{4}/)
    if (deathYearMatch) {
      const year = parseInt(deathYearMatch[0])
      if (year >= 1700 && year <= 2030) {
        dbQuery = dbQuery
          .gte('date_of_death', (year - 15) + '-01-01')
          .lte('date_of_death', (year + 15) + '-12-31')
      }
    }
    const { data } = await dbQuery.order('last_name').order('first_name').limit(20)
    if (data && data.length > 0) {
      setStoneMatrix(prev => ({
        ...prev,
        people: prev.people.map((p, i) => i === index ? { ...p, preSearchResults: data } : p)
      }))
    }
  }

  const confirmRelationship = (personIndex, rel, objectIndex) => {
    // objectIndex is the index of the other person in stoneMatrix.people
    setStoneMatrix(prev => {
      const people = [...prev.people]
      const person = { ...people[personIndex] }
      const confirmed = {
        type: rel.type,
        hint: rel.hint,
        objectIndex,
        objectName: people[objectIndex]?.correctedName || rel.rawNames[0] || 'Unknown'
      }
      person.confirmedRelationships = [...person.confirmedRelationships, confirmed]
      people[personIndex] = person
      return { ...prev, people }
    })
  }

  const skipRelationship = (personIndex, relIndex) => {
    setStoneMatrix(prev => {
      const people = [...prev.people]
      const person = { ...people[personIndex] }
      const rels = [...person.relationships]
      rels.splice(relIndex, 1)
      person.relationships = rels
      people[personIndex] = person
      return { ...prev, people }
    })
  }

 const proceedToMatch = () => {
  if (stoneMatrix?.people?.length > 0) {
    const firstPerson = stoneMatrix.people[0]
    setMatchSearchQuery(firstPerson.correctedName)
    setMatchSearchResults(firstPerson.preSearchResults || [])
    setMatchSearchAttempted(firstPerson.preSearchResults ? true : false)
  }
  setMatchingIndex(0)
  setPhotoPhase('match')
}
  // ── MATCH PHASE ──────────────────────────────────────────
  const handleMatchSearch = async (query) => {
    if (!query.trim()) return
    setMatchSearching(true)
    setMatchSearchResults([])
    setMatchSearchAttempted(true)
    const terms = query.trim().split(/[\s,]+/).filter(Boolean)
    let dbQuery = supabase.from('v_deceased_search').select('*')
    if (terms.length === 1) {
      dbQuery = dbQuery.or('first_name.ilike.*' + terms[0] + '*,last_name.ilike.*' + terms[0] + '*,maiden_name.ilike.*' + terms[0] + '*')
    } else {
      const lastName = terms[terms.length - 1]
      const firstTerms = terms.slice(0, -1)
      dbQuery = dbQuery.ilike('last_name', '%' + lastName + '%')
      firstTerms.forEach(term => {
        dbQuery = dbQuery.or('first_name.ilike.%' + term + '%,middle_name.ilike.%' + term + '%')
      })
    }
    // Apply year window if we have a death year
   const person = stoneMatrix?.people?.[matchingIndex]
    const deathYearMatch = (person?.geminiData?.date_of_death_verbatim || '').match(/\d{4}/)
    if (deathYearMatch) {
      const year = parseInt(deathYearMatch[0])
      if (year >= 1700 && year <= 2030) {
        dbQuery = dbQuery.gte('date_of_death', (year - 15) + '-01-01').lte('date_of_death', (year + 15) + '-12-31')
      }
    }
    const { data, error } = await dbQuery.order('last_name').order('first_name').limit(20)
    if (!error) setMatchSearchResults(data || [])
    setMatchSearching(false)
  }

  const selectMatch = (record) => {
    setStoneMatrix(prev => ({
      ...prev,
      people: prev.people.map((p, i) =>
        i === matchingIndex ? { ...p, matchedRecord: record, matchStatus: 'matched' } : p
      )
    }))
  }

  const skipMatch = () => {
    setStoneMatrix(prev => ({
      ...prev,
      people: prev.people.map((p, i) =>
        i === matchingIndex ? { ...p, matchStatus: 'skipped' } : p
      )
    }))
  }

  const nextPerson = () => {
    const nextIndex = matchingIndex + 1
    if (nextIndex < stoneMatrix.people.length) {
      setMatchingIndex(nextIndex)
      const next = stoneMatrix.people[nextIndex]
      setMatchSearchQuery(next.correctedName)
      setMatchSearchResults(next.preSearchResults || [])
      setMatchSearchAttempted(next.preSearchResults ? true : false)
    } else {
      // All people processed — save everything
      saveStone()
    }
  }

  // ── GPS ──────────────────────────────────────────────────
  const getAccuratePosition = () => new Promise((resolve, reject) => {
    let bestPosition = null
    setGpsStatus('Acquiring GPS...')
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        bestPosition = pos
        const acc = Math.round(pos.coords.accuracy)
        setGpsStatus('GPS: ' + acc + 'm accuracy' + (acc <= 10 ? ' ✓' : ' (waiting...)'))
        if (pos.coords.accuracy <= 10) {
          navigator.geolocation.clearWatch(watchId)
          setGpsStatus(null)
          resolve(pos)
        }
      },
      (err) => { if (bestPosition) { setGpsStatus(null); resolve(bestPosition) } else { reject(err) } },
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 }
    )
    setTimeout(() => {
      navigator.geolocation.clearWatch(watchId)
      setGpsStatus(null)
      if (bestPosition) {
        if (Math.round(bestPosition.coords.accuracy) > 10) {
          alert('Poor GPS fix (' + Math.round(bestPosition.coords.accuracy) + 'm). Location saved but may be imprecise.')
        }
        resolve(bestPosition)
      } else { reject(new Error('Could not get GPS position')) }
    }, 20000)
  })

  // ── SAVE EVERYTHING ──────────────────────────────────────
  const saveStone = async () => {
    setSaving(true)
    try {
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
      const occupants = stoneMatrix.people.filter(p => p.role === 'occupant')
      const inscriptionText = stoneMatrix.people.map(p =>
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
        gps_accuracy_m: accuracy
      }).select().single()
      if (stoneError) throw stoneError

      currentStoneRef.current = { stoneData, lat, lng, accuracy }

      // 3. Save photo
      await supabase.from('stone_photos').insert({
        stone_id: stoneData.stone_id, photo_url: publicUrl,
        side: 'front', taken_by: session.user.id, is_primary: true
      })

      // 4. Link matched people to stone
      for (const person of stoneMatrix.people) {
        if (person.matchedRecord) {
          await supabase.from('stone_deceased').insert({
            stone_id: stoneData.stone_id,
            deceased_id: person.matchedRecord.deceased_id,
            confirmed_by: session.user.id,
            confirmed_at: new Date().toISOString(),
            match_method: 'volunteer_confirmed',
            role: person.role
          })

          // Update maiden name if Gemini found one
          if (person.geminiData.maiden_name && !person.matchedRecord.maiden_name) {
            await supabase.from('deceased').update({ maiden_name: person.geminiData.maiden_name })
              .eq('deceased_id', person.matchedRecord.deceased_id)
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
      for (const person of stoneMatrix.people) {
        if (!person.matchedRecord) continue
        for (const rel of person.confirmedRelationships) {
          const objectPerson = stoneMatrix.people[rel.objectIndex]
          if (!objectPerson?.matchedRecord) continue
          const inverseType = INVERSE_REL[rel.type] || 'unknown'
          await Promise.all([
            supabase.from('kinship').insert({
              primary_deceased_id: person.matchedRecord.deceased_id,
              relative_deceased_id: objectPerson.matchedRecord.deceased_id,
              relationship_type: rel.type, source: 'stone_inscription',
              confidence: 'probable', notes: rel.hint
            }),
            supabase.from('kinship').insert({
              primary_deceased_id: objectPerson.matchedRecord.deceased_id,
              relative_deceased_id: person.matchedRecord.deceased_id,
              relationship_type: inverseType, source: 'stone_inscription',
              confidence: 'probable', notes: rel.hint
            })
          ])
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
      firstTerms.forEach(term => { dbQuery = dbQuery.or('first_name.ilike.%' + term + '%,middle_name.ilike.%' + term + '%') })
    }
    const { data, error } = await dbQuery.order('last_name').order('first_name').limit(50)
    if (error) { alert('Search error: ' + error.message) } else { setSearchResults(data || []) }
    setSearching(false)
  }

  const selectSearchRecord = async (record) => {
    setSearchSelected(record); setSearchStoneData(null)
    if (record.is_photographed) {
      const { data, error } = await supabase.from('stone_deceased')
        .select('stones ( stone_id, gps_accuracy_m, condition_notes, inscription_text, stone_photos ( photo_url, is_primary ) )')
        .eq('deceased_id', record.deceased_id).limit(1).single()
      if (!error && data?.stones) {
        const { data: coords } = await supabase.rpc('get_stones_with_coordinates')
        const stoneCoord = coords?.find(c => c.stone_id === data.stones.stone_id)
        setSearchStoneData({ ...data.stones, lat: stoneCoord?.lat, lng: stoneCoord?.lng })
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

  // ── HEADER ───────────────────────────────────────────────
  const Header = () => (
    <div className="bg-gray-800 p-4 flex items-center justify-between">
      <h1 className="text-xl font-bold text-green-400 cursor-pointer" onClick={() => { clearAndReset(); setMode('landing') }}>
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

  // ── LANDING ──────────────────────────────────────────────
  if (mode === 'landing') {
    return (
      <div className="min-h-screen bg-gray-900 text-white">
        <Header />
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
        <Header />
        <div className="p-4 max-w-lg mx-auto">
          <button onClick={() => { setMode('landing'); setSearchResults(null); setSearchSelected(null); setSearchQuery('') }}
            className="text-gray-300 text-sm hover:text-white mb-4">← Back</button>

          {!searchSelected && (
            <>
              <div className="flex gap-2 mb-4">
                <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleVolunteerSearch()}
                  placeholder="Last name, First name, or First Last"
                  className="flex-1 bg-gray-800 border border-gray-600 rounded-lg p-3 text-white placeholder-gray-400 outline-none focus:ring-2 focus:ring-green-500"
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
              {!searchSelected.is_photographed && (
                <div className="bg-gray-800 border border-gray-600 rounded-lg p-4">
                  <p className="text-gray-300 text-sm mb-3">This stone has not been photographed yet.</p>
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

                {/* Corrected name */}
                <input
                  type="text"
                  value={person.correctedName}
                  onChange={e => updateCorrectedName(pIndex, e.target.value)}
                  className="w-full bg-gray-700 border border-gray-600 rounded p-2 text-white text-sm mb-2 outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="Full name"
                />

                {/* Pre-search indicator */}
                {person.preSearchResults && (
                  <p className="text-green-400 text-xs mb-2">
                    ✓ {person.preSearchResults.length} database match{person.preSearchResults.length !== 1 ? 'es' : ''} found
                  </p>
                )}

                {/* Dates */}
                <div className="flex gap-3 mb-2">
                  {person.geminiData.date_of_birth_verbatim && (
                    <p className="text-gray-300 text-xs">b. {person.geminiData.date_of_birth_verbatim}</p>
                  )}
                  {person.geminiData.date_of_death_verbatim && (
                    <p className="text-gray-300 text-xs">d. {person.geminiData.date_of_death_verbatim}</p>
                  )}
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
                    <p className="text-yellow-400 text-xs font-bold mb-1">
                      {REL_LABEL[rel.type] || rel.type}: {rel.rawNames.length > 0 ? rel.rawNames.join(' & ') : 'person on same stone'}
                    </p>
                    <p className="text-gray-400 text-xs mb-2">"{rel.hint}"</p>

                    {/* Match relationship to another person on stone */}
                    <p className="text-gray-300 text-xs mb-1">Link to:</p>
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
                    <button onClick={() => skipRelationship(pIndex, rIndex)}
                      className="text-gray-400 text-xs hover:text-gray-200">
                      Skip this relationship
                    </button>
                  </div>
                ))}

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
                  {person.geminiData.date_of_birth_verbatim && <p className="text-gray-300 text-sm">b. {person.geminiData.date_of_birth_verbatim}</p>}
                  {person.geminiData.date_of_death_verbatim && <p className="text-gray-300 text-sm">d. {person.geminiData.date_of_death_verbatim}</p>}

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
                          className="flex-1 bg-gray-700 border border-gray-600 rounded p-2 text-white text-sm outline-none focus:ring-2 focus:ring-green-500"
                        />
                        <button onClick={() => handleMatchSearch(matchSearchQuery)} disabled={matchSearching}
                          className="bg-green-700 hover:bg-green-600 text-white font-bold px-3 rounded text-sm">
                          {matchSearching ? '...' : 'Search'}
                        </button>
                      </div>

                      {matchSearchResults.map(record => (
                        <div key={record.deceased_id}
                          className={'p-3 rounded-lg mb-2 cursor-pointer ' + (record.is_photographed ? 'bg-gray-700 border border-yellow-600' : 'bg-gray-700')}
                          onClick={() => selectMatch(record)}>
                          <p className={'font-bold text-sm ' + (record.is_photographed ? 'text-yellow-400' : 'text-white')}>
                            {record.full_name}{record.is_photographed ? ' (already cataloged)' : ''}
                          </p>
                          <p className="text-gray-300 text-xs">
                            {record.date_of_death_verbatim && 'd. ' + record.date_of_death_verbatim}
                            {record.maiden_name && ' | nee ' + record.maiden_name}
                          </p>
                        </div>
                      ))}
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
  ) : matchSearchAttempted ? (
    <>
      <button onClick={() => { skipMatch(); nextPerson() }} disabled={saving}
        className="flex-1 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 text-white py-3 rounded-lg text-sm">
        {saving ? '⏳ Saving...' : 'Skip — no match'}
      </button>
      {matchingIndex + 1 >= stoneMatrix.people.length && (
        <button onClick={saveStone} disabled={saving}
          className="flex-1 bg-yellow-700 hover:bg-yellow-600 disabled:bg-gray-600 text-white font-bold py-3 rounded-lg text-sm">
          {saving ? '⏳ Saving...' : '💾 Save Anyway'}
        </button>
      )}
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
