import { useState, useCallback } from 'react'
import { supabase } from '../supabaseClient'
import { CEMETERY_ID } from '../constants'

const MATCH_RADIUS_M = 20
const AUTO_REPLACE_M = 3

function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const φ1 = lat1 * Math.PI / 180
  const φ2 = lat2 * Math.PI / 180
  const Δφ = (lat2 - lat1) * Math.PI / 180
  const Δλ = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function computeAction(newAcc, nearest) {
  if (!nearest) return { type: 'new', label: 'New stone' }
  const existingAcc = nearest.gps_accuracy_m ?? 999
  if (newAcc != null && newAcc <= AUTO_REPLACE_M)
    return { type: 'replace', label: `Replace — high confidence (${newAcc}m ≤ ${AUTO_REPLACE_M}m)`, stoneId: nearest.stone_id }
  if (newAcc != null && newAcc < existingAcc)
    return { type: 'replace', label: `Replace — better accuracy (${newAcc}m vs ${existingAcc}m existing)`, stoneId: nearest.stone_id }
  if (newAcc != null && newAcc >= existingAcc)
    return { type: 'keep', label: `Keep existing — already better (${existingAcc}m vs ${newAcc}m new)`, stoneId: nearest.stone_id }
  return { type: 'replace', label: 'Replace — no accuracy data to compare', stoneId: nearest.stone_id }
}

export default function GpsImport({ onBack }) {
  const [phase, setPhase] = useState('upload')
  const [rows, setRows] = useState([])
  const [saving, setSaving] = useState(false)
  const [results, setResults] = useState(null)
  const [error, setError] = useState(null)

  const handleFile = useCallback(async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setError(null)
    try {
      const text = await file.text()
      const geojson = JSON.parse(text)
      if (geojson.type !== 'FeatureCollection') throw new Error('File must be a GeoJSON FeatureCollection')
      const feats = geojson.features.filter(f => f.geometry?.type === 'Point')
      if (!feats.length) throw new Error('No Point features found in file')

      const { data: existing, error: rpcErr } = await supabase.rpc('get_stones_with_coordinates')
      if (rpcErr) throw new Error('Could not load existing stones: ' + rpcErr.message)

      const enriched = feats.map((f, i) => {
        const [lng, lat] = f.geometry.coordinates
        const props = f.properties || {}
        const newAcc = props.accuracy != null ? parseFloat(props.accuracy) : null

        let nearest = null
        let nearestDist = Infinity
        for (const s of (existing || [])) {
          if (s.lat == null || s.lng == null) continue
          const d = haversineM(lat, lng, s.lat, s.lng)
          if (d < nearestDist) { nearestDist = d; nearest = s }
        }
        if (nearestDist > MATCH_RADIUS_M) nearest = null
        const distM = nearest ? Math.round(nearestDist) : null

        return { i, lat, lng, newAcc, props, nearest, distM, action: computeAction(newAcc, nearest), override: null }
      })

      setRows(enriched)
      setPhase('review')
    } catch (err) {
      setError(err.message)
    }
  }, [])

  const effectiveAction = (row) => {
    if (!row.override) return row.action
    if (row.override === 'new') return { type: 'new', label: 'New stone (overridden)' }
    if (row.override === 'replace') return { type: 'replace', label: 'Replace (overridden)', stoneId: row.nearest?.stone_id }
    return { type: 'keep', label: 'Keep existing (overridden)', stoneId: row.nearest?.stone_id }
  }

  const setOverride = (i, type) =>
    setRows(prev => prev.map(r => r.i !== i ? r : { ...r, override: type === effectiveAction(r).type ? null : type }))

  const handleCommit = async () => {
    setSaving(true)
    setError(null)
    let replaced = 0, created = 0, kept = 0, failed = 0

    for (const row of rows) {
      const act = effectiveAction(row)
      const locationStr = `SRID=4326;POINT(${row.lng} ${row.lat})`
      const conditionNotes = [row.props.condition, row.props.notes].filter(Boolean).join(' — ') || null

      try {
        if (act.type === 'new') {
          const { error } = await supabase.from('stones').insert({
            cemetery_id: CEMETERY_ID,
            location: locationStr,
            gps_accuracy_m: row.newAcc,
            condition_notes: conditionNotes,
            field_status: 'needs_review',
          })
          if (error) throw error
          created++
        } else if (act.type === 'replace') {
          const { error } = await supabase.from('stones').update({
            location: locationStr,
            gps_accuracy_m: row.newAcc,
          }).eq('stone_id', act.stoneId)
          if (error) throw error
          replaced++
        } else {
          kept++
        }
      } catch (err) {
        console.error('Row', row.i, 'failed:', err.message)
        failed++
      }
    }

    setSaving(false)
    setResults({ replaced, created, kept, failed })
    setPhase('done')
  }

  const counts = rows.reduce((acc, r) => {
    const t = effectiveAction(r).type
    acc[t] = (acc[t] || 0) + 1
    return acc
  }, {})

  // ── Upload ───────────────────────────────────────────────────────────────
  if (phase === 'upload') return (
    <div style={{ minHeight: '100vh', background: 'var(--color-background-primary)', color: 'var(--color-text-primary)', paddingBottom: 60 }}>
      <Header title="GPS Import" subtitle="Import QField waypoints into the stones table" onBack={onBack} />
      <div style={{ maxWidth: 600, margin: '0 auto', padding: '32px 16px' }}>
        <div style={{ background: 'var(--color-background-secondary)', borderRadius: 'var(--border-radius-md)', padding: 24, border: '0.5px solid var(--color-border-tertiary)', marginBottom: 20 }}>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 16, lineHeight: 1.6 }}>
            In QGIS: right-click the <strong>seaview_stones</strong> layer → Export → Save Features As → Format: GeoJSON → OK. Then upload the file here.
          </p>
          <input type="file" accept=".geojson,.json" onChange={handleFile}
            style={{ fontSize: 13, color: 'var(--color-text-primary)' }} />
          {error && <p style={{ fontSize: 12, color: 'var(--color-text-danger)', marginTop: 12 }}>{error}</p>}
        </div>

        <div style={{ background: 'var(--color-background-secondary)', borderRadius: 'var(--border-radius-md)', padding: '14px 16px', border: '0.5px solid var(--color-border-tertiary)' }}>
          <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: 1 }}>Replacement rules</p>
          {[
            [`New accuracy ≤ ${AUTO_REPLACE_M}m`, 'Always replace — high confidence'],
            ['New accuracy < existing', 'Replace — demonstrably better'],
            ['New accuracy ≥ existing', 'Keep existing (overridable)'],
            [`No match within ${MATCH_RADIUS_M}m`, 'Create new stone record'],
          ].map(([cond, action]) => (
            <div key={cond} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{cond}</span>
              <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>{action}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )

  // ── Review ───────────────────────────────────────────────────────────────
  if (phase === 'review') return (
    <div style={{ minHeight: '100vh', background: 'var(--color-background-primary)', color: 'var(--color-text-primary)', paddingBottom: 80 }}>
      <Header title="GPS Import" subtitle={`${rows.length} waypoints — review before committing`} onBack={onBack} />
      <div style={{ maxWidth: 740, margin: '0 auto', padding: '16px 16px 0' }}>
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <Chip label="New stones" value={counts.new || 0} color="var(--color-text-success)" />
          <Chip label="Replace GPS" value={counts.replace || 0} color="var(--color-text-info)" />
          <Chip label="Keep existing" value={counts.keep || 0} color="var(--color-text-tertiary)" />
        </div>

        {rows.map(row => {
          const act = effectiveAction(row)
          const actionColor = act.type === 'new' ? 'var(--color-text-success)'
            : act.type === 'replace' ? 'var(--color-text-info)'
            : 'var(--color-text-tertiary)'

          return (
            <div key={row.i} style={{ padding: '12px 14px', borderRadius: 'var(--border-radius-md)', border: '0.5px solid var(--color-border-tertiary)', background: 'var(--color-background-secondary)', marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 12, fontWeight: 600, margin: '0 0 3px', color: actionColor }}>{act.label}</p>
                  <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '0 0 2px', fontFamily: 'monospace' }}>
                    {row.lat.toFixed(6)}, {row.lng.toFixed(6)}
                  </p>
                  {row.nearest && (
                    <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '0 0 2px' }}>
                      Nearest stone {row.distM}m away
                      {row.nearest.inscription_text ? ` · "${row.nearest.inscription_text.slice(0, 50)}…"` : ''}
                    </p>
                  )}
                  {(row.props.notes || row.props.condition) && (
                    <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '4px 0 0', fontStyle: 'italic' }}>
                      {[row.props.condition, row.props.notes].filter(Boolean).join(' — ')}
                    </p>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  {row.nearest && ['replace', 'keep'].map(t => (
                    <button key={t} onClick={() => setOverride(row.i, t)}
                      style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, cursor: 'pointer',
                        background: act.type === t ? 'var(--color-background-tertiary)' : 'transparent',
                        color: act.type === t ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                        border: `0.5px solid ${act.type === t ? 'var(--color-border-secondary)' : 'var(--color-border-tertiary)'}` }}>
                      {t}
                    </button>
                  ))}
                  {!row.nearest && (
                    <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>no match</span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: 'var(--color-background-secondary)', padding: '12px 16px', borderTop: '0.5px solid var(--color-border-secondary)' }}>
        <div style={{ maxWidth: 740, margin: '0 auto' }}>
          <button onClick={handleCommit} disabled={saving}
            style={{ width: '100%', padding: 12, fontSize: 14, fontWeight: 600 }}>
            {saving ? 'Saving…' : `Commit ${rows.length} waypoints to database`}
          </button>
        </div>
      </div>
    </div>
  )

  // ── Done ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-background-primary)', color: 'var(--color-text-primary)', paddingBottom: 60 }}>
      <Header title="GPS Import" subtitle="Complete" onBack={onBack} />
      <div style={{ maxWidth: 600, margin: '40px auto', padding: '0 16px' }}>
        <div style={{ background: 'var(--color-background-secondary)', borderRadius: 'var(--border-radius-md)', padding: 24, border: '0.5px solid var(--color-border-success)' }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-success)', margin: '0 0 16px' }}>Import complete</p>
          <Row label="New stones created" value={results?.created} />
          <Row label="Coordinates updated" value={results?.replaced} />
          <Row label="Kept existing GPS" value={results?.kept} />
          {results?.failed > 0 && <Row label="Failed" value={results?.failed} danger />}
        </div>
        <button onClick={onBack} style={{ width: '100%', padding: 12, fontSize: 14, marginTop: 16 }}>
          Back to Admin
        </button>
      </div>
    </div>
  )
}

function Header({ title, subtitle, onBack }) {
  return (
    <div style={{ background: 'var(--color-background-secondary)', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '0.5px solid var(--color-border-secondary)' }}>
      <div>
        <p style={{ fontWeight: 700, fontSize: 16, margin: 0, color: 'var(--color-text-success)' }}>{title}</p>
        <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', margin: 0 }}>{subtitle}</p>
      </div>
      <button onClick={onBack} style={{ fontSize: 13, color: 'var(--color-text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}>← Admin</button>
    </div>
  )
}

function Chip({ label, value, color }) {
  return (
    <div style={{ background: 'var(--color-background-secondary)', border: '0.5px solid var(--color-border-tertiary)', borderRadius: 'var(--border-radius-sm)', padding: '6px 12px' }}>
      <span style={{ fontSize: 20, fontWeight: 700, color }}>{value}</span>
      <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginLeft: 6 }}>{label}</span>
    </div>
  )
}

function Row({ label, value, danger }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
      <span style={{ fontSize: 13, color: danger ? 'var(--color-text-danger)' : 'var(--color-text-secondary)' }}>{label}</span>
      <strong style={{ fontSize: 13, color: danger ? 'var(--color-text-danger)' : 'var(--color-text-primary)' }}>{value}</strong>
    </div>
  )
}
