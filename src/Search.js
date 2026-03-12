import { useState } from 'react'
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
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
})

const visitorIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
})

export default function Search({ onLogin }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [selected, setSelected] = useState(null)
  const [stoneData, setStoneData] = useState(null)
  const [searching, setSearching] = useState(false)
  const [visitorLocation, setVisitorLocation] = useState(null)
  const [locating, setLocating] = useState(false)

  const handleSearch = async () => {
    if (!query.trim()) return
    setSearching(true)
    setResults(null)
    setSelected(null)
    setStoneData(null)

    // Parse query — handle any order of names
    const terms = query.trim().split(/[\s,]+/).filter(Boolean)

    let dbQuery = supabase
      .from('v_deceased_search')
      .select('*')

    if (terms.length === 1) {
      dbQuery = dbQuery.or(`last_name.ilike.%${terms[0]}%,first_name.ilike.%${terms[0]}%`)
    } else {
      // Multiple terms — search all combinations
      const orClauses = []
      terms.forEach(term => {
        orClauses.push(`last_name.ilike.%${term}%`)
        orClauses.push(`first_name.ilike.%${term}%`)
        orClauses.push(`middle_name.ilike.%${term}%`)
        orClauses.push(`maiden_name.ilike.%${term}%`)
      })
      dbQuery = dbQuery.or(orClauses.join(','))
    }

    const { data, error } = await dbQuery
      .order('last_name')
      .order('first_name')
      .limit(50)

    if (error) {
      console.error(error)
      alert('Search error: ' + error.message)
    } else {
      // Score results by how many terms match
      const scored = (data || []).map(record => {
  const fullText = [
    record.first_name, record.middle_name,
    record.last_name, record.maiden_name
  ].filter(Boolean).join(' ').toLowerCase()

  const score = terms.filter(t => fullText.includes(t.toLowerCase())).length
  return { ...record, score }
})
// Only show results where ALL terms match
const filtered = scored.filter(r => r.score === terms.length)
setResults(filtered.length > 0 ? filtered : scored)
    }
    setSearching(false)
  }

  const selectRecord = async (record) => {
    setSelected(record)
    setStoneData(null)

    // Fetch stone data if photographed
    if (record.is_photographed) {
      const { data, error } = await supabase
        .from('stone_deceased')
        .select(`
          stones (
            stone_id,
            gps_accuracy_m,
            condition_notes,
            inscription_text,
            location,
            stone_photos (
              photo_url,
              is_primary
            )
          )
        `)
        .eq('deceased_id', record.deceased_id)
        .limit(1)
        .single()

      if (!error && data?.stones) {
        // Get coordinates via RPC
        const { data: coords } = await supabase
          .rpc('get_stones_with_coordinates')

        const stoneCoord = coords?.find(c => c.stone_id === data.stones.stone_id)
        setStoneData({
          ...data.stones,
          lat: stoneCoord?.lat,
          lng: stoneCoord?.lng
        })
      }
    }
  }

  const getMyLocation = () => {
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setVisitorLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setLocating(false)
      },
      () => {
        alert('Could not get your location. Please enable location access.')
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  const openInMaps = (lat, lng, name) => {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    const url = isIOS
      ? `maps://maps.apple.com/?daddr=${lat},${lng}&dirflg=w`
      : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`
    window.open(url, '_blank')
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <div className="bg-gray-800 p-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-green-400">Granite Graph</h1>
          <p className="text-gray-500 text-xs">Historic Cemetery Records</p>
        </div>
        {onLogin && (
          <button
            onClick={onLogin}
            className="text-gray-400 text-sm hover:text-white border border-gray-600 px-3 py-1 rounded"
          >
            Volunteer Login
          </button>
        )}
      </div>

      <div className="p-4 max-w-lg mx-auto">

        {/* Search Box */}
        <div className="mb-6">
          <p className="text-gray-400 text-sm mb-3">
            Search for a person buried in this cemetery. Enter any part of their name.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="e.g. Hopkins, Charlotte, Ralph..."
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg p-3 text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-green-500"
            />
            <button
              onClick={handleSearch}
              disabled={searching}
              className="bg-green-700 hover:bg-green-600 text-white font-bold px-4 rounded-lg"
            >
              {searching ? '...' : 'Search'}
            </button>
          </div>
        </div>

        {/* Search Results */}
        {results && !selected && (
          <div>
            <p className="text-green-400 font-bold mb-3">
              {results.length} result{results.length !== 1 ? 's' : ''} found
            </p>
            {results.length === 0 && (
              <div className="bg-gray-800 rounded-lg p-4">
                <p className="text-gray-400">No records found. Try a different spelling.</p>
              </div>
            )}
            {results.map(record => (
              <div
                key={record.deceased_id}
                onClick={() => selectRecord(record)}
                className="bg-gray-800 rounded-lg p-4 mb-2 cursor-pointer hover:bg-gray-700 border border-gray-700"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-bold text-white">{record.full_name}</p>
                    {record.maiden_name && (
                      <p className="text-gray-400 text-sm">née {record.maiden_name}</p>
                    )}
                    <div className="flex gap-3 mt-1">
                      {record.date_of_birth_verbatim && (
                        <p className="text-gray-500 text-xs">b. {record.date_of_birth_verbatim}</p>
                      )}
                      {record.date_of_death_verbatim && (
                        <p className="text-gray-500 text-xs">d. {record.date_of_death_verbatim}</p>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    {record.is_photographed ? (
                      <span className="text-green-400 text-xs">📷 Photographed</span>
                    ) : (
                      <span className="text-gray-600 text-xs">Not yet cataloged</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Detail View */}
        {selected && (
          <div>
            <button
              onClick={() => { setSelected(null); setStoneData(null) }}
              className="text-gray-400 text-sm hover:text-white mb-4 flex items-center gap-1"
            >
              ← Back to results
            </button>

            {/* Stone photo */}
            {stoneData?.stone_photos?.length > 0 && (
              <img
                src={stoneData.stone_photos.find(p => p.is_primary)?.photo_url || stoneData.stone_photos[0].photo_url}
                alt="Gravestone"
                className="w-full rounded-lg mb-4"
              />
            )}

            {/* Person details */}
            <div className="bg-gray-800 rounded-lg p-4 mb-4">
              <h2 className="text-xl font-bold text-white mb-1">{selected.full_name}</h2>
              {selected.maiden_name && (
                <p className="text-gray-400 text-sm mb-2">née {selected.maiden_name}</p>
              )}
              <div className="flex gap-4">
                {selected.date_of_birth_verbatim && (
                  <div>
                    <p className="text-gray-500 text-xs">Born</p>
                    <p className="text-gray-300 text-sm">{selected.date_of_birth_verbatim}</p>
                  </div>
                )}
                {selected.date_of_death_verbatim && (
                  <div>
                    <p className="text-gray-500 text-xs">Died</p>
                    <p className="text-gray-300 text-sm">{selected.date_of_death_verbatim}</p>
                  </div>
                )}
              </div>
              {selected.biography && (
                <p className="text-gray-400 text-sm mt-3">{selected.biography}</p>
              )}
            </div>

            {/* Stone details */}
            {stoneData && (
              <div className="bg-gray-800 rounded-lg p-4 mb-4">
                {stoneData.condition_notes && (
                  <p className="text-gray-400 text-sm mb-2">{stoneData.condition_notes}</p>
                )}
                {stoneData.inscription_text && (
                  <div className="mt-2">
                    <p className="text-gray-500 text-xs mb-1">Inscription</p>
                    <p className="text-gray-300 text-sm font-mono">{stoneData.inscription_text}</p>
                  </div>
                )}
                {stoneData.gps_accuracy_m && (
                  <p className="text-gray-600 text-xs mt-2">GPS accuracy: {stoneData.gps_accuracy_m.toFixed(1)}m</p>
                )}
              </div>
            )}

            {/* Navigation */}
            {stoneData?.lat && stoneData?.lng && (
              <div className="mb-4">
                <p className="text-green-400 font-bold mb-2">Find this stone</p>

                {/* Mini map */}
                <div style={{ height: '220px', borderRadius: '8px', overflow: 'hidden', marginBottom: '12px' }}>
                  <MapContainer
                    center={[stoneData.lat, stoneData.lng]}
                    zoom={19}
                    style={{ height: '100%', width: '100%' }}
                  >
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    <Marker position={[stoneData.lat, stoneData.lng]} icon={stoneIcon}>
                      <Popup>{selected.full_name}</Popup>
                    </Marker>
                    {visitorLocation && (
                      <Marker position={[visitorLocation.lat, visitorLocation.lng]} icon={visitorIcon}>
                        <Popup>You are here</Popup>
                      </Marker>
                    )}
                  </MapContainer>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => openInMaps(stoneData.lat, stoneData.lng, selected.full_name)}
                    className="flex-1 bg-blue-700 hover:bg-blue-600 text-white py-3 rounded-lg font-bold text-sm"
                  >
                    Open in Maps
                  </button>
                  <button
                    onClick={getMyLocation}
                    disabled={locating}
                    className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-3 rounded-lg font-bold text-sm"
                  >
                    {locating ? 'Locating...' : visitorLocation ? 'Update My Location' : 'Show My Location'}
                  </button>
                </div>
              </div>
            )}

            {!selected.is_photographed && (
              <div className="bg-gray-800 border border-gray-600 rounded-lg p-4">
                <p className="text-gray-400 text-sm">
                  This stone has not been photographed yet. If you are a volunteer, log in to catalog it.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}