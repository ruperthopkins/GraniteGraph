// src/admin/DuplicateScan.jsx
// Bulk duplicate review queue. Blocks records by last name, scores every
// within-group pair, and presents candidates ≥50 pts for merge or dismissal.

import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { normaliseName, matchScoreDetails, parseDate } from '../utils/nameNorm'
import { mergePersons } from '../utils/mergePersons'

// ── Shared helpers ────────────────────────────────────────────────────────────
const MONTH_ABBR = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function fmtDate(verbatim, parsed) {
  const p = parsed || parseDate(verbatim)
  if (!p) return verbatim || null
  const parts = p.split('-')
  if (parts.length === 3) return `${parseInt(parts[2])} ${MONTH_ABBR[parseInt(parts[1])]} ${parts[0]}`
  if (parts.length === 2) return `${MONTH_ABBR[parseInt(parts[1])]} ${parts[0]}`
  return parts[0]
}

// Always store pair key with lexicographically smaller UUID first
function pairKey(id1, id2) {
  return id1 < id2 ? `${id1}|${id2}` : `${id2}|${id1}`
}

// Fields to fill from secondary onto primary where primary is null/empty
const FILLABLE = [
  'date_of_birth_verbatim', 'date_of_death_verbatim',
  'date_of_birth_parsed', 'date_of_death_parsed',
  'maiden_name', 'biography', 'notes', 'gender',
  'title', 'middle_name', 'church_event_type', 'church_event_date_verbatim',
]
function computeFillOverrides(primary, secondary) {
  const out = {}
  for (const f of FILLABLE) {
    if (!primary[f] && secondary[f]) out[f] = secondary[f]
  }
  return out
}

function completeness(person) {
  return FILLABLE.filter(f => person[f]).length
}

// ── Data loading ──────────────────────────────────────────────────────────────
const SCAN_SELECT = [
  'deceased_id', 'first_name', 'middle_name', 'last_name', 'maiden_name',
  'full_name', 'title', 'biography', 'notes', 'gender',
  'date_of_birth_verbatim', 'date_of_death_verbatim',
  'date_of_birth_parsed', 'date_of_death_parsed',
  'church_event_type', 'church_event_date_verbatim',
].join(',')

async function loadAllRecords() {
  const PAGE = 1000
  let all = [], from = 0
  while (true) {
    const { data, error } = await supabase
      .from('deceased')
      .select(SCAN_SELECT)
      .range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    all = [...all, ...(data || [])]
    if ((data || []).length < PAGE) break
    from += PAGE
  }
  return all
}

function buildPairs(records, dismissedSet) {
  // Group by normalized last name (Levenshtein-aware blocking would be better
  // for spelling variants, but same-name grouping catches the common case)
  const groups = {}
  for (const r of records) {
    const key = normaliseName(r).last_name.toLowerCase()
    if (!key) continue
    ;(groups[key] = groups[key] || []).push(r)
  }

  const pairs = []
  for (const group of Object.values(groups)) {
    if (group.length < 2) continue
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const key = pairKey(group[i].deceased_id, group[j].deceased_id)
        if (dismissedSet.has(key)) continue
        const { score, reasons } = matchScoreDetails(group[i], group[j])
        if (score >= 50) pairs.push({ a: group[i], b: group[j], score, reasons, key })
      }
    }
  }
  return pairs.sort((x, y) => y.score - x.score)
}

// ── Sub-components ────────────────────────────────────────────────────────────
function ScoreBadge({ score }) {
  const [color, label] =
    score >= 80 ? ['var(--color-text-success)', 'strong match'] :
    score >= 65 ? ['var(--color-text-warning)', 'likely match'] :
                  ['var(--color-text-secondary)', 'possible match']
  return (
    <span style={{ fontSize: 12, padding: '2px 10px', borderRadius: 99, border: `0.5px solid ${color}`, color, whiteSpace: 'nowrap' }}>
      {score} pts · {label}
    </span>
  )
}

function PersonCard({ person, label, isChosen, onChoose }) {
  const displayName = [person.title, person.first_name, person.middle_name, person.last_name]
    .filter(Boolean).join(' ') || person.full_name || '(unnamed)'
  const score = completeness(person)

  return (
    <div style={{
      flex: 1, minWidth: 0, padding: '12px 14px',
      borderRadius: 'var(--border-radius-md)',
      border: isChosen ? '1.5px solid var(--color-border-success)' : '0.5px solid var(--color-border-tertiary)',
      background: isChosen ? 'var(--color-background-success)' : 'var(--color-background-secondary)',
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p style={{ fontSize: 10, color: 'var(--color-text-tertiary)', margin: 0, textTransform: 'uppercase', letterSpacing: 1 }}>{label}</p>
        <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>{score} field{score !== 1 ? 's' : ''}</span>
      </div>
      <p style={{ fontWeight: 600, fontSize: 14, margin: 0 }}>{displayName}</p>
      {person.maiden_name && <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: 0 }}>nee {person.maiden_name}</p>}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 2 }}>
        {person.date_of_birth_verbatim && <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>b. {fmtDate(person.date_of_birth_verbatim, person.date_of_birth_parsed)}</span>}
        {person.date_of_death_verbatim && <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>d. {fmtDate(person.date_of_death_verbatim, person.date_of_death_parsed)}</span>}
      </div>
      {person.church_event_type && (
        <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', margin: 0 }}>
          {person.church_event_type}{person.church_event_date_verbatim ? ` · ${fmtDate(person.church_event_date_verbatim)}` : ''}
        </p>
      )}
      {person.biography && (
        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: 0, fontStyle: 'italic' }}>
          {person.biography.length > 120 ? person.biography.slice(0, 120) + '…' : person.biography}
        </p>
      )}
      <button
        onClick={onChoose}
        style={{
          marginTop: 6, fontSize: 12, padding: '4px 10px', alignSelf: 'flex-start',
          borderRadius: 'var(--border-radius-sm)', cursor: 'pointer',
          background: isChosen ? 'var(--color-background-success-strong)' : 'var(--color-background-tertiary)',
          color: isChosen ? 'var(--color-text-success)' : 'var(--color-text-secondary)',
          border: `0.5px solid ${isChosen ? 'var(--color-border-success)' : 'var(--color-border-secondary)'}`,
        }}
      >
        {isChosen ? '✓ Primary' : 'Keep as primary'}
      </button>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function DuplicateScan({ onBack }) {
  const [phase, setPhase] = useState('idle') // idle | loading | reviewing | done
  const [pairs, setPairs] = useState([])
  const [idx, setIdx] = useState(0)
  const [stats, setStats] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [primaryId, setPrimaryId] = useState(null)
  const [merging, setMerging] = useState(false)
  const [mergeLog, setMergeLog] = useState(null)
  const [sessionMerged, setSessionMerged] = useState(0)
  const [sessionDismissed, setSessionDismissed] = useState(0)

  // Transition to done when queue is exhausted
  useEffect(() => {
    if (phase === 'reviewing' && pairs.length > 0 && idx >= pairs.length) {
      setPhase('done')
    }
  }, [pairs.length, idx, phase])

  const startScan = async () => {
    setPhase('loading')
    setLoadError(null)
    setPairs([])
    setIdx(0)
    setPrimaryId(null)
    setMergeLog(null)
    setSessionMerged(0)
    setSessionDismissed(0)

    try {
      const [records, { data: dismissedRows, error: de }] = await Promise.all([
        loadAllRecords(),
        supabase.from('dismissed_duplicate_pairs').select('deceased_id_a,deceased_id_b'),
      ])
      if (de) throw new Error(de.message)

      const dismissedSet = new Set((dismissedRows || []).map(r => pairKey(r.deceased_id_a, r.deceased_id_b)))
      const found = buildPairs(records, dismissedSet)
      setStats({ total: records.length, alreadyDismissed: dismissedRows?.length ?? 0, found: found.length })
      setPairs(found)
      setPhase(found.length > 0 ? 'reviewing' : 'done')
    } catch (err) {
      setLoadError(err.message)
      setPhase('idle')
    }
  }

  const handleDismiss = async () => {
    const pair = pairs[idx]
    const [idA, idB] = pair.key.split('|')
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('dismissed_duplicate_pairs').insert({
      deceased_id_a: idA, deceased_id_b: idB,
      dismissed_by: user?.id ?? null,
      score: pair.score,
    })
    setSessionDismissed(n => n + 1)
    setIdx(i => i + 1)
  }

  const handleMerge = async () => {
    if (!primaryId) return
    setMerging(true)
    const pair = pairs[idx]
    const primary   = pair.a.deceased_id === primaryId ? pair.a : pair.b
    const secondary = pair.a.deceased_id === primaryId ? pair.b : pair.a
    const overrides = computeFillOverrides(primary, secondary)
    const result = await mergePersons(supabase, primary.deceased_id, secondary.deceased_id, overrides)
    if (result.ok) {
      setSessionMerged(n => n + 1)
      const deletedId = secondary.deceased_id
      // Remove the merged pair and any other pairs that referenced the deleted record
      setPairs(prev => prev.filter((p, i) =>
        i !== idx && p.a.deceased_id !== deletedId && p.b.deceased_id !== deletedId
      ))
      // idx now points to the next pair in the filtered array (no increment needed)
    } else {
      alert('Merge failed: ' + result.error)
    }
    setMergeLog(result.log)
    setPrimaryId(null)
    setMerging(false)
  }

  const clearLog = () => { setMergeLog(null); setPrimaryId(null) }

  const pair = phase === 'reviewing' ? pairs[idx] : null

  const fillPreview = pair && primaryId
    ? computeFillOverrides(
        pair.a.deceased_id === primaryId ? pair.a : pair.b,
        pair.a.deceased_id === primaryId ? pair.b : pair.a
      )
    : {}

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-background-primary)', color: 'var(--color-text-primary)', paddingBottom: 60 }}>

      {/* Header */}
      <div style={{ background: 'var(--color-background-secondary)', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '0.5px solid var(--color-border-secondary)' }}>
        <div>
          <p style={{ fontWeight: 700, fontSize: 16, margin: 0, color: 'var(--color-text-success)' }}>Duplicate Scan</p>
          <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', margin: 0 }}>Find and merge duplicate records</p>
        </div>
        <button onClick={onBack} style={{ fontSize: 13, color: 'var(--color-text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}>← Admin</button>
      </div>

      <div style={{ maxWidth: 740, margin: '0 auto', padding: '20px 16px' }}>

        {/* Idle */}
        {phase === 'idle' && (
          <div style={{ textAlign: 'center', paddingTop: 40 }}>
            <p style={{ fontSize: 15, marginBottom: 8 }}>Scan all records for potential duplicates</p>
            <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 24, lineHeight: 1.6, maxWidth: 480, margin: '0 auto 24px' }}>
              Records are grouped by last name, then every pair is scored for name
              similarity, date overlap, and gender. Pairs scoring 50 + are queued
              for review — highest confidence first.
            </p>
            {loadError && <p style={{ color: 'var(--color-text-danger)', marginBottom: 12, fontSize: 13 }}>{loadError}</p>}
            <button onClick={startScan}>Start scan</button>
          </div>
        )}

        {/* Loading */}
        {phase === 'loading' && (
          <p style={{ textAlign: 'center', paddingTop: 60, color: 'var(--color-text-secondary)', fontSize: 14 }}>
            Loading records and scoring pairs…
          </p>
        )}

        {/* Done */}
        {phase === 'done' && (
          <div style={{ textAlign: 'center', paddingTop: 40 }}>
            <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Queue complete</p>
            {stats && (
              <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 6 }}>
                {stats.total} records scanned · {stats.found} pairs found above threshold
              </p>
            )}
            <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 28 }}>
              This session: {sessionMerged} merged · {sessionDismissed} dismissed as not duplicate
            </p>
            <button onClick={startScan}>Scan again</button>
          </div>
        )}

        {/* Reviewing */}
        {phase === 'reviewing' && pair && (
          <div>

            {/* Progress bar + score */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: 0 }}>
                {idx + 1} / {pairs.length} · {sessionMerged} merged · {sessionDismissed} dismissed
              </p>
              <ScoreBadge score={pair.score} />
            </div>
            <div style={{ height: 3, background: 'var(--color-background-tertiary)', borderRadius: 99, marginBottom: 16 }}>
              <div style={{ height: '100%', borderRadius: 99, background: 'var(--color-border-success)', width: `${((idx) / pairs.length) * 100}%`, transition: 'width 0.3s' }} />
            </div>

            {/* Score reasons */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
              {pair.reasons.map((r, i) => (
                <span key={i} style={{
                  fontSize: 11, padding: '2px 8px', borderRadius: 99,
                  background: 'var(--color-background-secondary)',
                  border: `0.5px solid ${r.points < 0 ? 'var(--color-border-danger)' : 'var(--color-border-tertiary)'}`,
                  color: r.points < 0 ? 'var(--color-text-danger)' : 'var(--color-text-secondary)',
                }}>
                  {r.label}: {r.detail} {r.points > 0 ? `+${r.points}` : r.points}
                </span>
              ))}
            </div>

            {/* Side-by-side cards */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'flex-start' }}>
              <PersonCard
                person={pair.a} label="Record A"
                isChosen={primaryId === pair.a.deceased_id}
                onChoose={() => { setPrimaryId(pair.a.deceased_id); setMergeLog(null) }}
              />
              <PersonCard
                person={pair.b} label="Record B"
                isChosen={primaryId === pair.b.deceased_id}
                onChoose={() => { setPrimaryId(pair.b.deceased_id); setMergeLog(null) }}
              />
            </div>

            {/* Fill-from-secondary preview */}
            {primaryId && !mergeLog && Object.keys(fillPreview).length > 0 && (
              <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 12 }}>
                Will fill blank fields from secondary:{' '}
                {Object.entries(fillPreview).map(([k, v]) => `${k.replace(/_/g, ' ')} → "${v}"`).join(', ')}
              </p>
            )}

            {/* Merge log */}
            {mergeLog && (
              <div style={{ background: 'var(--color-background-secondary)', borderRadius: 'var(--border-radius-md)', padding: '10px 14px', marginBottom: 14 }}>
                <p style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, margin: '0 0 4px' }}>
                  {mergeLog.some(l => l.startsWith('Deleted')) ? 'Merge complete' : 'Merge failed'}
                </p>
                {mergeLog.slice(0, 6).map((line, i) => (
                  <p key={i} style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '1px 0', fontFamily: 'var(--font-mono)' }}>{line}</p>
                ))}
                {mergeLog.length > 6 && <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '1px 0' }}>…{mergeLog.length - 6} more</p>}
                <button onClick={clearLog} style={{ marginTop: 8, fontSize: 12 }}>Next pair →</button>
              </div>
            )}

            {/* Actions */}
            {!mergeLog && (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button
                  onClick={handleMerge}
                  disabled={!primaryId || merging}
                  style={{ opacity: primaryId ? 1 : 0.35 }}
                >
                  {merging ? 'Merging…' : primaryId ? 'Merge →' : 'Merge (choose primary first)'}
                </button>
                <button
                  onClick={handleDismiss}
                  style={{ background: 'var(--color-background-secondary)', color: 'var(--color-text-secondary)' }}
                >
                  Not the same person
                </button>
                <button
                  onClick={() => { setPrimaryId(null); setIdx(i => i + 1) }}
                  style={{ background: 'none', color: 'var(--color-text-tertiary)', border: '0.5px solid var(--color-border-tertiary)' }}
                >
                  Skip
                </button>
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  )
}
