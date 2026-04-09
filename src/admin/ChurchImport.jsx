// src/admin/ChurchImport.jsx
// Granite Graph — Church Records & Reference Import Tool
// Drop in src/admin/ and add a route: <Route path="/admin/import" element={<ChurchImport />} />
// Requires /api/extract.js in your Vercel api/ folder

import { useState } from 'react'

const SOURCE_ID_CHURCH = '800c5884-d180-42b0-9ca6-4e05c8fd64cb'
const SOURCE_ID_GENEALOGY = '9cb5c6d4-83b2-4ec6-ae59-72d2d7eb1155'
const CEMETERY_ID = 'd8bd1f88-cdde-4ef2-a448-5ab04d2d8107'

// ── SYSTEM PROMPT ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a genealogy extraction assistant for the Granite Graph project — a social network graph of a historic Long Island community (Church of Christ at Old Man's / Mount Sinai, NY). Your job is to extract every named person AND their relationships from church meeting records.

Return a JSON object with TWO arrays:

"people": array of person objects, each with:
  - "full_name": Title Case (e.g. "Hannah Maria Davis")
  - "first_name", "middle_name" (or null), "last_name"
  - "maiden_name": if mentioned, else null
  - "gender": "M" or "F" or null
  - "event_type": one of: joined, dismissed, excommunicated, reinstated, baptized, died, officer, mentioned
  - "event_date_verbatim": date as written or null
  - "event_year": integer or null
  - "notes": any context (wife of X, deacon, colored woman, captain, etc)

"relationships": array of relationship objects, each with:
  - "person_a": full name of first person (Title Case)
  - "person_b": full name of second person (Title Case)
  - "relationship": one of: SPOUSE, PARENT_OF, CHILD_OF, SIBLING_OF
  - "confidence": "high" or "probable"
  - "evidence": brief note (e.g. "wife of Timothy Miller", "daughter of Samuel and Mariah Hopkins")

Rules:
- Include EVERY named individual, no matter how briefly mentioned
- For "wife of X" entries → create a SPOUSE relationship between both people; include both as separate people entries
- For "son/daughter of X and Y" → create PARENT_OF relationships for each parent and a CHILD_OF for the child
- For bulk reception lists, use that list's date for all members in that list
- Normalize ALL-CAPS names to Title Case
- Return ONLY valid JSON. No markdown fences. No trailing commas. No comments inside JSON.`

// ── CHUNKS: each PDF split in two so responses stay well under token limit ──
const CHUNKS = {
  '1778–1820  Part A  (records to 1805)': {
    sourceId: SOURCE_ID_CHURCH,
    text: `Church of Christ at Old Man's (Mount Sinai), Long Island, NY. Church meeting records 1778-1805.

Joined the church:
- September 5, 1801: THOMAS RULIN joined
- February 6, 1802: NANCY RULIN wife of THOMAS RULIN joined
- April 3, 1802: WELS ROBINSON, RICHARD WOOD, WILLIAM WOODHULL, LUTHER BROWN, KATURA MILLER, RUTH BELLOS, SARAH BELLOS, NANCY RULIN joined
- May 1, 1802: ELIZABETH HELMS, JAMES DAVIS, DOLLY HOPKINS, SARAH HOPKINS joined
- June 5, 1802: TIMOTHY MILLER, MARTHA DAVIS, SALLY RULIN joined; also LILL (black woman) and JULE (black woman)
- July 3, 1802: JOSEPH MILLER, NANCY HAWKINS, LINE HUDSON, JONAH (black man) joined
- July 31, 1802: JANE DAVIS wife of JESSE DAVIS joined
- September 4, 1802: JEMIMA MILLER joined
- October 2, 1802: MEHETABLE MILLER wife of TIMOTHY MILLER joined; ANNA GAROD wife of JOSEPH GAROD joined; ELIZAR BELLAS joined
- February 2, 1805: JOHATHAN HALLOCK and his wife joined

Officers and Ministers:
- NOAH HALLOCK: Pastor (died October 25, 1818, had been pastor 29 years)
- SAMUEL HOPKINS: appointed Deacon May 3, 1800
- JEFFREY WOODHULL: Deacon
- TIMOTHY DAVIS: mentioned in meetings 1799-1800
- PHILLIP HALLOCK: Deacon (mentioned)
- JONATHAN HALLOCK: mentioned in meetings

Notable meetings:
- November 30, 1799: Deacon BROWN and Deacon WOODHULL appointed to inquire after JERIMIAH KINNER; SAMUEL HOPKINS and TIMOTHY DAVIS appointed to inquire after JOHN HILL
- November 1, 1800: Pastor NOAH HALLOCK, JEFFERY WOODHULL, PHILLIP HALLOCK, TIMOTHY DAVIS, SAMUEL HOPKINS appointed to visit JOSEPH DAVIS and his wife
- January 22, 1801: JOSEPH DAVIS and Deacon WOODHULL reconciled; JOSEPH DAVIS and his wife reconciled with church
- March 2, 1805: TIMOTHY MILLER and SAMUEL HOPKINS appointed to visit JOSIAH HALLOCK; PHILLIP HALLOCK and JONATHAN HALLOCK appointed to visit NANCY RULIN and her daughter NANCY`
  },

  '1778–1820  Part B1  (1809 reception list)': {
    sourceId: SOURCE_ID_CHURCH,
    text: `Church of Christ at Old Man's (Mount Sinai), Long Island, NY.

April 11, 1807: HINDRICK HALLOCK joined the church

Large reception March 4, 1809 — all of the following joined:
MERRIDAY HAVEN, RICHARD DAVIS (Captain), PHILIP BROWN, JOHN DAVIS, ELISHA DAVIS, EVI SMITH (later excommunicated), JESSE DAVIS, ELISHA PETTA, JOEL NOTON, SAMUEL DAVIS, DAVID ROBBINS, DANIEL DAVIS, WILLIAM PHILLIPS, EBENEZER JONES, GEORGE HOPKINS, ASSENETH ROBBINS, JOEL PETTA, MARY TUCKER, HANNAH WELLS, NANCY NORTON, ELIZABETH BROWN, HANNAH PHILLIPS, SARA PHILLIPS, CLAREAVEA NORTON, CHARLOTTE DAVIS, HANNAH BROWN, MEHEATABLE ALLEBEAN, ELIZABETH DAVIS, ELIZA WOODHULL, MERIA DAVIS, GEORGE DAVIS, WILLIAM HOPKINS, ELIZABETH PHILLIPS, NICOLS TERREL (excommunicated 1812), HENERY CONKLIN, BILLY DAVIS

Note: this is a bulk reception list. No spouse or family relationships are known for these individuals from this record alone. Event type for all is "joined", date is "March 4, 1809".`
  },

  '1778–1820  Part B2  (1809–1810 other joiners)': {
    sourceId: SOURCE_ID_CHURCH,
    text: `Church of Christ at Old Man's (Mount Sinai), Long Island, NY. 1809-1810.

April 1, 1809: MEHEATABLE DAVIS joined
May 6, 1809: JAMES NORTON, DAVIS NORTON, THOMAS TUCKER, SARA HALLET, RACHEL SMITH, POLLEY HALLOCK joined
September 2, 1809: MRS SMITH wife of WOODHULL SMITH joined
September 30, 1809: ABIGALE BENNIT wife of ISRAEL BENNIT joined; CATHERINE BROWN wife of LUTHER BROWN joined; JULIANEN PITTY wife of BENJAMIN PETTY joined; HULDAY ROE joined
April 2, 1808: SISTER DINAH joined
April 30, 1808: GAETCH (black woman) joined
June 1, 1810: FANNY PRINCE received and baptized; BETTY wife of LITUS (black man) joined
July 1, 1810: MRS PHEBE TOOKER wife of LEVI TOOKER joined
August 4, 1810: NANCY RUGGLES (widow) joined

Officers appointed January 1, 1808:
- TIMOTHY MILLER: appointed Deacon
- PHILLIP HALLOCK: appointed Deacon
- HENDRICKSON W. HALLOCK: appointed Clerk
- JOHN DAVIS: elected Clerk August 5, 1809`
  },

  '1778–1820  Part B2  (1811–1820)': {
    sourceId: SOURCE_ID_CHURCH,
    text: `Church of Christ at Old Man's (Mount Sinai), Long Island, NY. 1811-1820.

November 2, 1811: BETSY HALLOCK wife of JONAS HALLOCK joined
February 1, 1811: JEREMIAH KINNER returned to fellowship (reinstated)
March 3, 1810: MRS HALLOCK wife of HALLOCK joined
September 6, 1817: DENCY REYNOR, BETHIAN HALLOCK, CALVIN EATON received into fellowship
December 6, 1817: NOAH H. GILLET received as member (later ordained minister)
May 2, 1818: AMELIA (black woman) joined
February 28, 1818: ABIATHER BROWN joined; BETHIAH WELLS joined
October 25, 1818: NOAH HALLOCK died (had been pastor 29 years)

Dismissed:
- HULDAH ROE requested dismissal to Methodist Church March 5, 1813

Excommunicated:
- NICOLS TERREL excommunicated 1812`
  },

  '1820–1829  Part A  (1820–1824)': {
    sourceId: SOURCE_ID_CHURCH,
    text: `Church of Christ at Old Man's (Mount Sinai), Long Island, NY. 1820-1824.

Joined / received into fellowship:
- August 4, 1821: PATTY MILLER and HETTA MINOR united with church
- August 4, 1821: HANNAH M. GILLET wife of NOAH H. GILLET received by letter from church of Middler Island
- May 5, 1821: JOANNE DAVIS wife of DANIEL DAVIS joined; ABIGAIL HOPKINS wife of WILLIAM HOPKINS joined
- March 31, 1821: MARY HALLOCK wife of HENRY HALLOCK returned to full fellowship
- February 1, 1823: NATHANIEL DAVIS and JULIA ANN PETTY received into union with the church
- January 31, 1824: MRS HULDAH NORTON received into communion and fellowship

Dismissed:
- December 23, 1820: POLLY HALLOCK wife of HENRY HALLOCK dismissed to Methodist Church at Stony Brook
- September 2, 1820: WILLIAM WOODHULL dismissed to Presbyterian Church New York Rutgers Street

Excommunicated:
- June 1, 1822: JOSIAH HALLOCK excommunicated (letter signed NOAH H. GILLET Pastor)
- August 6, 1823: BETHIAH DAVIS excommunicated
- October 9, 1824: JULIA (colored woman) excommunicated

Officers:
- NOAH H. GILLET: Pastor/Minister (ordained as Evangelist December 23, 1820)
- PHILLIP HALLOCK: Deacon
- SAMUEL DAVIS: Deacon
- TIMOTHY MILLER: Deacon
- DANIEL DAVIS: Deacon (died before October 3, 1829)`
  },

  '1820–1829  Part B  (1825–1829)': {
    sourceId: SOURCE_ID_CHURCH,
    text: `Church of Christ at Old Man's (Mount Sinai), Long Island, NY. 1825-1829.

Excommunicated:
- February 5, 1825: MRS BETSEY EDWARDS fellowship withdrawn

Large reception April 8, 1826:
JAMES DAVIS, HANNAH R. DAVIS, NOAH ROBBINSON, MARY BREWSTER, MARIA PAYNE, CLARISSA WOOD, LEWIS DAVIS, JAMES OVERTON, MARGARET HALLOCK, ERVERLINE FINCH, ELEANOR TERRY

Large reception May 20, 1826:
SARAH ROBBINS, POLLY MILLER, MARIA HALLOCK, ELUISE WELLS, SALLY W. HOMAN, CHARRY TOOKER, ANN DAVIS, CAROLIN MILLER, ELIZA CATHARINE MILLER, SOPHRONIA BROWN, CONKLIN DAVIS, MARIA KINNER, MARY DAVIS, SARAH HOWELL, SARAH HALLOCK, DANIEL R. MILLER, RUTH DAVIS, RICHARD M. WOOD, AUSTIN RAYNOR, CORINNA MILLER, LOUISA HALLOCK, CHARRY BROWN, CATHERINE TYLER, HANNAH SATERLY, HANNAH PETTY, ABBA SOPHIA CORWIN (died April 20, 1838), CHARLES MILLER, WILLIAM M. BROWN, ELIZA DAVIS, ELISA HUDSON, CATHARINE GERARD, GILBERT HOPKINS, POLLY BROWN, HENDRICH H. HALLOCK, ELIZABETH DAVIS, JOEL WOOD, GERSHORN BROWN, SANFORD DAVIS

July 15, 1826: ARMINDA BAILEY, SAPPING NORTON, CHARLES T. JONES, JOEL BROWN, MARIA HALLOCK, ROBBIN, DORCAS, MARY, MARTHA SIMON joined
July 16, 1826: MARIA HOPKINS, ELIZA DAVIS, CAROLINE HALLOCK, CHARITY BAILEY, LUCINDA NORTON joined
September 23, 1826: TABETHA JONES received
December 3, 1826: HENRY T. GUNDERSON, MARY ANN GUNDERSON, ABBIGAIL WILSE, ARMINDA BELLOWS, ELEANOR DAVIS joined; SALLY NORTON received by letter from church in Greenfield Connecticut
February 10, 1827: ISAAC BROWN, CALEB KINNER received
April 7, 1827: ELISABETH JAYNE received; SALLY MILLER received by letter from Presbyterian church at Huntington
May 19, 1827: CHARLES ROBINSON, SARAH ANN ROBINSON, AZEAL ROE, MRS ROE wife of AZEL ROE, AMELIA KINNER joined
October 3, 1829: JNO BROWN and wife PHEBE M. received by letter

Baptisms (children):
- April 19, 1829: LOUISA daughter of SAMUEL HOPKINS and MARIAH HOPKINS baptized
- July 26, 1829: JOSEPH AUGUSTUS son of ISAAC BROWN and CHARITY BROWN baptized
- July 26, 1829: ELIZA LUCRETIA daughter of ISAAC BROWN and CHARITY BROWN baptized
- July 26, 1829: SOPHRONIA daughter of ISAAC BROWN and CHARITY BROWN baptized
- July 26, 1829: MARY ELIZABETH daughter of ISAAC BROWN and CHARITY BROWN baptized

Dismissed:
- September 21, 1828: HETTA MINER dismissed to church at Lime Connecticut

Officers:
- November 20, 1826: SAMUEL HOPKINS appointed Clerk`
  },

  '1829–1839  Part A  (1829–1833)': {
    sourceId: SOURCE_ID_CHURCH,
    text: `Church of Christ at Old Man's (Mount Sinai), Long Island, NY. 1829-1833.

Deaths:
- January 1, 1830: RICHARD DAVIS died
- April 2, 1831: TIMOTHY MILLER deceased (his deacon office now vacant)
- January 6, 1833: PHILLIP BROWN — funeral preached at meeting house by Mr GILLET

Officers elected:
- January 23, 1830: DAVID ROBBINS elected Deacon by ballot (10 of 21 votes cast)
- April 2, 1831: CHARLES MILLER elected Deacon by ballot (7 votes)

April 28, 1832 joined: HANNAH NORTON wife of TIMOTHY NORTON, SARAH ANN HUTCHINSON, REBECCA CARTER, CHARRY SMITH, BETSEY CONKLING, CHARLOTTE BELLOWS, HULDAH WELLS wife of MARTIN WELLS, CHARLES LOYD BAYLES

June 7, 1832 joined: DOLLY BAILEY, CAROLINE BAILEY, MARTHA BELL, CLARISSA ROE, CATHARINE JONES, HARRIOT NORTON

July 21, 1832 joined: ABIATHER LIRRARD, ISAAC JONES, DANIEL BROWER, LUCRETTA (colored woman)

February 5, 1832 joined: MRS MARTHA BROWN received by letter from Rutgers Street church; MRS SARAH M. CARTER received

November 24, 1832: CHARITY DAVIS returned to full fellowship (reinstated)
March 30, 1833: ALMA WILLS restored to fellowship (reinstated)

Officers / Ministers:
- NOAH H. GILLET: Pastor continues
- SAMUEL HOPKINS: Clerk
- DAVID ROBBINS: Deacon
- CHARLES MILLER: Deacon
- JOHN STOCKER: Moderator (appears December 7, 1833)

Dismissed:
- October 13, 1832: JEFFREY A. WOODHULL and ELIZABETH his wife dismissed to church at Fresh Ponds

Excommunicated:
- May 15, 1830: ELISHA DAVIS excommunicated
- May 15, 1830: ABBY HOPKINS cut off from church (daughter, mentioned alongside SAMUEL DAVIS)
- November 12, 1831: JOHN DAVIS excommunicated
- September 1, 1832: JAMES DAVIS excommunicated
- January 20, 1833: DANIEL T. NORTON excommunicated`
  },

  '1829–1839  Part B  (1834–1839)': {
    sourceId: SOURCE_ID_CHURCH,
    text: `Church of Christ at Old Man's (Mount Sinai), Long Island, NY. 1834-1839.

Excommunicated / fellowship withdrawn:
- September 19, 1833: GERSHAM BROWN excommunicated
- October 3, 1835: SANFORD DAVIS fellowship withdrawn
- October 3, 1835: ALMA WELLS fellowship withdrawn
- January 25, 1835: CONKLIN DAVIS and wife ELIZABETH DAVIS withdrew themselves

Reinstated:
- May 11, 1833: SAMUEL DAVIS restored to fellowship; WM HOPKINS restored
- August 10, 1833: RUTH HALLOCK restored to full fellowship; DAVID ROBBINS restored to full fellowship

April 2, 1836 received: FANNY JONES wife of CHARLES S. JONES (by letter from Dutch Reformed Church Tarrytown Westchester County); SAMUEL BROWN; DELIVERANCE BROWN wife of SAML BROWN; JOHN MERIT BROWN

March 3, 1838: ADELIA wife of NOAH H. JONES received
March 31, 1838: MEHETABLE wife of CALVIN EATON; ANNE wife of JONATHAN PIKE; SUSAN M. widow of SIMEON DAVIS received

May 26, 1838: HANNAH H. WOODHULL (by letter), HENRY HALLOCK, JOHN H. WOODHULL, FANNY M. DAVIS, DEBORAH M. BROWN, ABIGAIL REEVE joined

June 2, 1838: MARTHA O. MILLS (now MILLER), BETHIAH HAWKINS (by letter), EDWIN N. MILLER, SYLVESTER R. DAVIS, GEORGE W. BROWN, JAMES HALLOCK son of PHILIP HALLOCK, CALEB H. KING, CATHARINE O. HOPKINS, ELMINA wife of SYLVESTER R. DAVIS joined

August 4, 1838: REBECCA HALLOCK wife of HENDRICK H. HALLOCK, JOANNA BROWN, MARY ANN TOOKER, JANE ANN EATON joined; FANNY PRINCE restored to fellowship

December 1, 1838: HANNAH A. HALLOCK united with the church

February 2, 1839: JOSIAH SATTERLY, JOHN HENRY BESIN, CATHARINE CORDELIA wife of JOHN HENRY BESIN joined

April 5, 1839: MR THOMAS HELME; MRS SUSAN HELME wife of THOMAS HELME (by letter from Presbyterian Church Setauket); WM O. AYERS (by letter from Yale College Church New Haven CT) joined

June 2, 1839: LAURA C. KINNERS, MARY HOPKINS received
August 31, 1839: MINEUS LYMAN received

Officers:
- REV PARSHALL TERRY: Minister/Pastor (from 1834)
- REV E. PLATT: Minister/Pastor (from 1838)
- JOEL BROWN: Deacon elected July 6, 1839 (Rocky Point area)
- CHARLES I. JONES: Deacon elected July 6, 1839 (Drown-meadow area)

Deaths:
- November 3, 1838: JEREMIAH KINNER died (no meeting held on account of his funeral)
- ABBA SOPHIA CORWIN died April 20, 1838`
  },
}

// ── EVENT / RELATIONSHIP COLOURS ────────────────────────────────────────────
const EC = {
  joined: '#15803d', dismissed: '#b45309', excommunicated: '#b91c1c',
  reinstated: '#0369a1', baptized: '#6d28d9', died: '#374151',
  officer: '#0f766e', mentioned: '#9ca3af',
}
const RC = {
  SPOUSE: '#15803d', PARENT_OF: '#0369a1', CHILD_OF: '#6d28d9', SIBLING_OF: '#b45309',
}

// ── HELPERS ──────────────────────────────────────────────────────────────────
const esc = (s) => (s || '').replace(/'/g, "''")
const q   = (s) => (s != null && s !== '') ? `'${esc(String(s))}'` : 'NULL'

function genSQL(chunkKey, result) {
  const chunk = CHUNKS[chunkKey]
  const srcId = chunk.sourceId

  const peopleRows = result.people
    .filter(p => p._keep)
    .map(p =>
      `  (${q(p.first_name)}, ${q(p.middle_name)}, ${q(p.last_name)}, ${q(p.maiden_name)}, ` +
      `${q(p.gender)}, '${CEMETERY_ID}', '${srcId}', ` +
      `${q(p.event_type)}, ${q(p.event_date_verbatim)}, ${p.event_year || 'NULL'}, ${q(p.notes)})`
    )

  const relComments = result.relationships
    .filter(r => r._keep)
    .map(r => `-- ${r.person_a}  ${r.relationship}  ${r.person_b}  [${r.confidence}]  ${r.evidence || ''}`)

  return [
    `-- Granite Graph Church Records — ${chunkKey}`,
    `-- Generated ${new Date().toISOString().split('T')[0]}`,
    `-- ${result.people.filter(p => p._keep).length} people, ${result.relationships.filter(r => r._keep).length} relationships`,
    '',
    '-- STEP 1: Run this migration once (add columns if they do not exist yet)',
    'ALTER TABLE deceased',
    '  ADD COLUMN IF NOT EXISTS source_id uuid,',
    '  ADD COLUMN IF NOT EXISTS church_event_type text,',
    '  ADD COLUMN IF NOT EXISTS church_event_date_verbatim text,',
    '  ADD COLUMN IF NOT EXISTS church_event_year integer,',
    '  ADD COLUMN IF NOT EXISTS notes text;',
    '',
    '-- STEP 2: Insert people',
    'INSERT INTO deceased',
    '  (first_name, middle_name, last_name, maiden_name, gender, cemetery_id, source_id,',
    '   church_event_type, church_event_date_verbatim, church_event_year, notes)',
    'VALUES',
    peopleRows.join(',\n'),
    'ON CONFLICT DO NOTHING;',
    '',
    '-- STEP 3: Relationship pairs (use these to populate kinship table after matching deceased_ids)',
    '-- INSERT INTO kinship (primary_deceased_id, relative_deceased_id, relationship_type, source, confidence)',
    '-- VALUES (...);',
    '',
    ...relComments,
    '',
    `-- Verify: SELECT COUNT(*) FROM deceased WHERE source_id = '${srcId}';`,
  ].join('\n')
}

// ── COMPONENT ────────────────────────────────────────────────────────────────
export default function ChurchImport() {
  const [step, setStep]           = useState('select')   // select | extract | review | sql
  const [chunkKey, setChunkKey]   = useState('')
  const [extracting, setExtracting] = useState(false)
  const [result, setResult]       = useState(null)       // { people[], relationships[] }
  const [error, setError]         = useState(null)
  const [tab, setTab]             = useState('people')   // people | rels
  const [filter, setFilter]       = useState('')
  const [filterType, setFilterType] = useState('all')
  const [copied, setCopied]       = useState(false)
  const [editId, setEditId]       = useState(null)
  const [editData, setEditData]   = useState(null)

  // ── Extract ────────────────────────────────────────────────────────────────
  const extract = async () => {
    const chunk = CHUNKS[chunkKey]
    if (!chunk) return
    setExtracting(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: chunk.text, system: SYSTEM_PROMPT }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error.message || data.error)
      const rawText = (data.content || [])
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('')
      const clean  = rawText.replace(/```json|```/g, '').trim()
      const parsed = JSON.parse(clean)
      const people = (parsed.people || []).map((p, i) => ({ ...p, _id: i, _keep: true }))
      const rels   = (parsed.relationships || []).map((r, i) => ({ ...r, _id: i, _keep: true }))
      setResult({ people, relationships: rels })
      setStep('review')
    } catch (e) {
      setError('Extraction error: ' + e.message)
    }
    setExtracting(false)
  }

  // ── Toggles / edit ─────────────────────────────────────────────────────────
  const togglePerson = id => setResult(r => ({ ...r, people: r.people.map(p => p._id === id ? { ...p, _keep: !p._keep } : p) }))
  const toggleRel    = id => setResult(r => ({ ...r, relationships: r.relationships.map(x => x._id === id ? { ...x, _keep: !x._keep } : x) }))
  const startEdit    = p  => { setEditId(p._id); setEditData({ ...p }) }
  const saveEdit     = () => {
    setResult(r => ({ ...r, people: r.people.map(p => p._id === editId ? { ...editData } : p) }))
    setEditId(null); setEditData(null)
  }

  // ── Derived ────────────────────────────────────────────────────────────────
  const keptPeople = result ? result.people.filter(p => p._keep).length : 0
  const keptRels   = result ? result.relationships.filter(r => r._keep).length : 0
  const eventTypes = result ? [...new Set(result.people.map(p => p.event_type).filter(Boolean))] : []

  const filteredPeople = result ? result.people.filter(p => {
    const mf = filter === '' || (p.full_name || '').toLowerCase().includes(filter.toLowerCase()) || (p.notes || '').toLowerCase().includes(filter.toLowerCase())
    const mt = filterType === 'all' || p.event_type === filterType
    return mf && mt
  }) : []

  const filteredRels = result ? result.relationships.filter(r =>
    filter === '' ||
    (r.person_a || '').toLowerCase().includes(filter.toLowerCase()) ||
    (r.person_b || '').toLowerCase().includes(filter.toLowerCase())
  ) : []

  // ── Shared styles ──────────────────────────────────────────────────────────
  const card = {
    background: '#1f2937', border: '1px solid #374151',
    borderRadius: 8, padding: '12px 14px', marginBottom: 8,
  }
  const btn = (extra = {}) => ({
    padding: '10px 14px', borderRadius: 6, cursor: 'pointer',
    fontWeight: 600, fontSize: 13, border: 'none', ...extra,
  })
  const badge = (color) => ({
    fontSize: 11, padding: '2px 8px', borderRadius: 99,
    background: color + '22', color, fontWeight: 600,
  })

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: '#111827', color: '#f9fafb', padding: '24px 16px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#34d399', margin: '0 0 4px' }}>
            Granite Graph — Church Records Import
          </h1>
          <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>
            Extract people &amp; relationships from historical church meeting records
          </p>
        </div>

        {/* ── SELECT ── */}
        {step === 'select' && (
          <div>
            <p style={{ color: '#9ca3af', fontSize: 13, marginBottom: 16 }}>
              Each PDF is split into two chunks to stay well within the token limit. Extract all 6 chunks, then run the SQL in Supabase.
            </p>
            {Object.keys(CHUNKS).map(key => (
              <div key={key} onClick={() => { setChunkKey(key); setStep('extract'); setResult(null); setError(null) }}
                style={{ ...card, cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={badge('#34d399')}>{CHUNKS[key].sourceId === SOURCE_ID_CHURCH ? 'Church' : 'Genealogy'}</span>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{key}</span>
                </div>
              </div>
            ))}
            <div style={{ ...card, marginTop: 24, background: '#0f172a' }}>
              <p style={{ fontWeight: 600, fontSize: 13, margin: '0 0 6px', color: '#94a3b8' }}>Source IDs</p>
              <p style={{ fontSize: 11, fontFamily: 'monospace', color: '#64748b', margin: '0 0 3px' }}>
                Church records: {SOURCE_ID_CHURCH}
              </p>
              <p style={{ fontSize: 11, fontFamily: 'monospace', color: '#64748b', margin: 0 }}>
                Shelter Island Genealogy: {SOURCE_ID_GENEALOGY}
              </p>
            </div>
          </div>
        )}

        {/* ── EXTRACT ── */}
        {step === 'extract' && (
          <div>
            <button onClick={() => setStep('select')} style={btn({ background: 'transparent', color: '#9ca3af', padding: '0 0 16px' })}>
              ← Back
            </button>
            <div style={card}>
              <p style={{ fontWeight: 600, fontSize: 15, margin: '0 0 6px', color: '#f9fafb' }}>{chunkKey}</p>
              <p style={{ fontSize: 13, color: '#9ca3af', margin: '0 0 12px' }}>
                Extracts all named people AND relationship pairs (spouses, parents, children).
              </p>
              <pre style={{ fontSize: 11, fontFamily: 'monospace', color: '#6b7280', background: '#0f172a', padding: 10, borderRadius: 6, maxHeight: 180, overflow: 'auto', whiteSpace: 'pre-wrap', margin: 0 }}>
                {CHUNKS[chunkKey].text.slice(0, 500)}…
              </pre>
            </div>
            <button onClick={extract} disabled={extracting}
              style={btn({ width: '100%', background: extracting ? '#374151' : '#15803d', color: extracting ? '#9ca3af' : '#fff', marginTop: 8 })}>
              {extracting ? 'Extracting people & relationships…' : 'Extract People + Relationships'}
            </button>
            {error && <p style={{ color: '#f87171', fontSize: 13, marginTop: 10 }}>{error}</p>}
          </div>
        )}

        {/* ── REVIEW ── */}
        {step === 'review' && result && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <button onClick={() => setStep('extract')} style={btn({ background: 'transparent', color: '#9ca3af', padding: 0 })}>← Re-extract</button>
              <span style={{ fontSize: 13, color: '#6b7280' }}>{keptPeople} people · {keptRels} rels selected</span>
            </div>

            {/* Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 16 }}>
              {[
                { l: 'People extracted', v: result.people.length },
                { l: 'Relationships', v: result.relationships.length },
                { l: 'For import', v: `${keptPeople}p / ${keptRels}r` },
              ].map(m => (
                <div key={m.l} style={{ background: '#1f2937', borderRadius: 6, padding: '10px 12px' }}>
                  <p style={{ fontSize: 11, color: '#6b7280', margin: '0 0 3px' }}>{m.l}</p>
                  <p style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#f9fafb' }}>{m.v}</p>
                </div>
              ))}
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              {['people', 'rels'].map(t => (
                <button key={t} onClick={() => setTab(t)}
                  style={btn({ background: tab === t ? '#374151' : 'transparent', color: tab === t ? '#f9fafb' : '#6b7280', border: '1px solid ' + (tab === t ? '#4b5563' : 'transparent'), fontSize: 13 })}>
                  {t === 'people' ? `People (${result.people.length})` : `Relationships (${result.relationships.length})`}
                </button>
              ))}
            </div>

            {/* Filter row */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <input placeholder='Filter by name…' value={filter} onChange={e => setFilter(e.target.value)}
                style={{ flex: 1, background: '#374151', border: '1px solid #4b5563', borderRadius: 6, padding: '8px 10px', color: '#f9fafb', fontSize: 13 }} />
              {tab === 'people' && (
                <select value={filterType} onChange={e => setFilterType(e.target.value)}
                  style={{ background: '#374151', border: '1px solid #4b5563', borderRadius: 6, padding: '8px 10px', color: '#f9fafb', fontSize: 13 }}>
                  <option value='all'>All types</option>
                  {eventTypes.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              )}
            </div>

            <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
              {tab === 'people' ? filteredPeople.length : filteredRels.length} shown — uncheck to exclude from import
            </p>

            {/* People list */}
            {tab === 'people' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 460, overflowY: 'auto' }}>
                {filteredPeople.map(person => (
                  <div key={person._id} style={{ ...card, opacity: person._keep ? 1 : 0.4, marginBottom: 0 }}>
                    {editId === person._id ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                          {['first_name', 'middle_name', 'last_name'].map(f => (
                            <input key={f} value={editData[f] || ''} placeholder={f.replace('_', ' ')}
                              onChange={e => setEditData(p => ({ ...p, [f]: e.target.value }))}
                              style={{ background: '#374151', border: '1px solid #4b5563', borderRadius: 4, padding: '6px 8px', color: '#f9fafb', fontSize: 12 }} />
                          ))}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                          <input value={editData.maiden_name || ''} placeholder='Maiden name'
                            onChange={e => setEditData(p => ({ ...p, maiden_name: e.target.value }))}
                            style={{ background: '#374151', border: '1px solid #4b5563', borderRadius: 4, padding: '6px 8px', color: '#f9fafb', fontSize: 12 }} />
                          <select value={editData.event_type || ''} onChange={e => setEditData(p => ({ ...p, event_type: e.target.value }))}
                            style={{ background: '#374151', border: '1px solid #4b5563', borderRadius: 4, padding: '6px 8px', color: '#f9fafb', fontSize: 12 }}>
                            {['joined', 'dismissed', 'excommunicated', 'reinstated', 'baptized', 'died', 'officer', 'mentioned'].map(t => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                        </div>
                        <input value={editData.event_date_verbatim || ''} placeholder='Date verbatim'
                          onChange={e => setEditData(p => ({ ...p, event_date_verbatim: e.target.value }))}
                          style={{ background: '#374151', border: '1px solid #4b5563', borderRadius: 4, padding: '6px 8px', color: '#f9fafb', fontSize: 12 }} />
                        <input value={editData.notes || ''} placeholder='Notes'
                          onChange={e => setEditData(p => ({ ...p, notes: e.target.value }))}
                          style={{ background: '#374151', border: '1px solid #4b5563', borderRadius: 4, padding: '6px 8px', color: '#f9fafb', fontSize: 12 }} />
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button onClick={saveEdit} style={btn({ flex: 1, background: '#15803d', color: '#fff', fontSize: 12 })}>Save</button>
                          <button onClick={() => { setEditId(null); setEditData(null) }}
                            style={btn({ flex: 1, background: 'transparent', border: '1px solid #4b5563', color: '#9ca3af', fontSize: 12 })}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                        <input type='checkbox' checked={person._keep} onChange={() => togglePerson(person._id)} style={{ marginTop: 3, flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 600, fontSize: 14 }}>{person.full_name}</span>
                            {person.event_type && <span style={badge(EC[person.event_type] || '#9ca3af')}>{person.event_type}</span>}
                            {person.gender && <span style={{ fontSize: 11, color: '#6b7280' }}>{person.gender}</span>}
                          </div>
                          {person.event_date_verbatim && <p style={{ fontSize: 12, color: '#9ca3af', margin: '2px 0 0' }}>{person.event_date_verbatim}</p>}
                          {person.notes && <p style={{ fontSize: 12, color: '#9ca3af', margin: '2px 0 0' }}>{person.notes}</p>}
                        </div>
                        <button onClick={() => startEdit(person)}
                          style={btn({ fontSize: 11, padding: '3px 8px', background: 'transparent', border: '1px solid #374151', color: '#6b7280' })}>
                          Edit
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Relationships list */}
            {tab === 'rels' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 460, overflowY: 'auto' }}>
                {filteredRels.map(rel => (
                  <div key={rel._id} style={{ ...card, opacity: rel._keep ? 1 : 0.4, marginBottom: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <input type='checkbox' checked={rel._keep} onChange={() => toggleRel(rel._id)} style={{ marginTop: 3, flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 600, fontSize: 14 }}>{rel.person_a}</span>
                          <span style={badge(RC[rel.relationship] || '#9ca3af')}>{rel.relationship}</span>
                          <span style={{ fontWeight: 600, fontSize: 14 }}>{rel.person_b}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 10, marginTop: 3 }}>
                          <span style={{ fontSize: 11, color: '#6b7280' }}>{rel.confidence}</span>
                          {rel.evidence && <span style={{ fontSize: 11, color: '#4b5563' }}>{rel.evidence}</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <button onClick={() => setStep('sql')}
              style={btn({ width: '100%', background: '#15803d', color: '#fff', marginTop: 16 })}>
              Generate SQL ({keptPeople} people, {keptRels} relationships)
            </button>
          </div>
        )}

        {/* ── SQL ── */}
        {step === 'sql' && result && (
          <div>
            <button onClick={() => setStep('review')} style={btn({ background: 'transparent', color: '#9ca3af', padding: '0 0 16px' })}>
              ← Back to review
            </button>
            <div style={{ ...card, background: '#0f172a', marginBottom: 16 }}>
              <p style={{ fontWeight: 600, fontSize: 14, margin: '0 0 8px', color: '#94a3b8' }}>Workflow</p>
              <ol style={{ fontSize: 13, color: '#6b7280', margin: 0, paddingLeft: 20, lineHeight: 2 }}>
                <li>Run the migration block once in Supabase SQL editor</li>
                <li>Run the INSERT for this chunk, repeat for all 6 chunks</li>
                <li>The relationship comments at the bottom show the pairs to add to <code>kinship</code> after you match deceased_ids</li>
                <li>For Shelter Island Genealogy use the same tool — source_id is already set per chunk</li>
              </ol>
            </div>
            <pre style={{
              fontSize: 11, fontFamily: 'monospace', background: '#0f172a', padding: 14,
              borderRadius: 8, overflow: 'auto', maxHeight: 420, color: '#d1d5db',
              border: '1px solid #1f2937', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: '0 0 12px',
            }}>
              {genSQL(chunkKey, result)}
            </pre>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => { navigator.clipboard.writeText(genSQL(chunkKey, result)); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
                style={btn({ flex: 1, background: copied ? '#15803d' : '#1f2937', border: '1px solid #374151', color: copied ? '#fff' : '#f9fafb' })}>
                {copied ? 'Copied!' : 'Copy SQL'}
              </button>
              <button onClick={() => { setStep('select'); setResult(null); setChunkKey('') }}
                style={btn({ background: 'transparent', border: '1px solid #374151', color: '#6b7280' })}>
                Next chunk
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
