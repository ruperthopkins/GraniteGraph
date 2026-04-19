import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'

export default function Recent({ onBack }) {
  const [confirmations, setConfirmations] = useState([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(null)

  useEffect(() => {
    fetchRecent()
  }, [])

  const fetchRecent = async () => {
    const { data, error } = await supabase
      .from('stone_deceased')
      .select(`
        stone_id,
        deceased_id,
        confirmed_at,
        match_method,
        deceased (
          first_name,
          middle_name,
          last_name,
          date_of_birth_verbatim,
          date_of_death_verbatim
        ),
        stones (
          gps_accuracy_m,
          field_status,
          volunteer_notes,
          stone_photos (
            photo_url,
            is_primary
          )
        )
      `)
      .eq('match_method', 'volunteer_confirmed')
      .order('confirmed_at', { ascending: false })
      .limit(20)

    if (error) {
      console.error('Error fetching recent:', error)
    } else {
      setConfirmations(data || [])
    }
    setLoading(false)
  }

  const undoMatch = async (stoneId, deceasedId, fullName) => {
    if (!window.confirm('Remove match for ' + fullName + '? This cannot be undone.')) return

    setDeleting(stoneId)
    try {
      // Delete stone_deceased link
      const { error: sdError } = await supabase
        .from('stone_deceased')
        .delete()
        .eq('stone_id', stoneId)
        .eq('deceased_id', deceasedId)

      if (sdError) throw sdError

      // Delete stone_photos
      const { error: spError } = await supabase
        .from('stone_photos')
        .delete()
        .eq('stone_id', stoneId)

      if (spError) throw spError

      // Delete stone record
      const { error: sError } = await supabase
        .from('stones')
        .delete()
        .eq('stone_id', stoneId)

      if (sError) throw sError

      // Log the undo
      const { data: { user } } = await supabase.auth.getUser()
      await supabase
        .from('activity_log')
        .insert({
          user_id: user?.id,
          action: 'match_undone',
          entity_type: 'stone_deceased',
          entity_id: stoneId,
          cemetery_id: 'd8bd1f88-cdde-4ef2-a448-5ab04d2d8107',
          metadata: { deceased_name: fullName, reason: 'volunteer_undo' }
        })

      alert('Match removed for ' + fullName)
      fetchRecent()
    } catch (err) {
      console.error(err)
      alert('Error removing match: ' + err.message)
    }
    setDeleting(null)
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

      <div className="p-4 max-w-lg mx-auto">
        <h2 className="text-green-400 font-bold text-lg mb-4">
          Recent Confirmations ({confirmations.length})
        </h2>

        {loading && (
          <p className="text-gray-400">Loading...</p>
        )}

        {!loading && confirmations.length === 0 && (
          <div className="bg-gray-800 rounded-lg p-4">
            <p className="text-gray-400">No volunteer confirmations yet.</p>
          </div>
        )}

        {confirmations.map(item => {
          const d = item.deceased
          const s = item.stones
          const photo = s?.stone_photos?.find(p => p.is_primary) || s?.stone_photos?.[0]
          const fullName = d ? d.first_name + ' ' + (d.middle_name ? d.middle_name + ' ' : '') + d.last_name : 'Unknown'
          const confirmedAt = item.confirmed_at
            ? new Date(item.confirmed_at).toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric',
                hour: '2-digit', minute: '2-digit'
              })
            : 'Unknown date'

          return (
            <div
              key={item.stone_id + item.deceased_id}
              className="bg-gray-800 rounded-lg p-4 mb-3"
            >
              {photo && (
                <img
                  src={photo.photo_url}
                  alt="Stone"
                  className="w-full rounded-lg mb-3 max-h-48 object-cover"
                />
              )}
              <p className="font-bold text-white text-lg">{fullName}</p>
              {d?.date_of_birth_verbatim && (
                <p className="text-gray-400 text-sm">b. {d.date_of_birth_verbatim}</p>
              )}
              {d?.date_of_death_verbatim && (
                <p className="text-gray-400 text-sm">d. {d.date_of_death_verbatim}</p>
              )}
              <p className="text-gray-500 text-xs mt-1">Confirmed: {confirmedAt}</p>
              {s?.gps_accuracy_m && (
                <p className="text-green-400 text-xs">GPS: {s.gps_accuracy_m.toFixed(1)}m accuracy</p>
              )}
              {s?.volunteer_notes && (
                <p className="text-gray-400 text-xs mt-1">Notes: {s.volunteer_notes}</p>
              )}
              <button
                onClick={() => undoMatch(item.stone_id, item.deceased_id, fullName)}
                disabled={deleting === item.stone_id}
                className="mt-3 w-full py-2 rounded text-sm font-bold bg-red-800 hover:bg-red-700 text-white transition-colors"
              >
                {deleting === item.stone_id ? 'Removing...' : 'Undo Match'}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}