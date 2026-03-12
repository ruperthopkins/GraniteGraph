import { useState, useRef } from 'react'
import { supabase } from './supabaseClient'

// Parse kinship hints from Gemini into structured relationships
const parseKinshipHints = (hints, subjectName) => {
  if (!hints || hints.length === 0) return []
  const relationships = []

  const patterns = [
    { regex: /(?:wife|spouse|consort)\s+of\s+([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?(?:[A-Z][a-z]+))/i, type: 'spouse' },
    { regex: /(?:husband)\s+of\s+([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?(?:[A-Z][a-z]+))/i, type: 'spouse' },
    { regex: /(?:son|daughter|child)\s+of\s+(.+)/i, type: 'child' },
    { regex: /(?:father|mother|parent)\s+of\s+(.+)/i, type: 'parent' },
    { regex: /(?:brother|sister|sibling)\s+of\s+(.+)/i, type: 'sibling' },
  ]

  hints.forEach(hint => {
    patterns.forEach(({ regex, type }) => {
      const match = hint.match(regex)
      if (match) {
        const namesPart = match[1]
        // Handle "RUPERT H. & CHARLOTTE B. HOPKINS" style
        const names = namesPart.split(/\s*[&,]\s*/)
        names.forEach(rawName => {
          const cleaned = rawName.trim().replace(/\.$/, '')
          if (cleaned.length > 2) {
            relationships.push({ type, rawName: cleaned, hint })
          }
        })
      }
    })
  })

  return relationships
}

// Extract last name from a raw name string
const extractLastName = (rawName) => {
  const words = rawName.trim().split(/\s+/)
  return words[words.length - 1]
}

// Extract first name from a raw name string  
const extractFirstName = (rawName) => {
  const words = rawName.trim().split(/\s+/)
  return words[0]
}

export default function Home({ session, onMap, onRecent }) {
  const [image, setImage] = useState(null)
  const [imageBase64, setImageBase64] = useState(null)
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState(null)
  const [kinshipSuggestions, setKinshipSuggestions] = useState(null)
  const fileInput = useRef(null)

  const handlePhoto = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onloadend = () => {
      const base64 = reader.result.split(',')[1]
      setImageBase64(base64)
      setImage(reader.result)
    }
    reader.readAsDataURL(file)
  }

  const resizeImage = (base64) => {
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        const maxSize = 1024
        let width = img.width
        let height = img.height
        if (width > height && width > maxSize) {
          height = (height * maxSize) / width
          width = maxSize
        } else if (height > maxSize) {
          width = (width * maxSize) / height
          height = maxSize
        }
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, width, height)
        resolve(canvas.toDataURL('image/jpeg', 0.8).split(',')[1])
      }
      img.src = 'data:image/jpeg;base64,' + base64
    })
  }

  const searchForPerson = async (person) => {
    let searchTerm = person.last_name || ''
    const firstName = person.first_name || ''

    if (!searchTerm && person.kinship_hints && person.kinship_hints.length > 0) {
      const kinshipText = person.kinship_hints.join(' ')
      const words = kinshipText.split(' ')
      searchTerm = words[words.length - 1]
    }

    const deathYearMatch = (person.date_of_death_verbatim || '').match(/\d{4}/)
    const extractedYear = deathYearMatch ? parseInt(deathYearMatch[0]) : null

    let query = supabase
      .from('v_deceased_search')
      .select('*')
      .ilike('last_name', `%${searchTerm}%`)

    if (firstName) {
      query = query.ilike('first_name', `%${firstName}%`)
    }

    const { data: rawMatches, error: searchError } = await query.limit(20)

    if (searchError) {
      console.error('Supabase search error:', searchError)
      return []
    }

    let matches = rawMatches || []
    if (extractedYear && matches.length > 0) {
      matches = matches
        .map(m => ({
          ...m,
          yearDiff: m.date_of_death
            ? Math.abs(new Date(m.date_of_death).getFullYear() - extractedYear)
            : 999
        }))
        .sort((a, b) => a.yearDiff - b.yearDiff)
        .slice(0, 10)
    }

    return matches
  }

  const searchForRelative = async (rawName) => {
    const firstName = extractFirstName(rawName)
    const lastName = extractLastName(rawName)

    const { data, error } = await supabase
      .from('v_deceased_search')
      .select('*')
      .ilike('last_name', `%${lastName}%`)
      .ilike('first_name', `%${firstName}%`)
      .limit(5)

    if (error) return []
    return data || []
  }

  const analyzePhoto = async () => {
    if (!imageBase64) return
    setLoading(true)
    setResults(null)
    setKinshipSuggestions(null)
    try {
      const resizedBase64 = await resizeImage(imageBase64)
      const geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.REACT_APP_GEMINI_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                {
                  text: `You are transcribing text from a historic cemetery gravestone photograph. The stone may be weathered, poorly lit, or use 18th/19th century typography. There may be ONE or MULTIPLE people on the same stone.\n\nExtract ALL people mentioned on the stone. For each person extract:\n- First name, middle name, last name\n- Maiden name (often shown as nee or born)\n- Birth date exactly as inscribed\n- Death date exactly as inscribed\n- Any kinship text (e.g. wife of, son of, daughter of)\n- Any titles (Rev, Dr, Pvt, Capt etc.)\n\nRules:\n- Transcribe exactly what you see, do not guess or infer\n- For uncertain characters use ? (e.g. 18?4)\n- For unreadable sections use [unreadable]\n- The long S character should be transcribed as regular s\n- If a last name is not shown, infer it from context (e.g. family stone header)\n- For stone_condition use only: excellent, good, fair, poor, illegible, or missing
- Return ONLY a JSON object, no other text\n\nReturn this exact JSON structure:\n{\n  "people": [\n    {\n      "first_name": "",\n      "middle_name": "",\n      "last_name": "",\n      "maiden_name": "",\n      "date_of_birth_verbatim": "",\n      "date_of_death_verbatim": "",\n      "kinship_hints": [],\n      "titles": "",\n      "confidence": "high|medium|low",\n      "notes": ""\n    }\n  ],\n  "stone_condition": "good",
  "stone_notes": ""\n}`
                },
                {
                  inline_data: {
                    mime_type: 'image/jpeg',
                    data: resizedBase64
                  }
                }
              ]
            }],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 4096,
              thinkingConfig: {
                thinkingBudget: 0
              }
            }
          })
        }
      )

      const geminiData = await geminiResponse.json()
      console.log('Gemini raw response:', JSON.stringify(geminiData))

      if (!geminiData.candidates || geminiData.candidates.length === 0) {
        throw new Error('Gemini error: ' + (geminiData.error?.message || JSON.stringify(geminiData)))
      }

      const rawText = geminiData.candidates[0].content.parts[0].text
      const cleaned = rawText.replace(/```json|```/g, '').trim()
      const extracted = JSON.parse(cleaned)

      const people = extracted.people || []
      const peopleWithMatches = await Promise.all(
        people.map(async (person) => {
          const matches = await searchForPerson(person)
          return { person, matches }
        })
      )

      setResults({ peopleWithMatches, stone_notes: extracted.stone_notes, stone_condition: extracted.stone_condition || 'fair' })
    } catch (err) {
      console.error('Full error:', err)
      alert('Error: ' + err.message)
    }
    setLoading(false)
  }

  const confirmMatch = async (person, matchedRecord) => {
    try {
      // Capture GPS
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        })
      })
      const lat = position.coords.latitude
      const lng = position.coords.longitude
      const accuracy = position.coords.accuracy

      // Convert base64 to blob
      const byteString = atob(imageBase64)
      const byteArray = new Uint8Array(byteString.length)
      for (let i = 0; i < byteString.length; i++) {
        byteArray[i] = byteString.charCodeAt(i)
      }
      const blob = new Blob([byteArray], { type: 'image/jpeg' })
      const fileName = `${Date.now()}_${session.user.id}.jpg`

      const { error: photoError } = await supabase.storage
        .from('Stone_Images')
        .upload(fileName, blob, { contentType: 'image/jpeg' })

      if (photoError) throw photoError

      const { data: { publicUrl } } = supabase.storage
        .from('Stone_Images')
        .getPublicUrl(fileName)

      // Create stone record with GPS and Gemini notes
      const { data: stoneData, error: stoneError } = await supabase
        .from('stones')
        .insert({
          cemetery_id: 'd8bd1f88-cdde-4ef2-a448-5ab04d2d8107',
          volunteer_notes: person.notes || '',
          stone_condition: results.stone_condition || 'fair',
condition_notes: results.stone_notes || '',
          inscription_text: results.peopleWithMatches
            .map(p => [
              p.person.first_name,
              p.person.middle_name,
              p.person.last_name,
              p.person.date_of_birth_verbatim,
              p.person.date_of_death_verbatim,
              ...(p.person.kinship_hints || [])
            ].filter(Boolean).join(' '))
            .join(' | '),
          field_status: 'complete',
          location: `SRID=4326;POINT(${lng} ${lat})`,
          gps_accuracy_m: accuracy
        })
        .select()
        .single()

      if (stoneError) throw stoneError

      await supabase
        .from('stone_photos')
        .insert({
          stone_id: stoneData.stone_id,
          photo_url: publicUrl,
          side: 'front',
          taken_by: session.user.id,
          is_primary: true
        })

      await supabase
        .from('stone_deceased')
        .insert({
          stone_id: stoneData.stone_id,
          deceased_id: matchedRecord.deceased_id,
          confirmed_by: session.user.id,
          confirmed_at: new Date().toISOString(),
          match_method: 'volunteer_confirmed'
        })

      await supabase
        .from('activity_log')
        .insert({
          user_id: session.user.id,
          action: 'match_confirmed',
          entity_type: 'stone_deceased',
          entity_id: stoneData.stone_id,
          cemetery_id: 'd8bd1f88-cdde-4ef2-a448-5ab04d2d8107',
          metadata: {
            deceased_name: matchedRecord.full_name,
            gemini_confidence: person.confidence,
            kinship_hints: person.kinship_hints,
            gps: { lat, lng, accuracy }
          }
        })

      // Now build kinship suggestions
      const relationships = parseKinshipHints(person.kinship_hints, matchedRecord.full_name)
      if (relationships.length > 0) {
        const suggestionsWithCandidates = await Promise.all(
          relationships.map(async (rel) => {
            const candidates = await searchForRelative(rel.rawName)
            return { ...rel, candidates, subjectId: matchedRecord.deceased_id, subjectName: matchedRecord.full_name }
          })
        )
        setKinshipSuggestions(suggestionsWithCandidates.filter(s => s.candidates.length > 0))
        setResults(null)
        setImage(null)
        setImageBase64(null)
      } else {
        alert('Match confirmed! ' + matchedRecord.full_name + ' linked.\nGPS: ' + lat.toFixed(6) + ', ' + lng.toFixed(6))
        setResults(null)
        setImage(null)
        setImageBase64(null)
      }

    } catch (err) {
      console.error(err)
      alert('Error saving match: ' + err.message)
    }
  }

  const confirmKinship = async (suggestion, candidate) => {
    // Determine the inverse relationship
    const inverseType = {
      'spouse': 'spouse',
      'child': 'parent',
      'parent': 'child',
      'sibling': 'sibling'
    }[suggestion.type] || 'unknown'

    try {
      // Insert primary → relative
      await supabase
        .from('kinship')
        .insert({
          primary_deceased_id: suggestion.subjectId,
          relative_deceased_id: candidate.deceased_id,
          relationship_type: suggestion.type,
          source: 'stone_inscription',
          confidence: 0.9,
          notes: suggestion.hint
        })

      // Insert inverse: relative → primary
      await supabase
        .from('kinship')
        .insert({
          primary_deceased_id: candidate.deceased_id,
          relative_deceased_id: suggestion.subjectId,
          relationship_type: inverseType,
          source: 'stone_inscription',
          confidence: 0.9,
          notes: suggestion.hint
        })

      await supabase
        .from('activity_log')
        .insert({
          user_id: session.user.id,
          action: 'kinship_confirmed',
          entity_type: 'kinship',
          entity_id: suggestion.subjectId,
          cemetery_id: 'd8bd1f88-cdde-4ef2-a448-5ab04d2d8107',
          metadata: {
            subject: suggestion.subjectName,
            relative: candidate.full_name,
            relationship: suggestion.type
          }
        })

      alert('Kinship saved: ' + suggestion.subjectName + ' is ' + suggestion.type + ' of ' + candidate.full_name)

      // Remove this suggestion from the list
      setKinshipSuggestions(prev => prev.filter(s => s !== suggestion))

    } catch (err) {
      console.error(err)
      alert('Error saving kinship: ' + err.message)
    }
  }

  const clearResults = () => {
    setResults(null)
    setImage(null)
    setImageBase64(null)
    setKinshipSuggestions(null)
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="bg-gray-800 p-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-green-400">Granite Graph</h1>
        <div className="flex gap-3">
          <button onClick={onMap} className="text-gray-400 text-sm hover:text-white">Map</button>
          <button onClick={onRecent} className="text-gray-400 text-sm hover:text-white">Recent</button>
          <button onClick={() => supabase.auth.signOut()} className="text-gray-400 text-sm hover:text-white">Sign Out</button>
        </div>
      </div>

      <div className="p-4 max-w-lg mx-auto">
        <input
          type="file"
          accept="image/*"
          capture="environment"
          ref={fileInput}
          onChange={handlePhoto}
          className="hidden"
        />

        <button
          onClick={() => fileInput.current.click()}
          className="w-full bg-green-700 hover:bg-green-600 text-white font-bold py-6 rounded-lg text-lg mb-4 flex items-center justify-center gap-3"
        >
          Photograph Stone
        </button>

        {image && (
          <div className="mb-4">
            <img src={image} alt="Gravestone" className="w-full rounded-lg mb-3" />
            <button
              onClick={analyzePhoto}
              disabled={loading}
              className="w-full bg-blue-700 hover:bg-blue-600 disabled:bg-blue-900 text-white font-bold py-3 rounded-lg"
            >
              {loading ? 'Analyzing...' : 'Analyze with Gemini'}
            </button>
          </div>
        )}

        {/* Kinship Suggestions Panel */}
        {kinshipSuggestions && kinshipSuggestions.length > 0 && (
          <div className="mt-4">
            <div className="bg-yellow-900 border border-yellow-600 rounded-lg p-4 mb-4">
              <h2 className="text-yellow-400 font-bold mb-1">Suggested Kinship Links</h2>
              <p className="text-yellow-200 text-sm">Stone inscription suggests these relationships. Confirm or skip each one.</p>
            </div>

            {kinshipSuggestions.map((suggestion, sIndex) => (
              <div key={sIndex} className="bg-gray-800 rounded-lg p-4 mb-4 border border-gray-600">
                <p className="text-white font-bold">{suggestion.subjectName}</p>
                <p className="text-yellow-400 text-sm mb-1">
                  is {suggestion.type} of "{suggestion.rawName}"
                </p>
                <p className="text-gray-500 text-xs mb-3">from: "{suggestion.hint}"</p>

                <p className="text-gray-400 text-sm mb-2">Who is this?</p>
                {suggestion.candidates.map(candidate => (
                  <div key={candidate.deceased_id} className="bg-gray-700 rounded p-3 mb-2">
                    <p className="text-white font-bold">{candidate.full_name}</p>
                    {candidate.date_of_death_verbatim && (
                      <p className="text-gray-400 text-sm">d. {candidate.date_of_death_verbatim}</p>
                    )}
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={() => confirmKinship(suggestion, candidate)}
                        className="flex-1 bg-green-700 hover:bg-green-600 text-white py-2 rounded text-sm font-bold"
                      >
                        Confirm
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  onClick={() => setKinshipSuggestions(prev => prev.filter((_, i) => i !== sIndex))}
                  className="w-full bg-gray-700 hover:bg-gray-600 text-gray-400 py-2 rounded text-sm mt-1"
                >
                  Skip this relationship
                </button>
              </div>
            ))}

            <button
              onClick={() => setKinshipSuggestions(null)}
              className="w-full bg-gray-700 hover:bg-gray-600 text-white py-3 rounded-lg mt-2"
            >
              Done with kinship
            </button>
          </div>
        )}

        {/* Results */}
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
                  <p className="font-bold">
                    {item.person.first_name} {item.person.middle_name} {item.person.last_name}
                    {item.person.maiden_name ? ' (nee ' + item.person.maiden_name + ')' : ''}
                  </p>
                  {item.person.date_of_birth_verbatim && (
                    <p className="text-gray-400 text-sm">b. {item.person.date_of_birth_verbatim}</p>
                  )}
                  {item.person.date_of_death_verbatim && (
                    <p className="text-gray-400 text-sm">d. {item.person.date_of_death_verbatim}</p>
                  )}
                  {item.person.kinship_hints && item.person.kinship_hints.length > 0 && (
                    <p className="text-gray-400 text-sm">{item.person.kinship_hints.join(', ')}</p>
                  )}
                  <p className={
                    item.person.confidence === 'high' ? 'text-green-400 text-xs mt-1' :
                    item.person.confidence === 'medium' ? 'text-yellow-400 text-xs mt-1' :
                    'text-red-400 text-xs mt-1'
                  }>
                    Confidence: {item.person.confidence}
                  </p>
                </div>

                <p className="text-gray-400 text-sm mb-2">
                  Database matches ({item.matches.length}):
                </p>

                {item.matches.length === 0 && (
                  <div className="bg-gray-800 rounded p-3">
                    <p className="text-gray-500 text-sm">No matches found.</p>
                  </div>
                )}

                {item.matches.map(match => (
                  <div
                    key={match.deceased_id}
                    className={`p-3 rounded-lg mb-2 ${
                      match.is_photographed
                        ? 'bg-gray-700 border border-yellow-600'
                        : 'bg-gray-800'
                    }`}
                  >
                    <p className={`font-bold ${match.is_photographed ? 'text-yellow-400' : 'text-white'}`}>
                      {match.full_name}
                      {match.is_photographed ? ' (already cataloged)' : ''}
                    </p>
                    <p className="text-gray-400 text-sm">
                      {match.date_of_death_verbatim && 'd. ' + match.date_of_death_verbatim}
                      {match.maiden_name && ' | nee ' + match.maiden_name}
                      {match.yearDiff !== undefined && match.yearDiff < 999 && (
                        ' | ' + match.yearDiff + ' yr' + (match.yearDiff !== 1 ? 's' : '') + ' off'
                      )}
                    </p>
                    <button
                      onClick={() => confirmMatch(item.person, match)}
                      className={`mt-2 w-full py-2 rounded text-sm font-bold ${
                        match.is_photographed
                          ? 'bg-yellow-700 hover:bg-yellow-600 text-white'
                          : 'bg-green-700 hover:bg-green-600 text-white'
                      }`}
                    >
                      {match.is_photographed ? 'Confirm Again' : 'Confirm Match'}
                    </button>
                  </div>
                ))}
              </div>
            ))}

            <button
              onClick={clearResults}
              className="w-full bg-gray-700 hover:bg-gray-600 text-white py-3 rounded-lg mt-2"
            >
              Clear and Start Over
            </button>
          </div>
        )}
      </div>
    </div>
  )
}