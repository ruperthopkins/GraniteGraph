import { useState, useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import { supabase } from './supabaseClient'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'

// Fix Leaflet default marker icon issue with webpack
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const catalogedIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
})

export default function Map({ onBack }) {
  const [stones, setStones] = useState([])
  const [loading, setLoading] = useState(true)
  const [center, setCenter] = useState([41.1865, -73.1952]) // Default: Bridgeport CT area
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchStones()
  }, [])

  const fetchStones = async () => {
    const { data, error } = await supabase
      .rpc('get_stones_with_coordinates')

    if (error) {
      console.error('RPC error, trying direct query:', error)
      // Fallback: fetch without coordinates
      const { data: fallback, error: fallbackError } = await supabase
        .from('stones')
        .select(`
          stone_id,
          gps_accuracy_m,
          field_status,
          volunteer_notes,
          stone_deceased (
            deceased (
              first_name,
              middle_name,
              last_name,
              date_of_death_verbatim
            )
          ),
          stone_photos (
            photo_url,
            is_primary
          )
        `)
        .not('location', 'is', null)
        .eq('field_status', 'complete')

      if (fallbackError) {
        setError('Could not load stones: ' + fallbackError.message)
      } else {
        setStones(fallback || [])
      }
    } else {
      setStones(data || [])
      if (data && data.length > 0) {
        setCenter([data[0].lat, data[0].lng])
      }
    }
    setLoading(false)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <p className="text-gray-400">Loading map...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="bg-gray-800 p-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-green-400">Granite Graph</h1>
        <button
          onClick={onBack}
          className="text-gray-400 text-sm hover:text-white"
        >
          Back
        </button>
      </div>

      <div className="p-4">
        <p className="text-green-400 font-bold mb-3">
          {stones.length} cataloged stone{stones.length !== 1 ? 's' : ''} with GPS
        </p>

        {error && (
          <div className="bg-red-900 text-red-200 p-3 rounded mb-4 text-sm">
            {error}
          </div>
        )}

        {stones.length === 0 && !error && (
          <div className="bg-gray-800 rounded-lg p-4 mb-4">
            <p className="text-gray-400">No stones with GPS data yet.</p>
            <p className="text-gray-500 text-sm mt-1">Confirm matches in the field to add GPS locations.</p>
          </div>
        )}

        {stones.length > 0 && (
          <div style={{ height: '60vh', borderRadius: '8px', overflow: 'hidden' }}>
            <MapContainer
              center={center}
              zoom={18}
              style={{ height: '100%', width: '100%' }}
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {stones.map(stone => {
                const lat = stone.lat || stone.latitude
                const lng = stone.lng || stone.longitude
                if (!lat || !lng) return null

                const deceased = stone.stone_deceased?.[0]?.deceased
                const photo = stone.stone_photos?.find(p => p.is_primary) || stone.stone_photos?.[0]
                const name = deceased
                  ? deceased.first_name + ' ' + (deceased.middle_name ? deceased.middle_name + ' ' : '') + deceased.last_name
                  : stone.name || 'Unknown'
                const deathDate = deceased?.date_of_death_verbatim || stone.date_of_death_verbatim || ''

                return (
                  <Marker
                    key={stone.stone_id}
                    position={[lat, lng]}
                    icon={catalogedIcon}
                  >
                    <Popup>
                      <div style={{ minWidth: '150px' }}>
                        {photo && (
                          <img
                            src={photo.photo_url}
                            alt="Stone"
                            style={{ width: '100%', borderRadius: '4px', marginBottom: '8px' }}
                          />
                        )}
                        <strong>{name}</strong>
                        {deathDate && <p style={{ margin: '4px 0', fontSize: '12px' }}>d. {deathDate}</p>}
                        {stone.gps_accuracy_m && (
                          <p style={{ margin: '4px 0', fontSize: '11px', color: '#666' }}>
                            GPS: {stone.gps_accuracy_m.toFixed(1)}m accuracy
                          </p>
                        )}
                      </div>
                    </Popup>
                  </Marker>
                )
              })}
            </MapContainer>
          </div>
        )}

        <div className="mt-4">
          <p className="text-gray-500 text-xs text-center">
            Tap a marker to see stone details
          </p>
        </div>
      </div>
    </div>
  )
}