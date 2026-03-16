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

const parseKinshipHints = (hints) => {
  if (!hints || hints.length === 0) return []
  const relationships = []
  const patterns = [
    { regex: /(?:wife|spouse|consort)\s+of\s+([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?(?:[A-Z][a-z]+))/i, type: 'spouse' },
    { regex: /(?:husband)\s+of\s+([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?(?:[A-Z][a-z]+))/i, type: 'spouse' },
    { regex: /(?:his|her)\s+wife/i, type: 'spouse_implicit' },
    { regex: /(?:son|daughter|child)\s+of\s+(.+)/i, type: 'child' },
    { regex: /(?:father|mother|parent)\s+of\s+(.+)/i, type: 'parent' },
    { regex: /(?:brother|sister|sibling)\s+of\s+(.+)/i, type: 'sibling' },
  ]
  hints.forEach(hint => {
    patterns.forEach(({ regex, type }) => {
      const match = hint.match(regex)
      if (match) {
        if (type === 'spouse_implicit') {
          relationships.push({ type: 'spouse', rawName: null, hint, implicit: true })
        } else if (match[1]) {
          match[1].split(/\s*[&,]\s*/).forEach(rawName => {
            const cleaned = rawName.trim().replace(/\.$/, '')
            if (cleaned.length > 2) relationships.push({ type, rawName: cleaned, hint })
          })
        }
      }
    })
  })
  return relationships
}

const extractLastName = (rawName) => { const w = rawName.trim().split(/\s+/); return w[w.length - 1] }
const extractFirstName = (rawName) => rawName.trim().split(/\s+/)[0]

export default function Home({ session, onMap, onRecent }) {
  const [mode, setMode] = useState('landing')
  const [image, setImage] = useState(null)
  const [imageBase64, setImageBase64] = useState(null)
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState(null)
  const [kinshipSuggestions, setKinshipSuggestions] = useState(null)
  const [confirming, setConfirming] = useState(null)
  const [confirmedPeople, setConfirmedPeople] = useState([])
  // Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const [searchSelected, setSearchSelected] = useState(null)
  const [searchStoneData, setSearchStoneData] = useState(null)
  const [searching, setSearching] = useState(false)
  const [visitorLocation, setVisitorLocation] = useState(null)
  const [locating, setLocating] = useState(false)
  const [pendingPhotoFor, setPendingPhotoFor] = useState(null)
  const fileInput = useRef(null)
  // Stone sharing: track the stone created for this photo session
  const currentStoneRef = useRef(null)

  const handlePhoto = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onloadend = () => { setImageBase64(reader.result.split(',')[1]); setImage(reader.result) }
    reader.readAsDataURL(file)
    // Reset stone ref for new photo session
    currentStoneRef.current = null
    setConfirmedPeople([])
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

  const searchForPerson = async (person) => {
  let searchTerm = person.last_name || ''
  if (!searchTerm && person.kinship_hints && person.kinship_hints.length > 0) {
    const words = person.kinship_hints.join(' ').split(' ')
    searchTerm = words[words.length - 1]
  }
  if (!searchTerm) return []

  const deathYearMatch = (person.date_of_death_verbatim || '').match(/\d{4}/)
  const extractedYear = deathYearMatch ? parseInt(deathYearMatch[0]) : null

  // Search by last name only first, then filter by first name loosely
  let query = supabase.from('v_deceased_search').select('*')
    .ilike('last_name', '%' + searchTerm + '%')

  // Only add first name filter if we have it AND no middle name confusion
  if (person.first_name && !person.middle_name) {
    query = query.ilike('first_name', '%' + person.first_name + '%')
  }

  const { data: rawMatches, error } = await query.limit(30)
  if (error) { console.error(error); return [] }

  let matches = rawMatches || []

  // Score by full name similarity and year proximity
  matches = matches.map(m => {
    const yearDiff = (extractedYear && m.date_of_death)
      ? Math.abs(new Date(m.date_of_death).getFullYear() - extractedYear) : 999
    // Check if first name matches at all
    const firstNameMatch = person.first_name
      ? m.first_name.toLowerCase().includes(person.first_name.toLowerCase().substring(0, 3))
      : true
    return { ...m, yearDiff, firstNameMatch }
  })
  .sort((a, b) => {
    // Prioritize year match, then first name match
    if (a.yearDiff !== b.yearDiff) return a.yearDiff - b.yearDiff
    if (a.firstNameMatch !== b.firstNameMatch) return b.firstNameMatch - a.firstNameMatch
    return 0
  })
  .slice(0, 10)

  return matches
}

  const searchForRelative = async (rawName) => {
    if (!rawName) return []
    const { data, error } = await supabase.from('v_deceased_search').select('*')
      .ilike('last_name', '%' + extractLastName(rawName) + '%')
      .ilike('first_name', '%' + extractFirstName(rawName) + '%')
      .limit(5)
    if (error) return []
    return data || []
  }

  const handleVolunteerSearch = async (overrideQuery) => {
    const q = overrideQuery || searchQuery
    if (!q.trim()) return
    setSearching(true)
    setSearchResults(null)
    setSearchSelected(null)
    setSearchStoneData(null)
    const terms = q.trim().split(/[\s,]+/).filter(Boolean)
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
    const { data, error } = await dbQuery.order('last_name').order('first_name').limit(50)
    if (error) { alert('Search error: ' + error.message) }
    else { setSearchResults(data || []) }
    setSearching(false)
  }

  const selectSearchRecord = async (record) => {
    setSearchSelected(record)
    setSearchStoneData(null)
    if (record.is_photographed) {
      const { data, error } = await supabase
        .from('stone_deceased')
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

  const analyzePhoto = async () => {
    if (!imageBase64) return
    setLoading(true)
    setResults(null)
    setKinshipSuggestions(null)
    currentStoneRef.current = null
    setConfirmedPeople([])
    try {
      const resizedBase64 = await resizeImage(imageBase64)
      const geminiResponse = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + process.env.REACT_APP_GEMINI_KEY,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [
              { text: 'You are transcribing text from a historic cemetery gravestone photograph. The stone may be weathered, poorly lit, or use 18th/19th century typography. There may be ONE or MULTIPLE people on the same stone.\n\nExtract ALL people mentioned on the stone. For each person extract:\n- First name, middle name, last name\n- Maiden name (often shown as nee or born)\n- Birth date exactly as inscribed\n- Death date exactly as inscribed\n- Any kinship text EXACTLY as written (e.g. "His Wife", "Son of John & Mary Hopkins", "Daughter of")\n- Any titles (Rev, Dr, Pvt, Capt etc.)\n\nRules:\n- Transcribe exactly what you see, do not guess or infer\n- For uncertain characters use ? (e.g. 18?4)\n- For unreadable sections use [unreadable]\n- The long S character should be transcribed as regular s\n- If a last name is not shown, infer it from context (e.g. family stone header)\n- For stone_condition use only: excellent, good, fair, poor, illegible, or missing\n- kinship_hints must contain the EXACT text from the stone, not paraphrased\n- Return ONLY a JSON object, no other text\n\nReturn this exact JSON structure:\n{\n  "people": [\n    {\n      "first_name": "",\n      "middle_name": "",\n      "last_name": "",\n      "maiden_name": "",\n      "date_of_birth_verbatim": "",\n      "date_of_death_verbatim": "",\n      "kinship_hints": [],\n      "titles": "",\n      "confidence": "high|medium|low",\n      "notes": ""\n    }\n  ],\n  "stone_condition": "good",\n  "stone_notes": ""\n}' },
              { inline_data: { mime_type: 'image/jpeg', data: resizedBase64 } }
            ]}],
            generationConfig: { temperature: 0.1, maxOutputTokens: 4096, thinkingConfig: { thinkingBudget: 0 } }
          })
        }
      )
      const geminiData = await geminiResponse.json()
      if (!geminiData.candidates || geminiData.candidates.length === 0) {
        throw new Error('Gemini error: ' + (geminiData.error?.message || JSON.stringify(geminiData)))
      }
  const extracted = JSON.parse(geminiData.candidates[0].content.parts[0].text.replace(/```json|```/g, '').trim())
console.log('Gemini people:', JSON.stringify(extracted.people))
const peopleWithMatches = await Promise.all(
  (extracted.people || []).map(async (person) => ({ person, matches: await searchForPerson(person) }))
)
setResults({ peopleWithMatches, stone_notes: extracted.stone_notes, stone_condition: extracted.stone_condition || 'fair' })

      // Auto-launch search if first person has 0 matches
      const firstNoMatch = peopleWithMatches.find(p => p.matches.length === 0)
      if (firstNoMatch) {
        const p = firstNoMatch.person
        const autoQuery = [p.first_name, p.last_name].filter(Boolean).join(' ')
        if (autoQuery) {
          setSearchQuery(autoQuery)
          setMode('search')
          handleVolunteerSearch(autoQuery)
        }
      }
    } catch (err) {
      console.error('Full error:', err)
      alert('Error: ' + err.message)
    }
    setLoading(false)
  }

  const confirmMatch = async (person, matchedRecord) => {
    setConfirming(matchedRecord.deceased_id)
    try {
      // If this is the first confirmation for this photo session, create the stone
      if (!currentStoneRef.current) {
        const byteString = atob(imageBase64)
        const byteArray = new Uint8Array(byteString.length)
        for (let i = 0; i < byteString.length; i++) byteArray[i] = byteString.charCodeAt(i)
        const blob = new Blob([byteArray], { type: 'image/jpeg' })
        const fileName = Date.now() + '_' + session.user.id + '.jpg'

        const [position, uploadResult] = await Promise.all([
          new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true, timeout: 5000, maximumAge: 30000
          })),
          supabase.storage.from('Stone_Images').upload(fileName, blob, { contentType: 'image/jpeg' })
        ])
        if (uploadResult.error) throw uploadResult.error

        const lat = position.coords.latitude
        const lng = position.coords.longitude
        const accuracy = position.coords.accuracy
        const { data: { publicUrl } } = supabase.storage.from('Stone_Images').getPublicUrl(fileName)

        const { data: stoneData, error: stoneError } = await supabase.from('stones').insert({
          cemetery_id: 'd8bd1f88-cdde-4ef2-a448-5ab04d2d8107',
          volunteer_notes: '',
          stone_condition: results.stone_condition || 'fair',
          condition_notes: results.stone_notes || '',
          inscription_text: results.peopleWithMatches
            .map(p => [p.person.first_name, p.person.middle_name, p.person.last_name,
              p.person.date_of_birth_verbatim, p.person.date_of_death_verbatim,
              ...(p.person.kinship_hints || [])].filter(Boolean).join(' ')).join(' | '),
          field_status: 'complete',
          location: 'SRID=4326;POINT(' + lng + ' ' + lat + ')',
          gps_accuracy_m: accuracy
        }).select().single()
        if (stoneError) throw stoneError

        await supabase.from('stone_photos').insert({
          stone_id: stoneData.stone_id, photo_url: publicUrl,
          side: 'front', taken_by: session.user.id, is_primary: true
        })

        // Store for reuse by subsequent confirmations
        currentStoneRef.current = { stoneData, lat, lng, accuracy }
      }

      const { stoneData, lat, lng, accuracy } = currentStoneRef.current

      // Link this person to the shared stone
      await Promise.all([
        supabase.from('stone_deceased').insert({
          stone_id: stoneData.stone_id, deceased_id: matchedRecord.deceased_id,
          confirmed_by: session.user.id, confirmed_at: new Date().toISOString(),
          match_method: 'volunteer_confirmed'
        }),
        supabase.from('activity_log').insert({
          user_id: session.user.id, action: 'match_confirmed', entity_type: 'stone_deceased',
          entity_id: stoneData.stone_id, cemetery_id: 'd8bd1f88-cdde-4ef2-a448-5ab04d2d8107',
          metadata: { deceased_name: matchedRecord.full_name, gemini_confidence: person.confidence,
            kinship_hints: person.kinship_hints, gps: { lat, lng, accuracy } }
        }),
        person.maiden_name && !matchedRecord.maiden_name
          ? supabase.from('deceased').update({ maiden_name: person.maiden_name }).eq('deceased_id', matchedRecord.deceased_id)
          : Promise.resolve()
      ])

      // Track confirmed people for kinship suggestions between co-occupants
      const newConfirmedPeople = [...confirmedPeople, { ...matchedRecord, person }]
      setConfirmedPeople(newConfirmedPeople)

      // Build kinship suggestions from stone inscription
      const relationships = parseKinshipHints(person.kinship_hints)
      const allSuggestions = []

      // From explicit kinship hints
      for (const rel of relationships) {
        if (rel.implicit && newConfirmedPeople.length > 1) {
  // Find the other confirmed people on this stone (not the current person)
  const otherPeople = newConfirmedPeople.filter(p => p.deceased_id !== matchedRecord.deceased_id)
  if (otherPeople.length > 0) {
    const previousPerson = otherPeople[otherPeople.length - 1]
    allSuggestions.push({
      type: 'spouse',
      rawName: previousPerson.full_name,
      hint: rel.hint,
      implicit: true,
      candidates: [previousPerson],
      subjectId: matchedRecord.deceased_id,
      subjectName: matchedRecord.full_name
    })
  }
} else if (rel.rawName) {
          const candidates = await searchForRelative(rel.rawName)
          if (candidates.length > 0) {
            allSuggestions.push({ ...rel, candidates, subjectId: matchedRecord.deceased_id, subjectName: matchedRecord.full_name })
          }
        }
      }

      // If multiple people on stone and no explicit kinship — suggest spouse
      if (allSuggestions.length === 0 && newConfirmedPeople.length > 1) {
        const previousPerson = newConfirmedPeople[newConfirmedPeople.length - 2]
        allSuggestions.push({
          type: 'spouse',
          rawName: previousPerson.full_name,
          hint: 'Same stone',
          implicit: true,
          candidates: [previousPerson],
          subjectId: matchedRecord.deceased_id,
          subjectName: matchedRecord.full_name
        })
      }

      if (allSuggestions.length > 0) {
        setKinshipSuggestions(allSuggestions)
      } else {
        alert('Match confirmed! ' + matchedRecord.full_name + '\nGPS: ' + lat.toFixed(6) + ', ' + lng.toFixed(6))
      }
      setConfirming(null)
    } catch (err) {
      setConfirming(null)
      console.error(err)
      alert('Error saving match: ' + err.message)
    }
  }

  const confirmKinship = async (suggestion, candidate) => {
    const inverseType = { spouse: 'spouse', child: 'parent', parent: 'child', sibling: 'sibling' }[suggestion.type] || 'unknown'
    try {
      await Promise.all([
        supabase.from('kinship').insert({
          primary_deceased_id: suggestion.subjectId, relative_deceased_id: candidate.deceased_id,
          relationship_type: suggestion.type, source: 'stone_inscription', confidence: 0.9, notes: suggestion.hint
        }),
        supabase.from('kinship').insert({
          primary_deceased_id: candidate.deceased_id, relative_deceased_id: suggestion.subjectId,
          relationship_type: inverseType, source: 'stone_inscription', confidence: 0.9, notes: suggestion.hint
        }),
        supabase.from('activity_log').insert({
          user_id: session.user.id, action: 'kinship_confirmed', entity_type: 'kinship',
          entity_id: suggestion.subjectId, cemetery_id: 'd8bd1f88-cdde-4ef2-a448-5ab04d2d8107',
          metadata: { subject: suggestion.subjectName, relative: candidate.full_name, relationship: suggestion.type }
        })
      ])
      alert('Kinship saved: ' + suggestion.subjectName + ' is ' + suggestion.type + ' of ' + candidate.full_name)
      setKinshipSuggestions(prev => prev.filter(s => s !== suggestion))
    } catch (err) {
      console.error(err); alert('Error saving kinship: ' + err.message)
    }
  }

  const clearPhotoResults = () => {
    setResults(null); setImage(null); setImageBase64(null)
    setKinshipSuggestions(null); setConfirming(null)
    setConfirmedPeople([]); currentStoneRef.current = null
    setMode('landing')
  }

  const Header = () => (
    <div className="bg-gray-800 p-4 flex items-center justify-between">
      <h1 className="text-xl font-bold text-green-400 cursor-pointer" onClick={() => setMode('landing')}>
        Granite Graph
      </h1>
      <div className="flex gap-3">
        <button onClick={onMap} className="text-gray-300 text-sm hover:text-white">Map</button>
        <button onClick={onRecent} className="text-gray-300 text-sm hover:text-white">Recent</button>
        <button onClick={() => supabase.auth.signOut()} className="text-gray-300 text-sm hover:text-white">Sign Out</button>
      </div>
    </div>
  )

  // ── LANDING ──────────────────────────────────────────────────
  if (mode === 'landing') {
    return (
      <div className="min-h-screen bg-gray-900 text-white">
        <Header />
        <div className="p-6 max-w-lg mx-auto">
          <p className="text-gray-300 text-center mb-8 mt-4">What would you like to do?</p>
          <input type="file" accept="image/*" capture="environment" ref={fileInput} onChange={(e) => { handlePhoto(e); setMode('photograph') }} className="hidden" />
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

  // ── SEARCH ───────────────────────────────────────────────────
  if (mode === 'search') {
    return (
      <div className="min-h-screen bg-gray-900 text-white">
        <Header />
        <div className="p-4 max-w-lg mx-auto">
          <button onClick={() => { setMode('landing'); setSearchResults(null); setSearchSelected(null) }}
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
                  {searchResults.length === 0 && <div className="bg-gray-800 rounded-lg p-4"><p className="text-gray-300">No records found.</p></div>}
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
                  <button onClick={() => { setPendingPhotoFor(searchSelected); setMode('photograph') }}
                    className="w-full bg-green-700 hover:bg-green-600 text-white font-bold py-3 rounded-lg">
                    📷 Photograph this stone now
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── PHOTOGRAPH ───────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <Header />
      <div className="p-4 max-w-lg mx-auto">
        {!results && !kinshipSuggestions && (
          <button onClick={() => setMode('landing')} className="text-gray-300 text-sm hover:text-white mb-4">← Back</button>
        )}

        {pendingPhotoFor && !results && (
          <div className="bg-gray-700 rounded-lg p-3 mb-4">
            <p className="text-green-400 text-sm font-bold">Photographing for: {pendingPhotoFor.full_name}</p>
            {pendingPhotoFor.date_of_death_verbatim && <p className="text-gray-300 text-xs">d. {pendingPhotoFor.date_of_death_verbatim}</p>}
          </div>
        )}

        {confirmedPeople.length > 0 && (
          <div className="bg-gray-800 rounded-lg p-3 mb-4 border border-green-700">
            <p className="text-green-400 text-xs font-bold mb-1">Confirmed on this stone:</p>
            {confirmedPeople.map((p, i) => (
              <p key={i} className="text-white text-sm">✓ {p.full_name}</p>
            ))}
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

        {kinshipSuggestions && kinshipSuggestions.length > 0 && (
          <div className="mt-4">
            <div className="bg-yellow-900 border border-yellow-600 rounded-lg p-4 mb-4">
              <h2 className="text-yellow-400 font-bold mb-1">Suggested Kinship Links</h2>
              <p className="text-yellow-200 text-sm">Confirm or skip each suggested relationship.</p>
            </div>
            {kinshipSuggestions.map((suggestion, sIndex) => (
              <div key={sIndex} className="bg-gray-800 rounded-lg p-4 mb-4 border border-gray-600">
                <p className="text-white font-bold">{suggestion.subjectName}</p>
                <p className="text-yellow-400 text-sm mb-1">
                  is {suggestion.type} of {suggestion.rawName ? '"' + suggestion.rawName + '"' : 'person on same stone'}
                </p>
                <p className="text-gray-400 text-xs mb-3">from: "{suggestion.hint}"</p>
                <p className="text-gray-300 text-sm mb-2">Confirm relationship with:</p>
                {suggestion.candidates.map(candidate => (
                  <div key={candidate.deceased_id} className="bg-gray-700 rounded p-3 mb-2">
                    <p className="text-white font-bold">{candidate.full_name}</p>
                    {candidate.date_of_death_verbatim && <p className="text-gray-300 text-sm">d. {candidate.date_of_death_verbatim}</p>}
                    <button onClick={() => confirmKinship(suggestion, candidate)}
                      className="mt-2 w-full bg-green-700 hover:bg-green-600 text-white py-2 rounded text-sm font-bold">
                      Confirm
                    </button>
                  </div>
                ))}
                <button onClick={() => setKinshipSuggestions(prev => prev.filter((_, i) => i !== sIndex))}
                  className="w-full bg-gray-700 hover:bg-gray-600 text-gray-300 py-2 rounded text-sm mt-1">
                  Skip this relationship
                </button>
              </div>
            ))}
            <button onClick={() => setKinshipSuggestions(null)}
              className="w-full bg-gray-700 hover:bg-gray-600 text-white py-3 rounded-lg mt-2">
              Done with kinship
            </button>
          </div>
        )}

        {results && (
          <div className="mt-4">
            {results.stone_notes && (
              <div className="bg-gray-700 rounded-lg p-3 mb-4">
                <p className="text-gray-300 text-sm">{results.stone_notes}</p>
              </div>
            )}
            <p className="text-green-400 font-bold mb-3">
              {results.peopleWithMatches.length} person{results.peopleWithMatches.length !== 1 ? 's' : ''} found on stone:
            </p>
            {results.peopleWithMatches.map((item, index) => (
              <div key={index} className="mb-6 border border-gray-700 rounded-lg p-4">
                <div className="bg-gray-800 rounded-lg p-3 mb-3">
                  <p className="text-green-400 font-bold text-sm mb-1">Person {index + 1}</p>
                  <p className="font-bold text-white">
                    {item.person.first_name} {item.person.middle_name} {item.person.last_name}
                    {item.person.maiden_name ? ' (nee ' + item.person.maiden_name + ')' : ''}
                  </p>
                  {item.person.date_of_birth_verbatim && <p className="text-gray-300 text-sm">b. {item.person.date_of_birth_verbatim}</p>}
                  {item.person.date_of_death_verbatim && <p className="text-gray-300 text-sm">d. {item.person.date_of_death_verbatim}</p>}
                  {item.person.kinship_hints?.length > 0 && <p className="text-yellow-400 text-sm">{item.person.kinship_hints.join(', ')}</p>}
                  <p className={item.person.confidence === 'high' ? 'text-green-400 text-xs mt-1' : item.person.confidence === 'medium' ? 'text-yellow-400 text-xs mt-1' : 'text-red-400 text-xs mt-1'}>
                    Confidence: {item.person.confidence}
                  </p>
                </div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-gray-300 text-sm">Database matches ({item.matches.length}):</p>
                  {item.matches.length === 0 && (
                    <button
                      onClick={() => { setSearchQuery([item.person.first_name, item.person.last_name].filter(Boolean).join(' ')); setMode('search'); handleVolunteerSearch([item.person.first_name, item.person.last_name].filter(Boolean).join(' ')) }}
                      className="text-green-400 text-xs hover:text-green-300 underline">
                      Search manually →
                    </button>
                  )}
                </div>
                {item.matches.length === 0 && (
                  <div className="bg-gray-800 rounded p-3">
                    <p className="text-gray-400 text-sm">No matches found. Use Search to find this person.</p>
                  </div>
                )}
                {item.matches.map(match => (
                  <div key={match.deceased_id} className={'p-3 rounded-lg mb-2 ' + (match.is_photographed ? 'bg-gray-700 border border-yellow-600' : 'bg-gray-800')}>
                    <p className={'font-bold ' + (match.is_photographed ? 'text-yellow-400' : 'text-white')}>
                      {match.full_name}{match.is_photographed ? ' (already cataloged)' : ''}
                    </p>
                    <p className="text-gray-300 text-sm">
                      {match.date_of_death_verbatim && 'd. ' + match.date_of_death_verbatim}
                      {match.maiden_name && ' | nee ' + match.maiden_name}
                      {match.yearDiff !== undefined && match.yearDiff < 999 && (' | ' + match.yearDiff + ' yr' + (match.yearDiff !== 1 ? 's' : '') + ' off')}
                    </p>
                    <button onClick={() => confirmMatch(item.person, match)}
                      disabled={confirming === match.deceased_id}
                      className={'mt-2 w-full py-2 rounded text-sm font-bold ' + (
                        confirming === match.deceased_id ? 'bg-gray-600 text-gray-400' :
                        match.is_photographed ? 'bg-yellow-700 hover:bg-yellow-600 text-white' :
                        'bg-green-700 hover:bg-green-600 text-white'
                      )}>
                      {confirming === match.deceased_id ? 'Saving...' : match.is_photographed ? 'Confirm Again' : 'Confirm Match'}
                    </button>
                  </div>
                ))}
              </div>
            ))}
            <button onClick={clearPhotoResults} className="w-full bg-gray-700 hover:bg-gray-600 text-white py-3 rounded-lg mt-2">
              Clear and Start Over
            </button>
          </div>
        )}
      </div>
    </div>
  )
}