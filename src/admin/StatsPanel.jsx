// src/admin/StatsPanel.jsx
import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { CEMETERY_ID } from '../constants'

export default function StatsPanel() {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchStats() {
      const [
        { count: totalPeople },
        { count: parentRows },
        { count: spouseRows },
        { count: siblingRows },
        { data: relatedIds },
        { data: stonedIds },
        { data: photoedIds },
        { data: sources },
      ] = await Promise.all([
        supabase
          .from('deceased')
          .select('*', { count: 'exact', head: true })
          .eq('cemetery_id', CEMETERY_ID),
        supabase
          .from('kinship')
          .select('*', { count: 'exact', head: true })
          .eq('relationship_type', 'parent'),
        supabase
          .from('kinship')
          .select('*', { count: 'exact', head: true })
          .eq('relationship_type', 'spouse'),
        supabase
          .from('kinship')
          .select('*', { count: 'exact', head: true })
          .eq('relationship_type', 'sibling'),
        supabase.from('kinship').select('primary_deceased_id'),
        supabase.from('stone_deceased').select('deceased_id'),
        supabase.from('stone_photos').select('stone_id'),
        supabase.from('sources').select('name').order('name'),
      ])

      setStats({
        totalPeople: totalPeople ?? 0,
        withRelationships: new Set(relatedIds?.map(r => r.primary_deceased_id)).size,
        withStones: new Set(stonedIds?.map(r => r.deceased_id)).size,
        parentChildPairs: parentRows ?? 0,
        spousePairs: Math.floor((spouseRows ?? 0) / 2),
        siblingPairs: Math.floor((siblingRows ?? 0) / 2),
        stonesPhotographed: new Set(photoedIds?.map(r => r.stone_id)).size,
        sources: sources?.map(s => s.name) ?? [],
      })
      setLoading(false)
    }
    fetchStats()
  }, [])

  if (loading) {
    return (
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 mb-6 animate-pulse">
        <div className="h-4 w-32 bg-gray-700 rounded mb-3" />
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i}>
              <div className="h-6 w-16 bg-gray-700 rounded mb-1" />
              <div className="h-3 w-24 bg-gray-700 rounded" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (!stats) return null

  const totalPairs = stats.parentChildPairs + stats.spousePairs + stats.siblingPairs

  return (
    <div className="bg-gray-800 border border-green-900 rounded-lg p-4 mb-6">
      <h2 className="text-green-400 font-bold text-xs uppercase tracking-widest mb-4">
        Community Graph
      </h2>

      <div className="grid grid-cols-2 gap-x-4 gap-y-4 mb-4">
        <Stat label="Individuals" value={stats.totalPeople} accent />
        <Stat label="With relationships" value={stats.withRelationships} />
        <Stat label="Linked to a gravestone" value={stats.withStones} />
        <Stat label="Stones photographed" value={stats.stonesPhotographed} />
      </div>

      <div className="border-t border-gray-700 pt-3 mb-3">
        <p className="text-gray-500 text-xs uppercase tracking-wide mb-2">Relationships</p>
        <div className="grid grid-cols-3 gap-x-4 gap-y-3">
          <Stat label="Total pairs" value={totalPairs} accent />
          <Stat label="Parent / child" value={stats.parentChildPairs} />
          <Stat label="Spouse" value={stats.spousePairs} />
          {stats.siblingPairs > 0 && <Stat label="Sibling" value={stats.siblingPairs} />}
        </div>
      </div>

      {stats.sources.length > 0 && (
        <div className="border-t border-gray-700 pt-3 text-xs text-gray-400">
          <span className="text-gray-500">Sources: </span>
          {stats.sources.join(' · ')}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, accent }) {
  return (
    <div>
      <div className={`text-2xl font-bold tabular-nums ${accent ? 'text-green-400' : 'text-white'}`}>
        {value?.toLocaleString() ?? '—'}
      </div>
      <div className="text-gray-400 text-xs mt-0.5">{label}</div>
    </div>
  )
}
