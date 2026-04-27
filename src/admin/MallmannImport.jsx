// src/admin/MallmannImport.jsx
// Granite Graph — Mallmann 1899 Genealogy Importer
// Processes JPG page scans via Claude vision; generates idempotent SQL using mallmann_ref.

import { useState, useRef } from 'react'

const SOURCE_ID = '9cb5c6d4-83b2-4ec6-ae59-72d2d7eb1155'
const CEMETERY_ID = 'd8bd1f88-cdde-4ef2-a448-5ab04d2d8107'

const esc = (s) => (s || '').replace(/'/g, "''")
const q = (s) => (s != null && s !== '') ? `'${esc(String(s))}'` : 'NULL'

const CHILD_TYPES = ['numbered', 'lettered', 'asterisked', 'unnumbered']
const CHILD_TYPE_COLORS = { numbered: '#1d4ed8', lettered: '#7c3aed', asterisked: '#b45309', unnumbered: '#374151' }

// Auto-generate mallmann_ref for unnumbered children
function childRef(familyName, parentSectionId, child) {
  if (child.child_type !== 'unnumbered') return child.mallmann_ref
  const name = (child.first_name || 'child').replace(/\s+/g, '')
  const year = child.date_of_birth_year || 'unknown'
  return `${familyName}_${parentSectionId}_child_${name}_${year}`
}

// ── SQL helpers ───────────────────────────────────────────────────────────────

function personUpsert(r) {
  const updateCols = [
    'first_name', 'middle_name', 'last_name', 'maiden_name', 'gender',
    'date_of_birth_verbatim', 'date_of_death_verbatim',
    'date_of_birth_year', 'date_of_death_year', 'notes',
  ]
  const setClauses = updateCols.map(c => `  ${c} = COALESCE(deceased.${c}, EXCLUDED.${c})`).join(',\n')
  return (
    `-- ${r.full_name || [r.first_name, r.last_name].filter(Boolean).join(' ')} (${r.mallmann_ref})\n` +
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
    `ON CONFLICT (mallmann_ref) WHERE mallmann_ref IS NOT NULL DO UPDATE SET\n${setClauses};\n` +
    `INSERT INTO deceased_sources (\n` +
    `  deceased_id, source_id, source_type,\n` +
    `  date_of_birth_verbatim, date_of_death_verbatim,\n` +
    `  date_of_birth_year, date_of_death_year, notes)\n` +
    `SELECT deceased_id, '${SOURCE_ID}', 'family_record',\n` +
    `  ${q(r.date_of_birth_verbatim)}, ${q(r.date_of_death_verbatim)},\n` +
    `  ${r.date_of_birth_year ?? 'NULL'}, ${r.date_of_death_year ?? 'NULL'}, ${q(r.notes)}\n` +
    `FROM deceased WHERE mallmann_ref = ${q(r.mallmann_ref)}\nON CONFLICT DO NOTHING;`
  )
}

function kinshipPair(refA, refB, relType, evidence, consanguineous = false) {
  const inverse = { SPOUSE: 'SPOUSE', PARENT_OF: 'CHILD_OF', CHILD_OF: 'PARENT_OF', SIBLING_OF: 'SIBLING_OF' }
  const inv = inverse[relType]
  const consCol = relType === 'SPOUSE' ? `, consanguineous` : ''
  const consVal = relType === 'SPOUSE' ? `, ${consanguineous}` : ''
  const ev = q(evidence || null)
  const src = `'${SOURCE_ID}'`
  return (
    `INSERT INTO kinship (primary_deceased_id, relative_deceased_id, relationship_type, source, confidence, notes, source_id${consCol})\n` +
    `SELECT a.deceased_id, b.deceased_id, '${relType}', 'mallmann', 'high', ${ev}, ${src}${consVal}\n` +
    `FROM deceased a, deceased b WHERE a.mallmann_ref = ${q(refA)} AND b.mallmann_ref = ${q(refB)}\n` +
    `ON CONFLICT DO NOTHING;\n` +
    `INSERT INTO kinship (primary_deceased_id, relative_deceased_id, relationship_type, source, confidence, notes, source_id${consCol})\n` +
    `SELECT b.deceased_id, a.deceased_id, '${inv}', 'mallmann', 'high', ${ev}, ${src}${consVal}\n` +
    `FROM deceased a, deceased b WHERE a.mallmann_ref = ${q(refA)} AND b.mallmann_ref = ${q(refB)}\n` +
    `ON CONFLICT DO NOTHING;`
  )
}

function genSQL(sections, familyName) {
  if (!sections.length) return ''
  const lines = [
    `-- Mallmann ${familyName} import`,
    `-- Generated ${new Date().toISOString().split('T')[0]}`,
    `-- Source: Mallmann 1899 genealogy (source_id = ${SOURCE_ID})`,
    `-- Idempotent: safe to re-run`,
    ``, `BEGIN;`, ``,
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
    lines.push('', `-- ${head.first_name} ${head.last_name} (${head.mallmann_ref}) relationships`)
    for (const sp of spouses) {
      lines.push(kinshipPair(head.mallmann_ref, sp.mallmann_ref, 'SPOUSE',
        `married ${sp.marriage_date_verbatim || ''}`.trim(), sp.consanguineous))
    }
    for (const ch of children) {
      lines.push(kinshipPair(head.mallmann_ref, ch.mallmann_ref, 'PARENT_OF', `child of ${head.first_name} ${head.last_name}`))
      const parentSpouse = spouses[(ch.spouse_seq ?? 1) - 1]
      if (parentSpouse) {
        lines.push(kinshipPair(parentSpouse.mallmann_ref, ch.mallmann_ref, 'PARENT_OF', `child of ${parentSpouse.first_name} ${parentSpouse.last_name}`))
      }
    }
  }
  lines.push('', '', `COMMIT;`)
  return lines.join('\n')
}

// ── Editable field components ─────────────────────────────────────────────────

function EditText({ value, onChange, placeholder, style = {} }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value || '')

  const commit = () => { setEditing(false); onChange(draft) }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') commit() }}
        style={{ background: '#0f172a', border: '1px solid #3b82f6', borderRadius: 3, color: '#f1f5f9', padding: '1px 5px', fontSize: 'inherit', fontFamily: 'inherit', outline: 'none', minWidth: 60, ...style }}
      />
    )
  }
  return (
    <span
      onClick={() => { setDraft(value || ''); setEditing(true) }}
      title="Click to edit"
      style={{ cursor: 'text', borderBottom: '1px dashed #334155', display: 'inline-block', minWidth: 20, ...style }}>
      {value || <span style={{ color: '#475569', fontStyle: 'italic' }}>{placeholder || '—'}</span>}
    </span>
  )
}

function EditYear({ value, onChange }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value != null ? String(value) : '')

  const commit = () => {
    setEditing(false)
    const n = parseInt(draft, 10)
    onChange(isNaN(n) ? null : n)
  }

  if (editing) {
    return (
      <input
        autoFocus
        type="number"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') commit() }}
        style={{ background: '#0f172a', border: '1px solid #3b82f6', borderRadius: 3, color: '#f1f5f9', padding: '1px 4px', fontSize: 'inherit', outline: 'none', width: 64 }}
      />
    )
  }
  return (
    <span
      onClick={() => { setDraft(value != null ? String(value) : ''); setEditing(true) }}
      title="Click to edit year"
      style={{ cursor: 'text', borderBottom: '1px dashed #334155' }}>
      {value ?? '?'}
    </span>
  )
}

// ── Section card with inline editing ─────────────────────────────────────────

function SectionCard({ section, familyName, index, onToggle, enabled, onUpdate }) {
  const [open, setOpen] = useState(true)
  const [addingChild, setAddingChild] = useState(false)
  const [newChild, setNewChild] = useState({ first_name: '', last_name: section.head?.last_name || '', date_of_birth_year: null, date_of_death_year: null, child_type: 'unnumbered', spouse_seq: 1, gender: null, notes: null })

  const { head, spouses = [], children = [] } = section

  const updateHead = (field, value) => onUpdate({ ...section, head: { ...head, [field]: value } })
  const updateSpouse = (si, field, value) => onUpdate({
    ...section,
    spouses: spouses.map((sp, i) => i === si ? { ...sp, [field]: value } : sp)
  })
  const deleteSpouse = (si) => onUpdate({ ...section, spouses: spouses.filter((_, i) => i !== si) })
  const updateChild = (ci, field, value) => {
    const updated = children.map((ch, i) => {
      if (i !== ci) return ch
      const next = { ...ch, [field]: value }
      next.mallmann_ref = childRef(familyName, section.section_id, next)
      return next
    })
    onUpdate({ ...section, children: updated })
  }
  const deleteChild = (ci) => onUpdate({ ...section, children: children.filter((_, i) => i !== ci) })
  const addChild = () => {
    const ch = {
      ...newChild,
      full_name: [newChild.first_name, newChild.last_name].filter(Boolean).join(' '),
      middle_name: null, maiden_name: null,
      date_of_birth_verbatim: null, date_of_death_verbatim: null,
    }
    ch.mallmann_ref = childRef(familyName, section.section_id, ch)
    onUpdate({ ...section, children: [...children, ch] })
    setNewChild({ first_name: '', last_name: head?.last_name || '', date_of_birth_year: null, date_of_death_year: null, child_type: 'unnumbered', spouse_seq: 1, gender: null, notes: null })
    setAddingChild(false)
  }

  return (
    <div style={{ background: enabled ? '#1e293b' : '#111827', border: `1px solid ${enabled ? '#1e3a5f' : '#374151'}`, borderRadius: 8, marginBottom: 10, opacity: enabled ? 1 : 0.5 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer' }}
        onClick={() => setOpen(o => !o)}>
        <span style={{ background: '#1e3a5f', color: '#60a5fa', borderRadius: 4, padding: '2px 8px', fontWeight: 700, fontSize: 13, fontFamily: 'monospace', minWidth: 28, textAlign: 'center' }}>
          {section.section_id}
        </span>
        <span style={{ flex: 1, color: '#f1f5f9', fontWeight: 600 }}>{head.first_name} {head.last_name}</span>
        <span style={{ color: '#64748b', fontSize: 12 }}>{head.date_of_birth_year ?? '?'}–{head.date_of_death_year ?? '?'}</span>
        <span style={{ color: '#64748b', fontSize: 12 }}>{spouses.length} spouse{spouses.length !== 1 ? 's' : ''}, {children.length} ch</span>
        <button onClick={e => { e.stopPropagation(); onToggle(index) }}
          style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, border: '1px solid #374151', background: enabled ? '#15803d' : '#374151', color: '#fff', cursor: 'pointer' }}>
          {enabled ? 'include' : 'skip'}
        </button>
        <span style={{ color: '#64748b', fontSize: 16 }}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div style={{ padding: '0 14px 12px', borderTop: '1px solid #0f172a' }}>
          {/* Head fields */}
          <div style={{ marginTop: 10, padding: '8px 10px', background: '#0f172a', borderRadius: 6, borderLeft: '3px solid #4ade80' }}>
            <div style={{ color: '#4ade80', fontSize: 11, marginBottom: 6, fontWeight: 600 }}>SECTION HEAD</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 13 }}>
              <label style={{ color: '#64748b', fontSize: 11 }}>First
                <div><EditText value={head.first_name} onChange={v => updateHead('first_name', v)} placeholder="first" /></div>
              </label>
              <label style={{ color: '#64748b', fontSize: 11 }}>Middle
                <div><EditText value={head.middle_name} onChange={v => updateHead('middle_name', v)} placeholder="—" /></div>
              </label>
              <label style={{ color: '#64748b', fontSize: 11 }}>Last
                <div><EditText value={head.last_name} onChange={v => updateHead('last_name', v)} placeholder="last" /></div>
              </label>
              <label style={{ color: '#64748b', fontSize: 11 }}>Birth year
                <div><EditYear value={head.date_of_birth_year} onChange={v => updateHead('date_of_birth_year', v)} /></div>
              </label>
              <label style={{ color: '#64748b', fontSize: 11 }}>Death year
                <div><EditYear value={head.date_of_death_year} onChange={v => updateHead('date_of_death_year', v)} /></div>
              </label>
            </div>
            {head.notes && <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>{head.notes}</div>}
            <div style={{ fontSize: 10, color: '#334155', marginTop: 4 }}>{head.mallmann_ref}</div>
          </div>

          {/* Spouses */}
          {spouses.map((sp, si) => (
            <div key={si} style={{ marginTop: 8, padding: '8px 10px', background: '#0f172a', borderRadius: 6, borderLeft: sp.consanguineous ? '3px solid #f59e0b' : '3px solid #1e3a5f' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ color: '#94a3b8', fontSize: 11 }}>SPOUSE {sp.seq}</span>
                {sp.consanguineous && <span style={{ fontSize: 10, background: '#78350f', color: '#fde68a', padding: '1px 6px', borderRadius: 10 }}>CONSANGUINEOUS</span>}
                <button
                  onClick={() => updateSpouse(si, 'consanguineous', !sp.consanguineous)}
                  style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, border: '1px solid #374151', background: '#1e293b', color: '#94a3b8', cursor: 'pointer', marginLeft: 'auto' }}>
                  toggle consanguineous
                </button>
                <button onClick={() => deleteSpouse(si)}
                  style={{ fontSize: 12, padding: '1px 6px', borderRadius: 4, border: '1px solid #7f1d1d', background: '#450a0a', color: '#fca5a5', cursor: 'pointer' }}>
                  ✕
                </button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 13 }}>
                <label style={{ color: '#64748b', fontSize: 11 }}>First
                  <div><EditText value={sp.first_name} onChange={v => updateSpouse(si, 'first_name', v)} /></div>
                </label>
                <label style={{ color: '#64748b', fontSize: 11 }}>Last
                  <div><EditText value={sp.last_name} onChange={v => updateSpouse(si, 'last_name', v)} /></div>
                </label>
                <label style={{ color: '#64748b', fontSize: 11 }}>Birth year
                  <div><EditYear value={sp.date_of_birth_year} onChange={v => updateSpouse(si, 'date_of_birth_year', v)} /></div>
                </label>
                <label style={{ color: '#64748b', fontSize: 11 }}>Death year
                  <div><EditYear value={sp.date_of_death_year} onChange={v => updateSpouse(si, 'date_of_death_year', v)} /></div>
                </label>
                <label style={{ color: '#64748b', fontSize: 11 }}>Married
                  <div><EditText value={sp.marriage_date_verbatim} onChange={v => updateSpouse(si, 'marriage_date_verbatim', v)} placeholder="—" /></div>
                </label>
              </div>
              <div style={{ fontSize: 10, color: '#334155', marginTop: 4 }}>{sp.mallmann_ref}</div>
            </div>
          ))}

          {/* Children */}
          {children.map((ch, ci) => (
            <div key={ci} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 6, padding: '6px 0', borderTop: '1px solid #0f172a' }}>
              <select
                value={ch.child_type}
                onChange={e => updateChild(ci, 'child_type', e.target.value)}
                style={{ fontSize: 10, background: CHILD_TYPE_COLORS[ch.child_type], color: '#fff', border: 'none', borderRadius: 10, padding: '2px 6px', cursor: 'pointer', marginTop: 2 }}>
                {CHILD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 13, alignItems: 'baseline' }}>
                  <EditText value={ch.first_name} onChange={v => updateChild(ci, 'first_name', v)} placeholder="first" />
                  <EditText value={ch.last_name} onChange={v => updateChild(ci, 'last_name', v)} placeholder="last" style={{ color: '#94a3b8' }} />
                  <span style={{ color: '#475569', fontSize: 11 }}>
                    <EditYear value={ch.date_of_birth_year} onChange={v => updateChild(ci, 'date_of_birth_year', v)} />
                    –
                    <EditYear value={ch.date_of_death_year} onChange={v => updateChild(ci, 'date_of_death_year', v)} />
                  </span>
                  {ch.spouse_seq != null && ch.spouse_seq > 1 && (
                    <span style={{ fontSize: 10, color: '#94a3b8' }}>by wife {ch.spouse_seq}</span>
                  )}
                </div>
                <div style={{ fontSize: 10, color: '#334155', marginTop: 2 }}>{ch.mallmann_ref}</div>
              </div>
              <button onClick={() => deleteChild(ci)}
                style={{ fontSize: 12, padding: '1px 6px', borderRadius: 4, border: '1px solid #7f1d1d', background: '#450a0a', color: '#fca5a5', cursor: 'pointer', marginTop: 2 }}>
                ✕
              </button>
            </div>
          ))}

          {/* Add child */}
          {addingChild ? (
            <div style={{ marginTop: 10, padding: '10px', background: '#0f172a', borderRadius: 6, border: '1px dashed #334155' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 13, marginBottom: 8 }}>
                <label style={{ color: '#64748b', fontSize: 11 }}>First
                  <div><input value={newChild.first_name} onChange={e => setNewChild(n => ({ ...n, first_name: e.target.value }))}
                    style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 3, color: '#f1f5f9', padding: '2px 6px', fontSize: 13, width: 90 }} /></div>
                </label>
                <label style={{ color: '#64748b', fontSize: 11 }}>Last
                  <div><input value={newChild.last_name} onChange={e => setNewChild(n => ({ ...n, last_name: e.target.value }))}
                    style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 3, color: '#f1f5f9', padding: '2px 6px', fontSize: 13, width: 90 }} /></div>
                </label>
                <label style={{ color: '#64748b', fontSize: 11 }}>Birth year
                  <div><input type="number" value={newChild.date_of_birth_year || ''} onChange={e => setNewChild(n => ({ ...n, date_of_birth_year: parseInt(e.target.value) || null }))}
                    style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 3, color: '#f1f5f9', padding: '2px 6px', fontSize: 13, width: 68 }} /></div>
                </label>
                <label style={{ color: '#64748b', fontSize: 11 }}>Death year
                  <div><input type="number" value={newChild.date_of_death_year || ''} onChange={e => setNewChild(n => ({ ...n, date_of_death_year: parseInt(e.target.value) || null }))}
                    style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 3, color: '#f1f5f9', padding: '2px 6px', fontSize: 13, width: 68 }} /></div>
                </label>
                <label style={{ color: '#64748b', fontSize: 11 }}>Type
                  <div>
                    <select value={newChild.child_type} onChange={e => setNewChild(n => ({ ...n, child_type: e.target.value }))}
                      style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 3, color: '#f1f5f9', padding: '2px 4px', fontSize: 12 }}>
                      {CHILD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </label>
                <label style={{ color: '#64748b', fontSize: 11 }}>Gender
                  <div>
                    <select value={newChild.gender || ''} onChange={e => setNewChild(n => ({ ...n, gender: e.target.value || null }))}
                      style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 3, color: '#f1f5f9', padding: '2px 4px', fontSize: 12 }}>
                      <option value="">—</option><option value="M">M</option><option value="F">F</option>
                    </select>
                  </div>
                </label>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={addChild} disabled={!newChild.first_name}
                  style={{ fontSize: 12, padding: '4px 12px', borderRadius: 4, border: 'none', background: newChild.first_name ? '#15803d' : '#374151', color: '#fff', cursor: newChild.first_name ? 'pointer' : 'default' }}>
                  Add child
                </button>
                <button onClick={() => setAddingChild(false)}
                  style={{ fontSize: 12, padding: '4px 12px', borderRadius: 4, border: '1px solid #374151', background: 'none', color: '#94a3b8', cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setAddingChild(true)}
              style={{ marginTop: 8, fontSize: 11, padding: '3px 10px', borderRadius: 4, border: '1px dashed #334155', background: 'none', color: '#64748b', cursor: 'pointer', width: '100%' }}>
              + add child
            </button>
          )}
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
  const [enabled, setEnabled] = useState([])
  const [currentFile, setCurrentFile] = useState(0)
  const [extractErrors, setExtractErrors] = useState([])
  const [copied, setCopied] = useState(false)
  const [sql, setSql] = useState('')
  const fileRef = useRef()

  const readAsBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
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
          body: JSON.stringify({ image: base64, mediaType: files[i].type || 'image/jpeg', familyName: familyName.trim(), pageNumber: i + 1 }),
        })
        const data = await resp.json()
        if (!resp.ok) {
          const msg = data.preview
            ? `${data.error} — Claude said: "${data.preview.substring(0, 120)}…"`
            : (data.error || 'API error')
          errors.push({ file: files[i].name, error: msg })
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

  const updateSection = (i, newSection) => setSections(prev => prev.map((s, idx) => idx === i ? newSection : s))
  const toggleSection = (i) => setEnabled(prev => prev.map((v, idx) => idx === i ? !v : v))

  const handleGenSQL = () => {
    const active = sections.filter((_, i) => enabled[i])
    setSql(genSQL(active, familyName))
    setStep('sql')
  }

  const btn = (extra = {}) => ({ padding: '10px 18px', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 14, ...extra })

  // ── Setup ──────────────────────────────────────────────────────────────────
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
            <input value={familyName} onChange={e => setFamilyName(e.target.value)} placeholder="e.g. Hopkins"
              style={{ width: '100%', boxSizing: 'border-box', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, padding: '10px 12px', color: '#f1f5f9', fontSize: 15, marginBottom: 20 }} />
            <label style={{ display: 'block', color: '#94a3b8', fontSize: 13, marginBottom: 6 }}>Page images (JPG)</label>
            <div onClick={() => fileRef.current.click()}
              style={{ border: '2px dashed #334155', borderRadius: 8, padding: '20px 16px', textAlign: 'center', cursor: 'pointer', marginBottom: 20 }}>
              {files.length === 0
                ? <span style={{ color: '#64748b', fontSize: 14 }}>Click to select JPG files — select multiple to batch-process</span>
                : <span style={{ color: '#4ade80', fontSize: 14 }}>{files.length} file{files.length !== 1 ? 's' : ''} selected: {files.map(f => f.name).join(', ')}</span>}
            </div>
            <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
              onChange={e => setFiles(Array.from(e.target.files))} />
            <div style={{ background: '#0f172a', borderRadius: 6, padding: '10px 14px', marginBottom: 20, fontSize: 12, color: '#64748b', lineHeight: 1.6 }}>
              <strong style={{ color: '#94a3b8' }}>Prerequisites:</strong> mallmann_ref column on deceased and consanguineous column on kinship must exist.
              Run <code style={{ color: '#93c5fd' }}>src/admin/migration_mallmann_schema.sql</code> first if not done.
            </div>
            <button onClick={runExtraction} disabled={!files.length || !familyName.trim()}
              style={btn({ background: files.length && familyName.trim() ? '#15803d' : '#374151', color: '#fff', width: '100%' })}>
              Extract {files.length || 0} page{files.length !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Extracting ─────────────────────────────────────────────────────────────
  if (step === 'extracting') {
    return (
      <div style={{ minHeight: '100vh', background: '#0f172a', color: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 36, marginBottom: 16 }}>📖</div>
          <p style={{ color: '#4ade80', fontSize: 18, fontWeight: 600 }}>Extracting page {currentFile + 1} of {files.length}…</p>
          <p style={{ color: '#64748b', fontSize: 14 }}>{files[currentFile]?.name}</p>
          <div style={{ width: 240, height: 6, background: '#1e293b', borderRadius: 3, margin: '16px auto 0' }}>
            <div style={{ height: 6, background: '#15803d', borderRadius: 3, width: `${(currentFile / files.length) * 100}%`, transition: 'width 0.3s' }} />
          </div>
        </div>
      </div>
    )
  }

  // ── Review ─────────────────────────────────────────────────────────────────
  if (step === 'review') {
    const activeCount = enabled.filter(Boolean).length
    return (
      <div style={{ minHeight: '100vh', background: '#0f172a', color: '#f1f5f9', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ background: '#1e293b', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 10 }}>
          <div>
            <h1 style={{ color: '#4ade80', fontWeight: 700, fontSize: 18, margin: 0 }}>Review — {familyName} sections</h1>
            <p style={{ color: '#94a3b8', fontSize: 12, margin: '2px 0 0' }}>
              {activeCount} of {sections.length} sections included · Click any name or year to edit · ✕ to delete · + add child
            </p>
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
            {extractErrors.map((e, i) => <p key={i} style={{ color: '#fca5a5', fontSize: 13, margin: '2px 0' }}>{e.file}: {e.error}</p>)}
          </div>
        )}
        <div style={{ maxWidth: 780, margin: '0 auto', padding: '16px 16px 40px' }}>
          {sections.length === 0
            ? <p style={{ color: '#64748b', textAlign: 'center', marginTop: 40 }}>No sections extracted.</p>
            : sections.map((section, i) => (
              <SectionCard key={i} section={section} familyName={familyName} index={i}
                onToggle={toggleSection} enabled={enabled[i]}
                onUpdate={(newSection) => updateSection(i, newSection)} />
            ))}
        </div>
      </div>
    )
  }

  // ── SQL ────────────────────────────────────────────────────────────────────
  if (step === 'sql') {
    const active = sections.filter((_, i) => enabled[i])
    const personCount = active.reduce((n, s) => n + 1 + (s.spouses?.length ?? 0) + (s.children?.filter(c => c.child_type === 'unnumbered').length ?? 0), 0)
    return (
      <div style={{ minHeight: '100vh', background: '#0f172a', color: '#f1f5f9', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ background: '#1e293b', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ color: '#4ade80', fontWeight: 700, fontSize: 18, margin: 0 }}>Generated SQL</h1>
            <p style={{ color: '#94a3b8', fontSize: 12, margin: '2px 0 0' }}>~{personCount} person upserts · {active.length} sections</p>
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
              <strong style={{ color: '#4ade80' }}>Instructions:</strong> Copy and paste into Supabase SQL editor.
              Idempotent — safe to re-run. Numbered children are referenced by kinship only;
              their deceased rows are inserted when their own section is processed.
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
