// src/admin/WhiteImport.jsx
// Granite Graph — Willis H. White Genealogy Importer
// Processes JPG page scans via Claude vision; generates idempotent SQL using white_ref.
// Supports any White genealogy book by setting the book key at the start of each session.

import { useState, useRef } from 'react'
import { CEMETERY_ID, SOURCE_IDS } from '../constants'

// Known White genealogy volumes — each maps to its own source record in the DB
const WHITE_BOOKS = [
  {
    key:      'Tillotson_2008',
    sourceId: SOURCE_IDS.WHITE_TILLOTSON_2008,
    title:    'The Tillotson Family, Long Island Cordwood and the Decline of East Coast Sail',
    author:   'Willis H. White',
    year:     '2008',
  },
  {
    key:      'Tillotson_2001',
    sourceId: SOURCE_IDS.WHITE_TILLOTSON_2001,
    title:    'The Tillotson Family of Long Island, NY: Three Generations of the Descendants of Samuel Tillotson',
    author:   'Willis H. White',
    year:     '2001',
  },
  {
    key:      'Miller_2007',
    sourceId: SOURCE_IDS.WHITE_MILLER_2007,
    title:    'The Ancestry of Alila May Miller (1881–1960) of Miller Place, Long Island, New York',
    author:   'Willis H. White',
    year:     '2007',
  },
]

// ── SQL helpers ───────────────────────────────────────────────────────────────

const esc = (s) => (s || '').replace(/'/g, "''")
const q   = (s) => (s != null && s !== '') ? `'${esc(String(s))}'` : 'NULL'

const updateCols = [
  'first_name', 'middle_name', 'last_name', 'maiden_name', 'gender',
  'date_of_birth_verbatim', 'date_of_death_verbatim',
  'date_of_birth_year', 'date_of_death_year',
  'date_of_birth_parsed', 'date_of_death_parsed', 'notes',
]

function personUpsert(r, sourceId) {
  const setClauses = updateCols.map(c => `  ${c} = COALESCE(deceased.${c}, EXCLUDED.${c})`).join(',\n')
  const displayName = r.full_name || [r.first_name, r.last_name].filter(Boolean).join(' ')
  return (
    `-- ${displayName} (${r.white_ref})\n` +
    `INSERT INTO deceased (\n` +
    `  first_name, middle_name, last_name, maiden_name, gender,\n` +
    `  cemetery_id, source_id, white_ref,\n` +
    `  date_of_birth_verbatim, date_of_death_verbatim,\n` +
    `  date_of_birth_year, date_of_death_year,\n` +
    `  date_of_birth_parsed, date_of_death_parsed, notes)\n` +
    `VALUES (\n` +
    `  ${q(r.first_name)}, ${q(r.middle_name)}, ${q(r.last_name)}, ${q(r.maiden_name)}, ${q(r.gender)},\n` +
    `  '${CEMETERY_ID}', '${sourceId}', ${q(r.white_ref)},\n` +
    `  ${q(r.date_of_birth_verbatim)}, ${q(r.date_of_death_verbatim)},\n` +
    `  ${r.date_of_birth_year ?? 'NULL'}, ${r.date_of_death_year ?? 'NULL'},\n` +
    `  _parse_hist_date(${q(r.date_of_birth_verbatim)}), _parse_hist_date(${q(r.date_of_death_verbatim)}), ${q(r.notes)})\n` +
    `ON CONFLICT (white_ref) WHERE white_ref IS NOT NULL DO UPDATE SET\n${setClauses};\n` +
    `INSERT INTO deceased_sources (\n` +
    `  deceased_id, source_id, source_type,\n` +
    `  date_of_birth_verbatim, date_of_death_verbatim,\n` +
    `  date_of_birth_year, date_of_death_year, notes)\n` +
    `SELECT deceased_id, '${sourceId}', 'family_record',\n` +
    `  ${q(r.date_of_birth_verbatim)}, ${q(r.date_of_death_verbatim)},\n` +
    `  ${r.date_of_birth_year ?? 'NULL'}, ${r.date_of_death_year ?? 'NULL'}, ${q(r.notes)}\n` +
    `FROM deceased WHERE white_ref = ${q(r.white_ref)}\nON CONFLICT DO NOTHING;`
  )
}

const inverseRel = { SPOUSE: 'SPOUSE', PARENT_OF: 'CHILD_OF', CHILD_OF: 'PARENT_OF', SIBLING_OF: 'SIBLING_OF' }
const toDbRel = (r) => r.toLowerCase().replace('_of', '')

function kinshipPair(refA, refB, relType, evidence, sourceId) {
  const inv = inverseRel[relType]
  const dbRel = toDbRel(relType)
  const dbInv = toDbRel(inv)
  const ev = q(evidence || null)
  const src = `'${sourceId}'`
  return (
    `INSERT INTO kinship (primary_deceased_id, relative_deceased_id, relationship_type, source, confidence, notes, source_id)\n` +
    `SELECT a.deceased_id, b.deceased_id, '${dbRel}', 'family_record', 'confirmed', ${ev}, ${src}\n` +
    `FROM deceased a, deceased b WHERE a.white_ref = ${q(refA)} AND b.white_ref = ${q(refB)}\n` +
    `ON CONFLICT DO NOTHING;\n` +
    `INSERT INTO kinship (primary_deceased_id, relative_deceased_id, relationship_type, source, confidence, notes, source_id)\n` +
    `SELECT b.deceased_id, a.deceased_id, '${dbInv}', 'family_record', 'confirmed', ${ev}, ${src}\n` +
    `FROM deceased a, deceased b WHERE a.white_ref = ${q(refA)} AND b.white_ref = ${q(refB)}\n` +
    `ON CONFLICT DO NOTHING;`
  )
}

function genSQL(allSections, bookKey, bookTitle, sourceId) {
  if (!allSections.length) return ''
  const today = new Date().toISOString().split('T')[0]
  const lines = [
    `-- White genealogy import: ${bookTitle}`,
    `-- Book key: ${bookKey}`,
    `-- Generated: ${today}`,
    `-- Source ID: ${sourceId}`,
    `-- Idempotent: safe to re-run`,
    ``,
    `-- ── PREREQUISITE MIGRATIONS (run once if not already done) ──────────────────`,
    `-- ALTER TABLE deceased ADD COLUMN IF NOT EXISTS white_ref TEXT UNIQUE;`,
    `-- CREATE INDEX IF NOT EXISTS deceased_white_ref_idx ON deceased(white_ref) WHERE white_ref IS NOT NULL;`,
    `-- Source records are managed via the Supabase sources table.`,
    ``,
    `BEGIN;`,
    ``,
    `-- ── STEP 1: Upsert people ────────────────────────────────────────────────────`,
  ]

  // Deduplicate by white_ref — a "+" child may appear both as a child record and as a section head
  const seen = new Set()
  const upsertPerson = (r) => {
    if (!r.white_ref || r.white_ref.endsWith('_pending')) return
    if (seen.has(r.white_ref)) return
    seen.add(r.white_ref)
    lines.push('', personUpsert(r, sourceId))
  }

  for (const section of allSections) {
    const { head, spouses = [], children = [] } = section
    upsertPerson(head)
    for (const sp of spouses) upsertPerson(sp)
    for (const ch of children) upsertPerson(ch)
  }

  lines.push('', '', `-- ── STEP 2: Insert kinship ──────────────────────────────────────────────────`)

  for (const section of allSections) {
    const { head, spouses = [], children = [] } = section
    if (!head.white_ref) continue
    lines.push('', `-- ${head.first_name} ${head.last_name} (${head.white_ref}) relationships`)
    for (const sp of spouses) {
      if (!sp.white_ref || sp.white_ref.endsWith('_pending')) continue
      lines.push(kinshipPair(head.white_ref, sp.white_ref, 'SPOUSE',
        sp.marriage_date_verbatim ? `married ${sp.marriage_date_verbatim}` : null, sourceId))
    }
    for (const ch of children) {
      if (!ch.white_ref || ch.white_ref.endsWith('_pending')) continue
      lines.push(kinshipPair(head.white_ref, ch.white_ref, 'PARENT_OF',
        `child of ${head.first_name} ${head.last_name}`, sourceId))
      const parentSpouse = spouses[(ch.spouse_seq ?? 1) - 1]
      if (parentSpouse?.white_ref && !parentSpouse.white_ref.endsWith('_pending')) {
        lines.push(kinshipPair(parentSpouse.white_ref, ch.white_ref, 'PARENT_OF',
          `child of ${parentSpouse.first_name} ${parentSpouse.last_name}`, sourceId))
      }
    }
  }

  lines.push('', '', `COMMIT;`)
  return lines.join('\n')
}

// ── Edit helpers ──────────────────────────────────────────────────────────────

function EditText({ value, onChange, placeholder }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value || '')
  const commit = () => { setEditing(false); onChange(draft) }
  if (editing) {
    return (
      <input autoFocus value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') commit() }}
        style={{ background: '#0f172a', border: '1px solid #3b82f6', borderRadius: 3, color: '#f1f5f9', padding: '1px 5px', fontSize: 'inherit', fontFamily: 'inherit', outline: 'none', minWidth: 60 }} />
    )
  }
  return (
    <span onClick={() => { setDraft(value || ''); setEditing(true) }}
      title="Click to edit"
      style={{ cursor: 'text', borderBottom: '1px dashed #334155', display: 'inline-block', minWidth: 16 }}>
      {value || <span style={{ color: '#475569', fontStyle: 'italic' }}>{placeholder || '—'}</span>}
    </span>
  )
}

function EditYear({ value, onChange }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value != null ? String(value) : '')
  const commit = () => { setEditing(false); const n = parseInt(draft, 10); onChange(isNaN(n) ? null : n) }
  if (editing) {
    return (
      <input autoFocus type="number" value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') commit() }}
        style={{ background: '#0f172a', border: '1px solid #3b82f6', borderRadius: 3, color: '#f1f5f9', padding: '1px 4px', fontSize: 'inherit', outline: 'none', width: 64 }} />
    )
  }
  return (
    <span onClick={() => { setDraft(value != null ? String(value) : ''); setEditing(true) }}
      title="Click to edit year"
      style={{ cursor: 'text', borderBottom: '1px dashed #334155' }}>
      {value ?? '?'}
    </span>
  )
}

// ── Section review card ───────────────────────────────────────────────────────

function SectionCard({ section, index, onToggle, enabled, onUpdate }) {
  const [open, setOpen] = useState(true)
  const { head, spouses = [], children = [] } = section

  const updateHead = (f, v) => onUpdate({ ...section, head: { ...head, [f]: v } })
  const updateSpouse = (si, f, v) => onUpdate({ ...section, spouses: spouses.map((sp, i) => i === si ? { ...sp, [f]: v } : sp) })
  const updateChild  = (ci, f, v) => onUpdate({ ...section, children: children.map((ch, i) => i === ci ? { ...ch, [f]: v } : ch) })

  return (
    <div style={{ background: enabled ? '#1e293b' : '#111827', border: `1px solid ${enabled ? '#1e3a5f' : '#374151'}`, borderRadius: 8, marginBottom: 10, opacity: enabled ? 1 : 0.5 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer' }}
        onClick={() => setOpen(o => !o)}>
        <span style={{ background: '#1e3a5f', color: '#60a5fa', borderRadius: 4, padding: '2px 8px', fontWeight: 700, fontSize: 13, fontFamily: 'monospace', minWidth: 28, textAlign: 'center' }}>
          {section.section_number}
        </span>
        <span style={{ flex: 1, color: '#f1f5f9', fontWeight: 600 }}>
          {[head.first_name, head.middle_name, head.last_name].filter(Boolean).join(' ')}
          {head.generation != null && <span style={{ fontSize: 11, color: '#64748b', marginLeft: 4 }}>gen {head.generation}</span>}
        </span>
        <span style={{ color: '#64748b', fontSize: 12 }}>{head.date_of_birth_year ?? '?'}–{head.date_of_death_year ?? '?'}</span>
        <span style={{ color: '#64748b', fontSize: 12 }}>{spouses.length}sp · {children.length}ch</span>
        <button onClick={e => { e.stopPropagation(); onToggle(index) }}
          style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, border: '1px solid #374151', background: enabled ? '#15803d' : '#374151', color: '#fff', cursor: 'pointer' }}>
          {enabled ? 'include' : 'skip'}
        </button>
        <span style={{ color: '#64748b', fontSize: 16 }}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div style={{ padding: '0 14px 12px', borderTop: '1px solid #0f172a' }}>

          {/* Head */}
          <div style={{ marginTop: 10, padding: '8px 10px', background: '#0f172a', borderRadius: 6, borderLeft: '3px solid #4ade80' }}>
            <div style={{ color: '#4ade80', fontSize: 11, marginBottom: 6, fontWeight: 600 }}>SECTION HEAD</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 13 }}>
              <label style={{ color: '#64748b', fontSize: 11 }}>First
                <div><EditText value={head.first_name} onChange={v => updateHead('first_name', v)} /></div>
              </label>
              <label style={{ color: '#64748b', fontSize: 11 }}>Middle
                <div><EditText value={head.middle_name} onChange={v => updateHead('middle_name', v)} /></div>
              </label>
              <label style={{ color: '#64748b', fontSize: 11 }}>Last
                <div><EditText value={head.last_name} onChange={v => updateHead('last_name', v)} /></div>
              </label>
              <label style={{ color: '#64748b', fontSize: 11 }}>Maiden
                <div><EditText value={head.maiden_name} onChange={v => updateHead('maiden_name', v)} /></div>
              </label>
              <label style={{ color: '#64748b', fontSize: 11 }}>Born
                <div><EditYear value={head.date_of_birth_year} onChange={v => updateHead('date_of_birth_year', v)} /></div>
              </label>
              <label style={{ color: '#64748b', fontSize: 11 }}>Died
                <div><EditYear value={head.date_of_death_year} onChange={v => updateHead('date_of_death_year', v)} /></div>
              </label>
            </div>
            {head.burial_place && <div style={{ fontSize: 11, color: '#60a5fa', marginTop: 4 }}>⚰ {head.burial_place}</div>}
            {head.notes && <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>{head.notes}</div>}
            <div style={{ fontSize: 10, color: '#334155', marginTop: 4, fontFamily: 'monospace' }}>{head.white_ref}</div>
          </div>

          {/* Spouses */}
          {spouses.map((sp, si) => (
            <div key={si} style={{ marginTop: 8, padding: '8px 10px', background: '#0f172a', borderRadius: 6, borderLeft: '3px solid #1e3a5f' }}>
              <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 6 }}>SPOUSE {sp.seq}  {sp.marriage_date_verbatim && <span style={{ color: '#64748b' }}>m. {sp.marriage_date_verbatim}</span>}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 13 }}>
                <label style={{ color: '#64748b', fontSize: 11 }}>First
                  <div><EditText value={sp.first_name} onChange={v => updateSpouse(si, 'first_name', v)} /></div>
                </label>
                <label style={{ color: '#64748b', fontSize: 11 }}>Middle
                  <div><EditText value={sp.middle_name} onChange={v => updateSpouse(si, 'middle_name', v)} /></div>
                </label>
                <label style={{ color: '#64748b', fontSize: 11 }}>Last
                  <div><EditText value={sp.last_name} onChange={v => updateSpouse(si, 'last_name', v)} /></div>
                </label>
                <label style={{ color: '#64748b', fontSize: 11 }}>Maiden
                  <div><EditText value={sp.maiden_name} onChange={v => updateSpouse(si, 'maiden_name', v)} /></div>
                </label>
                <label style={{ color: '#64748b', fontSize: 11 }}>Born
                  <div><EditYear value={sp.date_of_birth_year} onChange={v => updateSpouse(si, 'date_of_birth_year', v)} /></div>
                </label>
                <label style={{ color: '#64748b', fontSize: 11 }}>Died
                  <div><EditYear value={sp.date_of_death_year} onChange={v => updateSpouse(si, 'date_of_death_year', v)} /></div>
                </label>
              </div>
              {sp.parentage && <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>{sp.parentage}</div>}
              <div style={{ fontSize: 10, color: '#334155', marginTop: 4, fontFamily: 'monospace' }}>{sp.white_ref}</div>
            </div>
          ))}

          {/* Children */}
          {children.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ color: '#64748b', fontSize: 11, marginBottom: 4 }}>CHILDREN ({children.length})</div>
              {children.map((ch, ci) => (
                <div key={ci} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '5px 0', borderTop: '1px solid #0f172a', fontSize: 13 }}>
                  <span style={{ color: '#64748b', fontFamily: 'monospace', minWidth: 20, marginTop: 1, fontSize: 12 }}>{ch.roman_numeral}.</span>
                  {ch.has_section && (
                    <span style={{ fontSize: 10, background: '#1e3a5f', color: '#60a5fa', padding: '1px 5px', borderRadius: 9, marginTop: 2, flexShrink: 0 }}>
                      §{ch.section_number_ref ?? '?'}
                    </span>
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline' }}>
                      <EditText value={ch.first_name} onChange={v => updateChild(ci, 'first_name', v)} placeholder="first" />
                      {ch.middle_name && <EditText value={ch.middle_name} onChange={v => updateChild(ci, 'middle_name', v)} />}
                      <EditText value={ch.last_name} onChange={v => updateChild(ci, 'last_name', v)} placeholder="last" style={{ color: '#94a3b8' }} />
                      <span style={{ color: '#475569', fontSize: 11 }}>
                        <EditYear value={ch.date_of_birth_year} onChange={v => updateChild(ci, 'date_of_birth_year', v)} />
                        –
                        <EditYear value={ch.date_of_death_year} onChange={v => updateChild(ci, 'date_of_death_year', v)} />
                      </span>
                    </div>
                    {ch.burial_place && <div style={{ fontSize: 10, color: '#60a5fa' }}>⚰ {ch.burial_place}</div>}
                    {ch.notes && <div style={{ fontSize: 10, color: '#475569' }}>{ch.notes}</div>}
                    <div style={{ fontSize: 10, color: '#334155', fontFamily: 'monospace' }}>{ch.white_ref}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function WhiteImport({ onBack }) {
  const [phase, setPhase]           = useState('config')  // config | import | review | sql
  const [selectedBook, setSelectedBook] = useState('')   // WHITE_BOOKS key or 'custom'
  const [bookKey, setBookKey]       = useState('')
  const [bookTitle, setBookTitle]   = useState('')
  const [sourceId, setSourceId]     = useState('')
  const [allSections, setAllSections] = useState([])
  const [enabled, setEnabled]       = useState([])
  const [extracting, setExtracting] = useState(false)
  const [extractError, setExtractError] = useState(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [preview, setPreview]       = useState(null)
  const [sql, setSql]               = useState(null)
  const [copied, setCopied]         = useState(false)
  const fileRef = useRef()

  const selectBook = (key) => {
    setSelectedBook(key)
    const book = WHITE_BOOKS.find(b => b.key === key)
    if (book) {
      setBookKey(book.key)
      setBookTitle(book.title)
      setSourceId(book.sourceId)
    } else {
      setBookKey('')
      setBookTitle('')
      setSourceId('')
    }
  }

  const startConfig = () => {
    if (!bookKey.trim() || !bookTitle.trim() || !sourceId.trim()) return
    setPhase('import')
  }

  const extractPage = async (file) => {
    setExtracting(true)
    setExtractError(null)
    const reader = new FileReader()
    reader.onload = async (e) => {
      const dataUrl = e.target.result
      const base64 = dataUrl.split(',')[1]
      const mediaType = file.type || 'image/jpeg'
      setPreview(dataUrl)
      try {
        const res = await fetch('/api/extractWhite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: base64, mediaType, bookKey, pageNumber }),
        })
        const data = await res.json()
        if (!res.ok) { setExtractError(data.error || 'Extraction failed'); setExtracting(false); return }
        const raw = data.sections || []
        // Normalise: if Claude returned head fields flat (not nested), wrap them
        const newSections = raw.map(s => {
          if (s.head) return s
          const { section_number, lineage, spouses, children, ...headFields } = s
          return { section_number, lineage, head: headFields, spouses: spouses || [], children: children || [] }
        })
        setAllSections(prev => [...prev, ...newSections])
        setEnabled(prev => [...prev, ...newSections.map(() => true)])
        setPageNumber(n => n + 1)
      } catch (err) {
        setExtractError(err.message)
      }
      setExtracting(false)
    }
    reader.readAsDataURL(file)
  }

  const handleFile = (e) => {
    const file = e.target.files?.[0]
    if (file) extractPage(file)
    e.target.value = ''
  }

  const toggleSection = (i) => setEnabled(prev => prev.map((v, j) => j === i ? !v : v))

  const updateSection = (i, updated) =>
    setAllSections(prev => prev.map((s, j) => j === i ? updated : s))

  const generateSQL = () => {
    const active = allSections.filter((_, i) => enabled[i])
    setSql(genSQL(active, bookKey, bookTitle, sourceId))
    setPhase('sql')
  }

  const copySQL = () => {
    navigator.clipboard.writeText(sql).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }

  // ── Config phase ─────────────────────────────────────────────────────────────
  if (phase === 'config') {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--color-background-primary)', color: 'var(--color-text-primary)', paddingBottom: 60 }}>
        <div style={{ background: 'var(--color-background-secondary)', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '0.5px solid var(--color-border-secondary)' }}>
          <div>
            <p style={{ fontWeight: 700, fontSize: 16, margin: 0, color: 'var(--color-text-success)' }}>White Genealogy Import</p>
            <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', margin: 0 }}>Willis H. White series — any volume</p>
          </div>
          <button onClick={onBack} style={{ fontSize: 13, color: 'var(--color-text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}>← Admin</button>
        </div>
        <div style={{ maxWidth: 560, margin: '40px auto', padding: '0 16px' }}>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 24, lineHeight: 1.6 }}>
            Select the White volume you are importing. The book key namespaces all references in the database.
          </p>
          <div style={{ marginBottom: 24 }}>
            <label style={{ fontSize: 12, color: 'var(--color-text-tertiary)', display: 'block', marginBottom: 8 }}>Select volume</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {WHITE_BOOKS.map(book => (
                <label key={book.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer',
                  background: selectedBook === book.key ? 'var(--color-background-success)' : 'var(--color-background-secondary)',
                  border: `1.5px solid ${selectedBook === book.key ? 'var(--color-border-success)' : 'var(--color-border-tertiary)'}`,
                  borderRadius: 'var(--border-radius-md)', padding: '10px 12px' }}>
                  <input type="radio" name="book" value={book.key} checked={selectedBook === book.key}
                    onChange={() => selectBook(book.key)} style={{ marginTop: 2 }} />
                  <div>
                    <p style={{ margin: '0 0 2px', fontSize: 13, fontStyle: 'italic', color: 'var(--color-text-primary)' }}>{book.title}</p>
                    <p style={{ margin: 0, fontSize: 11, color: 'var(--color-text-tertiary)' }}>{book.author} · {book.year}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>
          <button onClick={startConfig} disabled={!selectedBook}
            style={{ fontSize: 14, padding: '10px 24px' }}>
            Start importing pages →
          </button>
          <div style={{ marginTop: 32, padding: '12px 14px', background: 'var(--color-background-secondary)', borderRadius: 'var(--border-radius-md)', border: '0.5px solid var(--color-border-tertiary)' }}>
            <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', margin: '0 0 6px', fontWeight: 600 }}>Schema prerequisites (run once, already done for Tillotson):</p>
            <pre style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
{`ALTER TABLE deceased
  ADD COLUMN IF NOT EXISTS white_ref TEXT UNIQUE;

CREATE INDEX IF NOT EXISTS deceased_white_ref_idx
  ON deceased(white_ref)
  WHERE white_ref IS NOT NULL;`}
            </pre>
          </div>
        </div>
      </div>
    )
  }

  // ── Import phase ──────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-background-primary)', color: 'var(--color-text-primary)', paddingBottom: 60 }}>
      <div style={{ background: 'var(--color-background-secondary)', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '0.5px solid var(--color-border-secondary)' }}>
        <div>
          <p style={{ fontWeight: 700, fontSize: 16, margin: 0, color: 'var(--color-text-success)' }}>
            {bookKey} — {phase === 'sql' ? 'Generated SQL' : `Page ${pageNumber - 1 > 0 ? pageNumber - 1 : '—'}`}
          </p>
          <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', margin: 0 }}>
            {allSections.length} section{allSections.length !== 1 ? 's' : ''} extracted · {enabled.filter(Boolean).length} included
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {allSections.length > 0 && phase !== 'sql' && (
            <button onClick={generateSQL}
              style={{ fontSize: 13, padding: '6px 14px', background: 'var(--color-background-success-strong)', color: 'var(--color-text-success)', border: '0.5px solid var(--color-border-success)' }}>
              Generate SQL
            </button>
          )}
          {phase === 'sql' && (
            <button onClick={() => setPhase('import')}
              style={{ fontSize: 13, padding: '6px 14px', background: 'var(--color-background-tertiary)', color: 'var(--color-text-secondary)', border: '0.5px solid var(--color-border-secondary)' }}>
              ← Back to review
            </button>
          )}
          <button onClick={onBack} style={{ fontSize: 13, color: 'var(--color-text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}>← Admin</button>
        </div>
      </div>

      <div style={{ maxWidth: 860, margin: '0 auto', padding: '20px 16px' }}>

        {/* SQL view */}
        {phase === 'sql' && sql && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: 0 }}>
                Review SQL below, then paste into the Supabase SQL editor and run.
              </p>
              <button onClick={copySQL} style={{ fontSize: 13, padding: '6px 16px' }}>
                {copied ? '✓ Copied' : 'Copy SQL'}
              </button>
            </div>
            <textarea readOnly value={sql}
              style={{ width: '100%', height: 560, fontFamily: 'monospace', fontSize: 11, background: '#0f172a', color: '#94a3b8', border: '1px solid #1e293b', borderRadius: 6, padding: 12, boxSizing: 'border-box', resize: 'vertical' }} />
          </>
        )}

        {/* Import + review view */}
        {phase !== 'sql' && (
          <>
            {/* Upload strip */}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 20, padding: '12px 14px', background: 'var(--color-background-secondary)', borderRadius: 'var(--border-radius-md)', border: '0.5px solid var(--color-border-tertiary)' }}>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 13, fontWeight: 600, margin: '0 0 2px' }}>
                  Upload page {pageNumber} image
                </p>
                <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: 0 }}>
                  JPEG or PNG — Claude will extract all sections visible on the page
                </p>
              </div>
              <input ref={fileRef} type="file" accept="image/*" onChange={handleFile}
                style={{ display: 'none' }} />
              <button onClick={() => fileRef.current?.click()} disabled={extracting}
                style={{ fontSize: 13, padding: '8px 18px', flexShrink: 0 }}>
                {extracting ? '⏳ Extracting…' : 'Upload page'}
              </button>
            </div>

            {extractError && (
              <div style={{ background: 'var(--color-background-danger)', border: '0.5px solid var(--color-border-danger)', borderRadius: 'var(--border-radius-sm)', padding: '10px 14px', marginBottom: 16 }}>
                <p style={{ fontSize: 13, color: 'var(--color-text-danger)', margin: 0 }}>Extraction error: {extractError}</p>
              </div>
            )}

            {/* Preview + extracted sections side by side on wide screens */}
            <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>

              {preview && (
                <div style={{ flexShrink: 0, width: 280 }}>
                  <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: 1 }}>Last page</p>
                  <img src={preview} alt="Last page" style={{ width: '100%', borderRadius: 'var(--border-radius-sm)', border: '0.5px solid var(--color-border-tertiary)' }} />
                </div>
              )}

              <div style={{ flex: 1, minWidth: 0 }}>
                {allSections.length === 0 && !extracting && (
                  <p style={{ fontSize: 13, color: 'var(--color-text-tertiary)', textAlign: 'center', paddingTop: 40 }}>
                    Upload the first page to begin
                  </p>
                )}
                {allSections.map((section, i) => (
                  <SectionCard
                    key={i}
                    section={section}
                    index={i}
                    enabled={enabled[i]}
                    onToggle={toggleSection}
                    onUpdate={(updated) => updateSection(i, updated)}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
