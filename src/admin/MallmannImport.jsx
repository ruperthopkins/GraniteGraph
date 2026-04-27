// src/admin/MallmannImport.jsx
// Granite Graph — Mallmann 1899 Genealogy Importer
// Processes JPG page scans via Claude vision; generates idempotent SQL using mallmann_ref.

import { useState, useRef } from 'react'

const SOURCE_ID = '9cb5c6d4-83b2-4ec6-ae59-72d2d7eb1155'
const CEMETERY_ID = 'd8bd1f88-cdde-4ef2-a448-5ab04d2d8107'

const esc = (s) => (s || '').replace(/'/g, "''")
const q = (s) => (s != null && s !== '') ? `'${esc(String(s))}'` : 'NULL'

const CHILD_TYPE_BADGE = {
  numbered:   { label: '# numbered',   color: '#1d4ed8' },
  lettered:   { label: 'A lettered',   color: '#7c3aed' },
  asterisked: { label: '* asterisked', color: '#b45309' },
  unnumbered: { label: 'terminal',     color: '#374151' },
}

// ── SQL helpers ───────────────────────────────────────────────────────────────

function personUpsert(r) {
  const updateCols = [
    'first_name', 'middle_name', 'last_name', 'maiden_name', 'gender',
    'date_of_birth_verbatim', 'date_of_death_verbatim',
    'date_of_birth_year', 'date_of_death_year', 'notes',
  ]
  const setClauses = updateCols
    .map(c => `  ${c} = COALESCE(deceased.${c}, EXCLUDED.${c})`)
    .join(',\n')

  return (
    `-- ${r.full_name} (${r.mallmann_ref})\n` +
    `INSERT INTO deceased (\n` +
    `  first_name, middle_name, last_name, maiden_name, gender,\n` +
    `  cemetery_id, source_id, mallmann_ref,\n` +
    `  date_of_birth_verbatim, date_of_death_verbatim,\n` +
    `  date_of_birth_year, date_of_death_year, notes)\n` +
    `VALUES (\n` +
    `  ${q(r.first_name)}, ${q(r.middle_name)}, ${q(r.last_name)}, ${q(r.maiden_name)}, ${q(r.gender)},\n` +
    `  '${CEMETERY_ID}', '${SOURCE_ID}', ${q(r.mallmann_ref)},\n` +
    `  ${q(r.date_of_birth_verbatim)}, ${q(r.date_of_death_verbatim)},\n` +
    `  ${r.date_of_birth_year ?? 'NULL'}, ${r.date_of_death_year ?? 'NULL'}, ${q(r.notes)})\n` +
    `ON CONFLICT (mallmann_ref) DO UPDATE SET\n` +
    `${setClauses};\n` +
    `INSERT INTO deceased_sources (\n` +
    `  deceased_id, source_id, source_type,\n` +
    `  date_of_birth_verbatim, date_of_death_verbatim,\n` +
    `  date_of_birth_year, date_of_death_year, notes)\n` +
    `SELECT deceased_id, '${SOURCE_ID}', 'family_record',\n` +
    `  ${q(r.date_of_birth_verbatim)}, ${q(r.date_of_death_verbatim)},\n` +
    `  ${r.date_of_birth_year ?? 'NULL'}, ${r.date_of_death_year ?? 'NULL'}, ${q(r.notes)}\n` +
    `FROM deceased WHERE mallmann_ref = ${q(r.mallmann_ref)}\n` +
    `ON CONFLICT DO NOTHING;`
  )
}

function kinshipPair(refA, refB, relType, evidence, consanguineous = false) {
  const inverse = { SPOUSE: 'SPOUSE', PARENT_OF: 'CHILD_OF', CHILD_OF: 'PARENT_OF', SIBLING_OF: 'SIBLING_OF' }
  const inv = inverse[relType]
  const consCol = relType === 'SPOUSE' ? `, consanguineous` : ''
  const consVal = relType === 'SPOUSE' ? `, ${consanguineous}` : ''
  const ev = q(evidence || null)
  const src = `'${SOURCE_ID}'`
  const base =
    `INSERT INTO kinship (primary_deceased_id, relative_deceased_id, relationship_type, source, confidence, notes, source_id${consCol})\n` +
    `SELECT a.deceased_id, b.deceased_id, '${relType}', 'mallmann', 'high', ${ev}, ${src}${consVal}\n` +
    `FROM deceased a, deceased b WHERE a.mallmann_ref = ${q(refA)} AND b.mallmann_ref = ${q(refB)}\n` +
    `ON CONFLICT DO NOTHING;\n` +
    `INSERT INTO kinship (primary_deceased_id, relative_deceased_id, relationship_type, source, confidence, notes, source_id${consCol})\n` +
    `SELECT b.deceased_id, a.deceased_id, '${inv}', 'mallmann', 'high', ${ev}, ${src}${consVal}\n` +
    `FROM deceased a, deceased b WHERE a.mallmann_ref = ${q(refA)} AND b.mallmann_ref = ${q(refB)}\n` +
    `ON CONFLICT DO NOTHING;`
  return base
}

function genSQL(sections, familyName) {
  if (!sections.length) return ''
  const lines = [
    `-- Mallmann ${familyName} import`,
    `-- Generated ${new Date().toISOString().split('T')[0]}`,
    `-- Source: Mallmann 1899 genealogy (source_id = ${SOURCE_ID})`,
    `-- Idempotent: safe to re-run`,
    ``,
    `BEGIN;`,
    ``,
    `-- ── STEP 1: Upsert people ────────────────────────────────────────────────────`,
  ]

  for (const section of sections) {
    const { head, spouses = [], children = [] } = section
    lines.push('', personUpsert(head))
    for (const sp of spouses) lines.push('', personUpsert(sp))
    for (const ch of children) {
      if (ch.child_type === 'unnumbered') lines.push('', personUpsert(ch))
    }
  }

  lines.push('', '', `-- ── STEP 2: Insert kinship ──────────────────────────────────────────────────`)

  for (const section of sections) {
    const { head, spouses = [], children = [] } = section
    lines.push('', `-- ${head.full_name} (${head.mallmann_ref}) relationships`)

    for (const sp of spouses) {
      lines.push(kinshipPair(head.mallmann_ref, sp.mallmann_ref, 'SPOUSE',
        `married ${sp.marriage_date_verbatim || ''}`.trim(), sp.consanguineous))
    }

    for (const ch of children) {
      lines.push(kinshipPair(head.mallmann_ref, ch.mallmann_ref, 'PARENT_OF',
        `child of ${head.full_name}`))

      const parentSpouse = spouses[(ch.spouse_seq ?? 1) - 1]
      if (parentSpouse) {
        lines.push(kinshipPair(parentSpouse.mallmann_ref, ch.mallmann_ref, 'PARENT_OF',
          `child of ${parentSpouse.full_name}`))
      }
    }
  }

  lines.push('', '', `COMMIT;`)
  return lines.join('\n')
}

// ── Section review card ───────────────────────────────────────────────────────

function SectionCard({ section, index, onToggle, enabled }) {
  const [open, setOpen] = useState(true)
  const { head, spouses = [], children = [] } = section

  return (
    <div style={{ background: enabled ? '#1e293b' : '#111827', border: `1px solid ${enabled ? '#1e3a5f' : '#374151'}`, borderRadius: 8, marginBottom: 10, opacity: enabled ? 1 : 0.5 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer' }}
        onClick={() => setOpen(o => !o)}>
        <span style={{ background: '#1e3a5f', color: '#60a5fa', borderRadius: 4, padding: '2px 8px', fontWeight: 700, fontSize: 13, fontFamily: 'monospace', minWidth: 28, textAlign: 'center' }}>
          {section.section_id}
        </span>
        <span style={{ flex: 1, color: '#f1f5f9', fontWeight: 600 }}>{head.full_name}</span>
        <span style={{ color: '#64748b', fontSize: 12 }}>
          {head.date_of_birth_year ?? '?'}–{head.date_of_death_year ?? '?'}
        </span>
        <span style={{ color: '#64748b', fontSize: 12 }}>{spouses.length} spouse{spouses.length !== 1 ? 's' : ''}, {children.length} ch</span>
        <button onClick={e => { e.stopPropagation(); onToggle(index) }}
          style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, border: '1px solid #374151', background: enabled ? '#15803d' : '#374151', color: '#fff', cursor: 'pointer' }}>
          {enabled ? 'include' : 'skip'}
        </button>
        <span style={{ color: '#64748b', fontSize: 16 }}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div style={{ padding: '0 14px 12px', borderTop: '1px solid #1e293b' }}>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>
            <strong style={{ color: '#64748b' }}>ref:</strong> {head.mallmann_ref}
            {head.parent_section_id && <> · <strong style={{ color: '#64748b' }}>parent section:</strong> {head.parent_section_id}</>}
          </div>

          {spouses.map(sp => (
            <div key={sp.seq} style={{ marginTop: 10, padding: '8px 10px', background: '#0f172a', borderRadius: 6, borderLeft: sp.consanguineous ? '3px solid #f59e0b' : '3px solid #1e3a5f' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: '#94a3b8', fontSize: 11 }}>spouse {sp.seq}</span>
                <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{sp.full_name}</span>
                {sp.consanguineous && <span style={{ fontSize: 10, background: '#78350f', color: '#fde68a', padding: '1px 6px', borderRadius: 10 }}>CONSANGUINEOUS</span>}
              </div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>
                {sp.date_of_birth_year ?? '?'}–{sp.date_of_death_year ?? '?'}
                {sp.marriage_date_verbatim && <> · m. {sp.marriage_date_verbatim}</>}
                {sp.parentage && <> · {sp.parentage}</>}
              </div>
              <div style={{ fontSize: 11, color: '#475569' }}>{sp.mallmann_ref}</div>
            </div>
          ))}

          {children.map((ch, ci) => {
            const badge = CHILD_TYPE_BADGE[ch.child_type] || CHILD_TYPE_BADGE.unnumbered
            return (
              <div key={ci} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 6, padding: '5px 0', borderTop: '1px solid #0f172a' }}>
                <span style={{ fontSize: 10, background: badge.color, color: '#fff', padding: '2px 6px', borderRadius: 10, whiteSpace: 'nowrap', marginTop: 1 }}>
                  {ch.child_type}
                </span>
                <div>
                  <div style={{ color: '#e2e8f0', fontSize: 13 }}>
                    {ch.full_name}
                    <span style={{ color: '#64748b', marginLeft: 8, fontSize: 11 }}>
                      {ch.date_of_birth_year ?? '?'}–{ch.date_of_death_year ?? '?'}
                    </span>
                    {ch.spouse_seq != null && ch.spouse_seq > 1 && (
                      <span style={{ marginLeft: 8, fontSize: 10, color: '#94a3b8' }}>by wife {ch.spouse_seq}</span>
                    )}
                  </div>
                  <div style={{ fontSize: 10, color: '#475569' }}>{ch.mallmann_ref}</div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MallmannImport({ onBack }) {
  const [step, setStep] = useState('setup')
  const [familyName, setFamilyName] = useState('Hopkins')
  const [files, setFiles] = useState([])
  const [sections, setSections] = useState([])
  const [enabled, setEnabled] = useState([])          // parallel array of booleans
  const [currentFile, setCurrentFile] = useState(0)
  const [extractErrors, setExtractErrors] = useState([])
  const [copied, setCopied] = useState(false)
  const [sql, setSql] = useState('')
  const fileRef = useRef()

  const readAsBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const base64 = reader.result.split(',')[1]
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })

  const runExtraction = async () => {
    if (!files.length || !familyName.trim()) return
    setStep('extracting')
    setCurrentFile(0)
    setExtractErrors([])
    const allSections = []
    const errors = []

    for (let i = 0; i < files.length; i++) {
      setCurrentFile(i)
      try {
        const base64 = await readAsBase64(files[i])
        const resp = await fetch('/api/extractMallmann', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image: base64,
            mediaType: files[i].type || 'image/jpeg',
            familyName: familyName.trim(),
            pageNumber: i + 1,
          }),
        })
        const data = await resp.json()
        if (!resp.ok) {
          errors.push({ file: files[i].name, error: data.error || 'API error' })
        } else if (data.sections) {
          allSections.push(...data.sections)
        }
      } catch (err) {
        errors.push({ file: files[i].name, error: err.message })
      }
    }

    setExtractErrors(errors)
    setSections(allSections)
    setEnabled(allSections.map(() => true))
    setStep('review')
  }

  const handleGenSQL = () => {
    const activeSections = sections.filter((_, i) => enabled[i])
    setSql(genSQL(activeSections, familyName))
    setStep('sql')
  }

  const toggleSection = (i) => setEnabled(prev => prev.map((v, idx) => idx === i ? !v : v))

  const btn = (extra = {}) => ({
    padding: '10px 18px', borderRadius: 6, border: 'none', cursor: 'pointer',
    fontWeight: 600, fontSize: 14, ...extra,
  })

  // ── Setup step ──────────────────────────────────────────────────────────────
  if (step === 'setup') {
    return (
      <div style={{ minHeight: '100vh', background: '#0f172a', color: '#f1f5f9', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ background: '#1e293b', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ color: '#4ade80', fontWeight: 700, fontSize: 18, margin: 0 }}>Mallmann Import</h1>
            <p style={{ color: '#94a3b8', fontSize: 12, margin: '2px 0 0' }}>Mallmann 1899 Genealogy — image-based extractor</p>
          </div>
          <button onClick={onBack} style={{ color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14 }}>← Admin</button>
        </div>

        <div style={{ maxWidth: 520, margin: '32px auto', padding: '0 16px' }}>
          <div style={{ background: '#1e293b', borderRadius: 10, padding: 24 }}>
            <label style={{ display: 'block', color: '#94a3b8', fontSize: 13, marginBottom: 6 }}>Family name (Mallmann section namespace)</label>
            <input
              value={familyName}
              onChange={e => setFamilyName(e.target.value)}
              placeholder="e.g. Hopkins"
              style={{ width: '100%', boxSizing: 'border-box', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, padding: '10px 12px', color: '#f1f5f9', fontSize: 15, marginBottom: 20 }}
            />

            <label style={{ display: 'block', color: '#94a3b8', fontSize: 13, marginBottom: 6 }}>Page images (JPG)</label>
            <div
              onClick={() => fileRef.current.click()}
              style={{ border: '2px dashed #334155', borderRadius: 8, padding: '20px 16px', textAlign: 'center', cursor: 'pointer', marginBottom: 20 }}>
              {files.length === 0
                ? <span style={{ color: '#64748b', fontSize: 14 }}>Click to select JPG files — select multiple to batch-process</span>
                : <span style={{ color: '#4ade80', fontSize: 14 }}>{files.length} file{files.length !== 1 ? 's' : ''} selected: {files.map(f => f.name).join(', ')}</span>}
            </div>
            <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
              onChange={e => setFiles(Array.from(e.target.files))} />

            <div style={{ background: '#0f172a', borderRadius: 6, padding: '10px 14px', marginBottom: 20, fontSize: 12, color: '#64748b', lineHeight: 1.6 }}>
              <strong style={{ color: '#94a3b8' }}>Prerequisites:</strong><br />
              mallmann_ref column and idx_deceased_mallmann_ref index must exist on deceased.<br />
              consanguineous column must exist on kinship.<br />
              Run <code style={{ color: '#93c5fd' }}>src/admin/migration_mallmann_schema.sql</code> first if not done.
            </div>

            <button
              onClick={runExtraction}
              disabled={!files.length || !familyName.trim()}
              style={btn({ background: files.length && familyName.trim() ? '#15803d' : '#374151', color: '#fff', width: '100%' })}>
              Extract {files.length || 0} page{files.length !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Extracting step ─────────────────────────────────────────────────────────
  if (step === 'extracting') {
    return (
      <div style={{ minHeight: '100vh', background: '#0f172a', color: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 36, marginBottom: 16 }}>📖</div>
          <p style={{ color: '#4ade80', fontSize: 18, fontWeight: 600 }}>Extracting page {currentFile + 1} of {files.length}…</p>
          <p style={{ color: '#64748b', fontSize: 14 }}>{files[currentFile]?.name}</p>
          <div style={{ width: 240, height: 6, background: '#1e293b', borderRadius: 3, margin: '16px auto 0' }}>
            <div style={{ height: 6, background: '#15803d', borderRadius: 3, width: `${((currentFile) / files.length) * 100}%`, transition: 'width 0.3s' }} />
          </div>
        </div>
      </div>
    )
  }

  // ── Review step ─────────────────────────────────────────────────────────────
  if (step === 'review') {
    const activeCount = enabled.filter(Boolean).length
    return (
      <div style={{ minHeight: '100vh', background: '#0f172a', color: '#f1f5f9', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ background: '#1e293b', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 10 }}>
          <div>
            <h1 style={{ color: '#4ade80', fontWeight: 700, fontSize: 18, margin: 0 }}>Review — {familyName} sections</h1>
            <p style={{ color: '#94a3b8', fontSize: 12, margin: '2px 0 0' }}>{activeCount} of {sections.length} sections included</p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => setStep('setup')} style={btn({ background: '#374151', color: '#d1d5db' })}>← Back</button>
            <button onClick={handleGenSQL} disabled={activeCount === 0}
              style={btn({ background: activeCount ? '#15803d' : '#374151', color: '#fff' })}>
              Generate SQL →
            </button>
          </div>
        </div>

        {extractErrors.length > 0 && (
          <div style={{ margin: '16px 20px', background: '#450a0a', border: '1px solid #991b1b', borderRadius: 8, padding: '12px 16px' }}>
            <p style={{ color: '#fca5a5', fontWeight: 600, margin: '0 0 8px' }}>Extraction errors:</p>
            {extractErrors.map((e, i) => (
              <p key={i} style={{ color: '#fca5a5', fontSize: 13, margin: '2px 0' }}>{e.file}: {e.error}</p>
            ))}
          </div>
        )}

        <div style={{ maxWidth: 780, margin: '0 auto', padding: '16px 16px 40px' }}>
          {sections.length === 0
            ? <p style={{ color: '#64748b', textAlign: 'center', marginTop: 40 }}>No sections extracted. Check for errors above.</p>
            : sections.map((section, i) => (
              <SectionCard key={i} section={section} index={i} onToggle={toggleSection} enabled={enabled[i]} />
            ))}
        </div>
      </div>
    )
  }

  // ── SQL step ────────────────────────────────────────────────────────────────
  if (step === 'sql') {
    const activeSections = sections.filter((_, i) => enabled[i])
    const personCount = activeSections.reduce((n, s) => {
      return n + 1 + (s.spouses?.length ?? 0) + (s.children?.filter(c => c.child_type === 'unnumbered').length ?? 0)
    }, 0)
    const kinshipCount = activeSections.reduce((n, s) => {
      return n + (s.spouses?.length ?? 0) + (s.children?.length ?? 0) * 2
    }, 0)

    return (
      <div style={{ minHeight: '100vh', background: '#0f172a', color: '#f1f5f9', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ background: '#1e293b', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ color: '#4ade80', fontWeight: 700, fontSize: 18, margin: 0 }}>Generated SQL</h1>
            <p style={{ color: '#94a3b8', fontSize: 12, margin: '2px 0 0' }}>
              ~{personCount} person upserts · ~{kinshipCount * 2} kinship pairs · {activeSections.length} sections
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => setStep('review')} style={btn({ background: '#374151', color: '#d1d5db' })}>← Review</button>
            <button onClick={() => { navigator.clipboard.writeText(sql); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
              style={btn({ background: copied ? '#15803d' : '#1e3a5f', color: '#fff', minWidth: 110 })}>
              {copied ? '✓ Copied!' : 'Copy SQL'}
            </button>
          </div>
        </div>

        <div style={{ maxWidth: 860, margin: '16px auto', padding: '0 16px' }}>
          <div style={{ background: '#020617', border: '1px solid #1e293b', borderRadius: 8, padding: 12, marginBottom: 14 }}>
            <p style={{ color: '#94a3b8', fontSize: 12, margin: 0, lineHeight: 1.6 }}>
              <strong style={{ color: '#4ade80' }}>Instructions:</strong> Copy and paste into the Supabase SQL editor.
              The SQL is idempotent — safe to re-run. Numbered children are referenced by kinship but their
              deceased rows are inserted when their own section is processed. Run after importing all pages.
            </p>
          </div>
          <pre style={{ fontSize: 11, fontFamily: 'monospace', background: '#0f172a', padding: 16, borderRadius: 8, overflow: 'auto', maxHeight: '65vh', color: '#d1d5db', border: '1px solid #1e293b', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>
            {sql}
          </pre>
        </div>
      </div>
    )
  }

  return null
}
