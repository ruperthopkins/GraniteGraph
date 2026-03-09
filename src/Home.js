import { useState, useRef } from 'react'
import { supabase } from './supabaseClient'

export default function Home({ session }) {
  const [image, setImage] = useState(null)
  const [imageBase64, setImageBase64] = useState(null)
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState(null)
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

  const analyzePhoto = async () => {
    if (!imageBase64) return
    setLoading(true)
    setResults(null)
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
                  text: `You are transcribing text from a historic cemetery gravestone photograph. The stone may be weathered, poorly lit, or use 18th/19th century typography.\n\nExtract the following if visible:\n- First name, middle name, last name\n- Maiden name (often shown as née or born)\n- Birth date exactly as inscribed\n- Death date exactly as inscribed\n- Any kinship text (e.g. wife of, son of, daughter of)\n- Any titles (Rev, Dr, Pvt, Capt etc.)\n\nRules:\n- Transcribe exactly what you see, do not guess or infer\n- For uncertain characters use ? (e.g. 18?4)\n- For unreadable sections use [unreadable]\n- The long S character (ſ) should be transcribed as regular s\n- Return ONLY a JSON object, no other text\n\nReturn this exact JSON structure:\n{\n  "first_name": "",\n  "middle_name": "",\n  "last_name": "",\n  "maiden_name": "",\n  "date_of_birth_verbatim": "",\n  "date_of_death_verbatim": "",\n  "kinship_hints": [],\n  "titles": "",\n  "confidence": "high|medium|low",\n  "notes": ""\n}`
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

      console.log('Gemini extracted:', extracted)

      const searchTerm = extracted.last_name || ''
      const firstName = extracted.first_name || ''

      const { data: matches, error: searchError } = await supabase
        .from('v_deceased_search')
        .select('*')
        .ilike('last_name', `%${searchTerm}%`)
        .ilike('first_name', `%${firstName}%`)
        .limit(10)

      if (searchError) {
        console.error('Supabase search error:', searchError)
        throw searchError
      }

      console.log('Supabase matches:', matches)
      setResults({ extracted, matches })
    } catch (err) {
      console.error('Full error:', err)
      alert('Error: ' + err.message)
    }
    setLoading(false)
  }

  const confirmMatch = async (person) => {
    try {
      // Capture GPS coordinates
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

      // Save photo to Supabase storage
      const fileName = `${Date.now()}_${session.user.id}.jpg`
      const blob = await fetch(image).then(r => r.blob())

      const { error: photoError } = await supabase.storage
        .from('Stone_Images')
        .upload(fileName, blob, { contentType: 'image/jpeg' })

      if (photoError) throw photoError

      const { data: { publicUrl } } = supabase.storage
        .from('Stone_Images')
        .getPublicUrl(fileName)

      // Create stone record with GPS
      const { data: stoneData, error: stoneError } = await supabase
        .from('stones')
        .insert({
          cemetery_id: 'd8bd1f88-cdde-4ef2-a448-5ab04d2d8107',
          volunteer_notes: results.extracted.notes || '',
          field_status: 'complete',
          location: `SRID=4326;POINT(${lng} ${lat})`,
          gps_accuracy_m: accuracy
        })
        .select()
        .single()

      if (stoneError) throw stoneError

      // Save photo record
      await supabase
        .from('stone_photos')
        .insert({
          stone_id: stoneData.stone_id,
          photo_url: publicUrl,
          side: 'front',
          taken_by: session.user.id,
          is_primary: true
        })

      // Link stone to deceased
      await supabase
        .from('stone_deceased')
        .insert({
          stone_id: stoneData.stone_id,
          deceased_id: person.deceased_id,
          confirmed_by: session.user.id,
          confirmed_at: new Date().toISOString(),
          match_method: 'volunteer_confirmed'
        })

      // Log activity
      await supabase
        .from('activity_log')
        .insert({
          user_id: session.user.id,
          action: 'match_confirmed',
          entity_type: 'stone_deceased',
          entity_id: stoneData.stone_id,
          cemetery_id: 'd8bd1f88-cdde-4ef2-a448-5ab04d2d8107',
          metadata: {
            deceased_name: person.full_name,
            gemini_confidence: results.extracted.confidence,
            kinship_hints: results.extracted.kinship_hints,
            gps: { lat, lng, accuracy }
          }
        })

      alert(`Match confirmed! ${person.full_name} linked to new stone.\nGPS: ${lat.toFixed(6)}, ${lng.toFixed(6)}`)
      setResults(null)
      setImage(null)
      setImageBase64(null)

    } catch (err) {
      console.error(err)
      alert('Error saving match: ' + err.message)
    }
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <div className="bg-gray-800 p-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-green-400">Granite Graph</h1>
        <button
          onClick={() => supabase.auth.signOut()}
          className="text-gray-400 text-sm hover:text-white"
        >
          Sign Out
        </button>
      </div>

      <div className="p-4 max-w-lg mx-auto">
        {/* Hidden file input */}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          ref={fileInput}
          onChange={handlePhoto}
          className="hidden"
        />

        {/* Camera Button */}
        <button
          onClick={() => fileInput.current.click()}
          className="w-full bg-green-700 hover:bg-green-600 text-white font-bold py-6 rounded-lg text-lg mb-4 flex items-center justify-center gap-3"
        >
          📷 Photograph Stone
        </button>

        {/* Image Preview */}
        {image && (
          <div className="mb-4">
            <img
              src={image}
              alt="Gravestone"
              className="w-full rounded-lg mb-3"
            />
            <button
              onClick={analyzePhoto}
              disabled={loading}
              className="w-full bg-blue-700 hover:bg-blue-600 disabled:bg-blue-900 text-white font-bold py-3 rounded-lg"
            >
              {loading ? '🔍 Analyzing...' : '🔍 Analyze with Gemini'}
            </button>
          </div>
        )}

        {/* Results */}
        {results && (
          <div className="mt-4">
            {/* Gemini Extraction */}
            <div className="bg-gray-800 rounded-lg p-4 mb-4">
              <h2 className="text-green-400 font-bold mb-2">Gemini Extracted:</h2>
              <p>
                <span className="text-gray-400">Name: </span>
                {results.extracted.first_name} {results.extracted.middle_name} {results.extracted.last_name}
              </p>
              {results.extracted.maiden_name && (
                <p>
                  <span className="text-gray-400">Maiden: </span>
                  {results.extracted.maiden_name}
                </p>
              )}
              {results.extracted.date_of_birth_verbatim && (
                <p>
                  <span className="text-gray-400">Born: </span>
                  {results.extracted.date_of_birth_verbatim}
                </p>
              )}
              {results.extracted.date_of_death_verbatim && (
                <p>
                  <span className="text-gray-400">Died: </span>
                  {results.extracted.date_of_death_verbatim}
                </p>
              )}
              {results.extracted.kinship_hints?.length > 0 && (
                <p>
                  <span className="text-gray-400">Kinship: </span>
                  {results.extracted.kinship_hints.join(', ')}
                </p>
              )}
              <p>
                <span className="text-gray-400">Confidence: </span>
                <span className={
                  results.extracted.confidence === 'high' ? 'text-green-400' :
                  results.extracted.confidence === 'medium' ? 'text-yellow-400' :
                  'text-red-400'
                }>
                  {results.extracted.confidence}
                </span>
              </p>
            </div>

            {/* Database Matches */}
            <h2 className="text-green-400 font-bold mb-2">
              Database Matches ({results.matches?.length || 0}):
            </h2>
            {results.matches?.length === 0 && (
              <div className="bg-gray-800 rounded-lg p-4">
                <p className="text-gray-400">No matches found.</p>
                <p className="text-gray-500 text-sm mt-1">
                  Add a note and move to the next stone.
                </p>
              </div>
            )}
            {results.matches?.map(person => (
              <div
                key={person.deceased_id}
                className={`p-4 rounded-lg mb-2 ${
                  person.is_photographed
                    ? 'bg-gray-700 border border-yellow-600'
                    : 'bg-gray-800'
                }`}
              >
                <p className={`font-bold text-lg ${
                  person.is_photographed ? 'text-yellow-400' : 'text-white'
                }`}>
                  {person.full_name}
                  {person.is_photographed && ' ✓'}
                </p>
                <p className="text-gray-400 text-sm">
                  {person.date_of_death_verbatim && `d. ${person.date_of_death_verbatim}`}
                  {person.maiden_name && ` • née ${person.maiden_name}`}
                </p>
                {person.is_photographed && (
                  <p className="text-yellow-600 text-xs mt-1">
                    Already cataloged ({person.stone_count} stone{person.stone_count > 1 ? 's' : ''})
                  </p>
                )}
                <button
                  onClick={() => confirmMatch(person)}
                  className={`mt-3 w-full py-2 rounded text-sm font-bold transition-colors ${
                    person.is_photographed
                      ? 'bg-yellow-700 hover:bg-yellow-600 text-white'
                      : 'bg-green-700 hover:bg-green-600 text-white'
                  }`}
                >
                  {person.is_photographed ? '✓ Confirm Again' : '✓ Confirm Match'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}