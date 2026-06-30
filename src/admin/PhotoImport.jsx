import { useState, useCallback } from 'react'
import { supabase } from '../supabaseClient'
import { CEMETERY_ID } from '../constants'

const PHOTO_BUCKET = 'gravestone-photos'
const MATCH_RADIUS_M = 20
const AUTO_REPLACE_M = 3

function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180
  const Δφ = (lat2 - lat1) * Math.PI / 180, Δλ = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function computeGpsAction(newAcc, nearest) {
  if (!nearest) return { type: 'new', label: 'New stone' }
  const existingAcc = nearest.gps_accuracy_m ?? 999
  if (newAcc != null && newAcc <= AUTO_REPLACE_M)
    return { type: 'replace', label: `Replace — high confidence (${newAcc}m)`, stoneId: nearest.stone_id }
  if (newAcc != null && newAcc < existingAcc)
    return { type: 'replace', label: `Replace — better GPS (${newAcc}m vs ${existingAcc}m)`, stoneId: nearest.stone_id }
  if (newAcc != null && newAcc >= existingAcc)
    return { type: 'keep', label: `Keep existing GPS (${existingAcc}m vs ${newAcc}m)`, stoneId: nearest.stone_id }
  return { type: 'replace', label: 'Replace — no accuracy data', stoneId: nearest.stone_id }
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

function SummaryRow({ label, value, danger }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
      <span style={{ fontSize: 13, color: danger ? 'var(--color-text-danger)' : 'var(--color-text-secondary)' }}>{label}</span>
      <strong style={{ fontSize: 13, color: danger ? 'var(--color-text-danger)' : 'var(--color-text-primary)' }}>{value}</strong>
    </div>
  )
}

export default function PhotoImport({ onBack }) {
  const [phase, setPhase] = useState('upload')
  const [geojsonFile, setGeojsonFile] = useState(null)
  const [photoFiles, setPhotoFiles] = useState([])
  const [rows, setRows] = useState([])
  const [saveProgress, setSaveProgress] = useState({ done: 0, total: 0 })
  const [results, setResults] = useState(null)
  const [error, setError] = useState(null)
  const [parsing, setParsing] = useState(false)

  const handleParse = useCallback(async () => {
    if (!geojsonFile) { setError('Upload a GeoJSON file first'); return }
    setParsing(true)
    setError(null)
    try {
      const text = await geojsonFile.text()
      const geojson = JSON.parse(text)
      if (geojson.type !== 'FeatureCollection') throw new Error('File must be a GeoJSON FeatureCollection')
      // Skip features with no Photo and no Notes (un-photographed placeholder targets)
      const feats = geojson.features.filter(f =>
        f.geometry?.type === 'Point' && (f.properties?.Photo || f.properties?.Notes)
      )
      if (!feats.length) throw new Error('No Point features with photos or notes found')

      const photoByName = {}
      for (const f of photoFiles) photoByName[f.name] = f

      const { data: existing, error: rpcErr } = await supabase.rpc('get_stones_with_coordinates')
      if (rpcErr) throw new Error('Could not load existing stones: ' + rpcErr.message)

      const enriched = feats.map((f, i) => {
        const [lng, lat] = f.geometry.coordinates
        const props = f.properties || {}
        const newAcc = props.accuracy != null ? parseFloat(props.accuracy) : null

        let nearest = null, nearestDist = Infinity
        for (const s of (existing || [])) {
          if (s.lat == null || s.lng == null) continue
          const d = haversineM(lat, lng, s.lat, s.lng)
          if (d < nearestDist) { nearestDist = d; nearest = s }
        }
        if (nearestDist > MATCH_RADIUS_M) nearest = null
        const distM = nearest ? Math.round(nearestDist) : null
        const gpsAction = computeGpsAction(newAcc, nearest)

        // props.Photo is like "files/seaview-stones_20260615143022123_image_0001.jpg"
        let photoFile = null, photoFilename = null
        const rawPhoto = props.Photo
        if (rawPhoto && typeof rawPhoto === 'string' && rawPhoto.trim()) {
          photoFilename = rawPhoto.split(/[/\\]/).pop()
          photoFile = photoByName[photoFilename] || null
        }
        const previewUrl = photoFile ? URL.createObjectURL(photoFile) : null

        return {
          i, lat, lng, newAcc, props, nearest, distM,
          gpsAction, gpsOverride: null,
          photoFile, photoFilename, previewUrl,
          hasPhoto: !!photoFile,
          photoMissing: !!(rawPhoto && !photoFile),
        }
      })

      setRows(enriched)
      setPhase('review')
    } catch (err) {
      setError(err.message)
    }
    setParsing(false)
  }, [geojsonFile, photoFiles])

  const effectiveGpsAction = (row) => {
    if (!row.gpsOverride) return row.gpsAction
    if (row.gpsOverride === 'new') return { type: 'new', label: 'New stone (overridden)' }
    if (row.gpsOverride === 'replace') return { type: 'replace', label: 'Replace GPS (overridden)', stoneId: row.nearest?.stone_id }
    return { type: 'keep', label: 'Keep GPS (overridden)', stoneId: row.nearest?.stone_id }
  }

  const setGpsOverride = (i, type) =>
    setRows(prev => prev.map(r => r.i !== i ? r : {
      ...r, gpsOverride: type === effectiveGpsAction(r).type ? null : type
    }))

  const handleCommit = async () => {
    setPhase('saving')
    setError(null)
    const total = rows.length
    let gpsCreated = 0, gpsReplaced = 0, gpsKept = 0
    let photosUploaded = 0, photosSkipped = 0, photosFailed = 0, gpsFailed = 0

    for (let idx = 0; idx < rows.length; idx++) {
      const row = rows[idx]
      setSaveProgress({ done: idx, total })
      const act = effectiveGpsAction(row)
      const locationStr = `SRID=4326;POINT(${row.lng} ${row.lat})`
      const conditionNotes = row.props.Condition || null
      const fieldNotes = row.props.Notes || null

      let stoneId = null

      try {
        if (act.type === 'new') {
          const { data, error } = await supabase.from('stones').insert({
            cemetery_id: CEMETERY_ID,
            location: locationStr,
            gps_accuracy_m: row.newAcc,
            condition_notes: conditionNotes,
            field_notes: fieldNotes,
            field_status: row.hasPhoto ? 'photographed' : 'needs_review',
          }).select('stone_id').single()
          if (error) throw error
          stoneId = data.stone_id
          gpsCreated++
        } else if (act.type === 'replace') {
          stoneId = act.stoneId
          const { error } = await supabase.from('stones').update({
            location: locationStr,
            gps_accuracy_m: row.newAcc,
            ...(conditionNotes && { condition_notes: conditionNotes }),
            ...(fieldNotes && { field_notes: fieldNotes }),
            ...(row.hasPhoto && { field_status: 'photographed' }),
          }).eq('stone_id', stoneId)
          if (error) throw error
          gpsReplaced++
        } else {
          stoneId = act.stoneId || row.nearest?.stone_id
          if (stoneId) {
            await supabase.from('stones').update({
              ...(conditionNotes && { condition_notes: conditionNotes }),
              ...(fieldNotes && { field_notes: fieldNotes }),
              ...(row.hasPhoto && { field_status: 'photographed' }),
            }).eq('stone_id', stoneId)
          }
          gpsKept++
        }
      } catch (err) {
        console.error('GPS row', row.i, err.message)
        gpsFailed++
        continue
      }

      if (row.photoFile && stoneId) {
        try {
          const path = `${stoneId}/${row.photoFilename}`
          const { error: upErr } = await supabase.storage
            .from(PHOTO_BUCKET)
            .upload(path, row.photoFile, { contentType: 'image/jpeg', upsert: false })

          if (upErr) {
            // 409 / "already exists" means this photo was imported previously — not a real error
            const msg = upErr.message?.toLowerCase() || ''
            if (msg.includes('already exists') || upErr.statusCode === 409 || upErr.error === 'Duplicate') {
              photosSkipped++
            } else {
              throw upErr
            }
          } else {
            const { data: { publicUrl } } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path)
            const { count } = await supabase
              .from('stone_photos')
              .select('*', { count: 'exact', head: true })
              .eq('stone_id', stoneId)
            await supabase.from('stone_photos').insert({
              stone_id: stoneId,
              photo_url: publicUrl,
              is_primary: count === 0,
            })
            photosUploaded++
          }
        } catch (err) {
          console.error('Photo row', row.i, err.message)
          photosFailed++
        }
      }
    }

    setSaveProgress({ done: total, total })
    setResults({ gpsCreated, gpsReplaced, gpsKept, gpsFailed, photosUploaded, photosSkipped, photosFailed })
    setPhase('done')
  }

  const downloadStatusLayer = async () => {
    try {
      const [{ data: photoedData }, { data: stones }] = await Promise.all([
        supabase.from('stone_photos').select('stone_id'),
        supabase.rpc('get_stones_with_coordinates'),
      ])
      const photoedIds = new Set((photoedData || []).map(r => r.stone_id))
      const features = (stones || [])
        .filter(s => photoedIds.has(s.stone_id) && s.lat != null && s.lng != null)
        .map(s => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
          properties: { stone_id: s.stone_id, status: 'photographed' },
        }))
      const blob = new Blob(
        [JSON.stringify({ type: 'FeatureCollection', features }, null, 2)],
        { type: 'application/json' }
      )
      const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(blob),
        download: 'seaview_photographed.geojson',
      })
      a.click()
      URL.revokeObjectURL(a.href)
    } catch (err) {
      alert('Export failed: ' + err.message)
    }
  }

  const resetTool = () => {
    setGeojsonFile(null)
    setPhotoFiles([])
    setRows([])
    setResults(null)
    setError(null)
    setPhase('upload')
  }

  const gpsCount = rows.reduce((acc, r) => {
    const t = effectiveGpsAction(r).type; acc[t] = (acc[t] || 0) + 1; return acc
  }, {})
  const photoCount = rows.filter(r => r.hasPhoto).length
  const photoMissingCount = rows.filter(r => r.photoMissing).length

  // ── Upload ────────────────────────────────────────────────────────────────
  if (phase === 'upload') return (
    <div style={{ minHeight: '100vh', background: 'var(--color-background-primary)', color: 'var(--color-text-primary)', paddingBottom: 60 }}>
      <Header title="QField Photo Import" subtitle="Import photos and GPS from a field session" onBack={onBack} />
      <div style={{ maxWidth: 600, margin: '0 auto', padding: '24px 16px' }}>

        <div style={{ background: 'var(--color-background-secondary)', borderRadius: 'var(--border-radius-md)', padding: 20, border: '0.5px solid var(--color-border-tertiary)', marginBottom: 14 }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: 0.8 }}>Step 1 — GeoJSON export</p>
          <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', margin: '0 0 12px', lineHeight: 1.6 }}>
            In QGIS: right-click <strong>seaview_stones</strong> → Export → Save Features As → Format: GeoJSON → OK.
            The photo attribute from QField is embedded in this export.
          </p>
          <input type="file" accept=".geojson,.json"
            onChange={e => { setGeojsonFile(e.target.files[0] || null); setError(null) }}
            style={{ fontSize: 13, color: 'var(--color-text-primary)' }} />
          {geojsonFile && (
            <p style={{ fontSize: 11, color: 'var(--color-text-success)', margin: '8px 0 0' }}>✓ {geojsonFile.name}</p>
          )}
        </div>

        <div style={{ background: 'var(--color-background-secondary)', borderRadius: 'var(--border-radius-md)', padding: 20, border: '0.5px solid var(--color-border-tertiary)', marginBottom: 14 }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: 0.8 }}>Step 2 — Photos (optional)</p>
          <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', margin: '0 0 12px', lineHeight: 1.6 }}>
            Navigate to{' '}
            <code style={{ fontSize: 11, color: 'var(--color-text-primary)', background: 'var(--color-background-primary)', padding: '1px 5px', borderRadius: 3 }}>
              QField\cloud\granite-graph\files\
            </code>{' '}
            and select all JPEGs from this session. Leave empty for a GPS-only import.
          </p>
          <input type="file" accept="image/jpeg,.jpg" multiple
            onChange={e => setPhotoFiles(Array.from(e.target.files))}
            style={{ fontSize: 13, color: 'var(--color-text-primary)' }} />
          {photoFiles.length > 0 && (
            <p style={{ fontSize: 11, color: 'var(--color-text-success)', margin: '8px 0 0' }}>✓ {photoFiles.length} photo{photoFiles.length !== 1 ? 's' : ''} selected</p>
          )}
        </div>

        <div style={{ background: 'var(--color-background-secondary)', borderRadius: 'var(--border-radius-md)', padding: '12px 16px', border: '0.5px solid var(--color-border-tertiary)', marginBottom: 16 }}>
          <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: 1 }}>GPS replacement rules</p>
          {[
            [`New accuracy ≤ ${AUTO_REPLACE_M}m`, 'Always replace'],
            ['New accuracy < existing', 'Replace — demonstrably better'],
            ['New accuracy ≥ existing', 'Keep existing (overridable in review)'],
            [`No match within ${MATCH_RADIUS_M}m`, 'Create new stone record'],
          ].map(([cond, action]) => (
            <div key={cond} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{cond}</span>
              <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{action}</span>
            </div>
          ))}
        </div>

        {error && <p style={{ fontSize: 12, color: 'var(--color-text-danger)', marginBottom: 12 }}>{error}</p>}

        <button onClick={handleParse} disabled={!geojsonFile || parsing}
          style={{ width: '100%', padding: 13, fontSize: 14, fontWeight: 600 }}>
          {parsing ? 'Loading…' : 'Preview Import'}
        </button>
      </div>
    </div>
  )

  // ── Review ────────────────────────────────────────────────────────────────
  if (phase === 'review') return (
    <div style={{ minHeight: '100vh', background: 'var(--color-background-primary)', color: 'var(--color-text-primary)', paddingBottom: 80 }}>
      <Header title="QField Photo Import" subtitle={`${rows.length} features — review before committing`} onBack={() => setPhase('upload')} />
      <div style={{ maxWidth: 740, margin: '0 auto', padding: '16px 16px 0' }}>

        <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          <Chip label="New stones" value={gpsCount.new || 0} color="var(--color-text-success)" />
          <Chip label="GPS updated" value={gpsCount.replace || 0} color="var(--color-text-info)" />
          <Chip label="GPS kept" value={gpsCount.keep || 0} color="var(--color-text-tertiary)" />
          <Chip label="Photos" value={photoCount} color="var(--color-text-warning)" />
          {photoMissingCount > 0 && (
            <Chip label="Missing files" value={photoMissingCount} color="var(--color-text-danger)" />
          )}
        </div>

        {photoMissingCount > 0 && (
          <div style={{ background: 'rgba(239,68,68,0.08)', border: '0.5px solid var(--color-border-danger)', borderRadius: 'var(--border-radius-md)', padding: '10px 14px', marginBottom: 14, fontSize: 12, color: 'var(--color-text-danger)', lineHeight: 1.5 }}>
            {photoMissingCount} feature{photoMissingCount !== 1 ? 's' : ''} reference a photo in QField but the file wasn't selected. Those stones will be GPS-only — commit anyway or go back and add the photos.
          </div>
        )}

        {rows.map(row => {
          const act = effectiveGpsAction(row)
          const gpsColor = act.type === 'new' ? 'var(--color-text-success)'
            : act.type === 'replace' ? 'var(--color-text-info)'
            : 'var(--color-text-tertiary)'

          return (
            <div key={row.i} style={{ display: 'flex', gap: 10, padding: '10px 12px', borderRadius: 'var(--border-radius-md)', border: '0.5px solid var(--color-border-tertiary)', background: 'var(--color-background-secondary)', marginBottom: 8 }}>
              <div style={{ width: 64, height: 64, flexShrink: 0, borderRadius: 6, overflow: 'hidden', background: 'var(--color-background-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {row.previewUrl
                  ? <img src={row.previewUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : row.photoMissing
                  ? <span style={{ fontSize: 9, color: 'var(--color-text-danger)', textAlign: 'center', padding: 2, lineHeight: 1.3 }}>file missing</span>
                  : <span style={{ fontSize: 22, color: 'var(--color-text-tertiary)' }}>📍</span>}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 3, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: gpsColor }}>{act.label}</span>
                  {row.hasPhoto && (
                    <span style={{ fontSize: 10, color: 'var(--color-text-warning)', border: '0.5px solid var(--color-border-warning)', borderRadius: 3, padding: '0 4px' }}>photo</span>
                  )}
                </div>
                <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '0 0 2px', fontFamily: 'monospace' }}>
                  {row.lat.toFixed(6)}, {row.lng.toFixed(6)}{row.newAcc != null ? ` · ±${row.newAcc}m` : ''}
                </p>
                {row.nearest && (
                  <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '0 0 2px' }}>
                    Nearest: {row.distM}m
                    {row.nearest.inscription_text ? ` · "${row.nearest.inscription_text.slice(0, 40)}…"` : ''}
                  </p>
                )}
                {(row.props.Notes || row.props.Condition) && (
                  <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '3px 0 0', fontStyle: 'italic' }}>
                    {[row.props.Condition, row.props.Notes].filter(Boolean).join(' — ')}
                  </p>
                )}
              </div>

              {row.nearest && (
                <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignSelf: 'center' }}>
                  {['replace', 'keep'].map(t => (
                    <button key={t} onClick={() => setGpsOverride(row.i, t)}
                      style={{ fontSize: 10, padding: '3px 7px', borderRadius: 4, cursor: 'pointer',
                        background: act.type === t ? 'var(--color-background-tertiary)' : 'transparent',
                        color: act.type === t ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                        border: `0.5px solid ${act.type === t ? 'var(--color-border-secondary)' : 'var(--color-border-tertiary)'}` }}>
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: 'var(--color-background-secondary)', padding: '12px 16px', borderTop: '0.5px solid var(--color-border-secondary)' }}>
        <div style={{ maxWidth: 740, margin: '0 auto' }}>
          <button onClick={handleCommit}
            style={{ width: '100%', padding: 12, fontSize: 14, fontWeight: 600 }}>
            Commit {rows.length} waypoints{photoCount > 0 ? ` + ${photoCount} photos` : ''}
          </button>
        </div>
      </div>
    </div>
  )

  // ── Saving ────────────────────────────────────────────────────────────────
  if (phase === 'saving') return (
    <div style={{ minHeight: '100vh', background: 'var(--color-background-primary)', color: 'var(--color-text-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', padding: 24 }}>
        <p style={{ fontSize: 16, fontWeight: 600, margin: '0 0 8px' }}>Uploading photos…</p>
        <p style={{ fontSize: 13, color: 'var(--color-text-tertiary)', margin: '0 0 20px' }}>
          {saveProgress.done} / {saveProgress.total} features
        </p>
        <div style={{ width: 280, height: 4, background: 'var(--color-background-tertiary)', borderRadius: 2, overflow: 'hidden', margin: '0 auto' }}>
          <div style={{
            height: '100%',
            background: 'var(--color-text-success)',
            width: `${saveProgress.total ? (saveProgress.done / saveProgress.total) * 100 : 0}%`,
            transition: 'width 0.3s',
          }} />
        </div>
        <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 12 }}>
          This may take a minute — uploading {rows.filter(r => r.hasPhoto).length} photo{rows.filter(r => r.hasPhoto).length !== 1 ? 's' : ''} to Supabase Storage
        </p>
      </div>
    </div>
  )

  // ── Done ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-background-primary)', color: 'var(--color-text-primary)', paddingBottom: 60 }}>
      <Header title="QField Photo Import" subtitle="Session imported" onBack={onBack} />
      <div style={{ maxWidth: 600, margin: '24px auto', padding: '0 16px' }}>

        <div style={{ background: 'var(--color-background-secondary)', borderRadius: 'var(--border-radius-md)', padding: 24, border: '0.5px solid var(--color-border-success)', marginBottom: 16 }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-success)', margin: '0 0 16px' }}>Import complete</p>
          <SummaryRow label="New stones created" value={results?.gpsCreated} />
          <SummaryRow label="GPS coordinates updated" value={results?.gpsReplaced} />
          <SummaryRow label="GPS kept (no change)" value={results?.gpsKept} />
          <SummaryRow label="Photos uploaded to Supabase" value={results?.photosUploaded} />
          {results?.photosSkipped > 0 && <SummaryRow label="Photos skipped (already uploaded)" value={results?.photosSkipped} />}
          {results?.gpsFailed > 0 && <SummaryRow label="GPS errors" value={results?.gpsFailed} danger />}
          {results?.photosFailed > 0 && <SummaryRow label="Photo upload errors" value={results?.photosFailed} danger />}
        </div>

        {/* Status layer download */}
        <div style={{ background: 'var(--color-background-secondary)', borderRadius: 'var(--border-radius-md)', padding: 20, border: '0.5px solid var(--color-border-tertiary)', marginBottom: 16 }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)', margin: '0 0 6px' }}>Update QField status layer</p>
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '0 0 14px', lineHeight: 1.6 }}>
            Download a GeoJSON of all photographed stones from Supabase. In QGIS, add this as a separate layer
            styled as green filled circles — field volunteers will see which stones are already done, even across
            multiple sessions and devices.
          </p>
          <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '0 0 12px', lineHeight: 1.5 }}>
            In QGIS: Layer → Add Layer → Add Vector Layer → select the file. Style as green point. Then re-package
            and push to QFieldCloud before the next mapping session.
          </p>
          <button onClick={downloadStatusLayer}
            style={{ padding: '9px 16px', fontSize: 13, fontWeight: 600, background: 'var(--color-background-info)', color: 'var(--color-text-info)', border: '0.5px solid var(--color-border-info)', borderRadius: 6, cursor: 'pointer' }}>
            Download seaview_photographed.geojson
          </button>
        </div>

        <div style={{ background: 'var(--color-background-secondary)', borderRadius: 'var(--border-radius-md)', padding: '12px 16px', border: '0.5px solid var(--color-border-tertiary)', marginBottom: 16, fontSize: 12, color: 'var(--color-text-tertiary)', lineHeight: 1.6 }}>
          <strong style={{ color: 'var(--color-text-secondary)' }}>Next:</strong> Open <strong style={{ color: 'var(--color-text-secondary)' }}>Stone Photo QA</strong> to run Gemini on the newly uploaded photos and match them to person records.
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onBack}
            style={{ flex: 1, padding: 12, fontSize: 13, background: 'transparent', border: '0.5px solid var(--color-border-secondary)', color: 'var(--color-text-secondary)', borderRadius: 6, cursor: 'pointer' }}>
            ← Admin
          </button>
          <button onClick={resetTool} style={{ flex: 1, padding: 12, fontSize: 13, fontWeight: 600 }}>
            Import Another Session
          </button>
        </div>
      </div>
    </div>
  )
}
