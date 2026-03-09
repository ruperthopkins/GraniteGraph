import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'

export default function Map({ onBack }) {
  const [stones, setStones] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchStones()
  }, [])

  const fetchStones = async () => {
    const { data, error } = await supabase
      .from('stones')
      .select(`
        stone_id,
        gps_accuracy_m,
        field_status,
        stone_deceased (
          deceased (
            first_name,
            last_name,
            date_of_death_verbatim
          )
        )
      `)
      .not('location', 'is', null)

    if (error) {
      console.error('Error fetching stones:', error)
    } else {
      setStones(data || [])
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <div className="bg-gray-800 p-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-green-400">Granite Graph</h1>
        <button
          onClick={onBack}
          className="text-gray-400 text-sm hover:text-white"
        >
          ← Back
        </button>
      </div>

      <div className="p-4 max-w-lg mx-auto">
        <h2 className="text-green-400 font-bold text-lg mb-4">
          📍 Cataloged Stones ({stones.length})
        </h2>

        {loading && (
          <p className="text-gray-400">Loading stone locations...</p>
        )}

        {!loading && stones.length === 0 && (
          <div className="bg-gray-800 rounded-lg p-4">
            <p className="text-gray-400">No stones with GPS data yet.</p>
            <p className="text-gray-500 text-sm mt-1">
              Confirm matches in the field to add GPS locations.
            </p>
          </div>
        )}

        {stones.map(stone => {
          const deceased = stone.stone_deceased?.[0]?.deceased
          return (
            <div
              key={stone.stone_id}
              className="bg-gray-800 rounded-lg p-4 mb-3"
            >
              <p className="font-bold text-white">
                {deceased
                  ? `${deceased.first_name} ${deceased.last_name}`
                  : 'Unknown'}
              </p>
              {deceased?.date_of_death_verbatim && (
                <p className="text-gray-400 text-sm">
                  d. {deceased.date_of_death_verbatim}
                </p>
              )}
              <p className="text-green-400 text-xs mt-1">
                GPS accuracy: ±{stone.gps_accuracy_m?.toFixed(1)}m
              </p>
              <p classNam