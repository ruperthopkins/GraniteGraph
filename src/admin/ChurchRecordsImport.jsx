import { useState, useRef } from "react"

const CEMETERY_ID = "d8bd1f88-cdde-4ef2-a448-5ab04d2d8107"
const SOURCE_ID = "800c5884-d180-42b0-9ca6-4e05c8fd64cb"

const PDF_TEXTS = {
  "MSCC10051778_2051820 (1778–1820)": `October 5, 1799 through July 4, 1807. Church of Christ at Old Mans (Old Man's / Mount Sinai), Long Island, NY.

People mentioned joining the church (received into fellowship/communion):
- THOMAS RULIN joined September 5, 1801
- NANCY RULIN wife of THOMAS RULIN joined February 6, 1802
- WELS ROBINSON, RICHARD WOOD, WILLIAM WOODHULL, LUTHER BROWN, KATURA MILLER, RUTH BELLOS, SARAH BELLOS, NANCY RULIN joined April 3, 1802
- ELIZABETH HELMS, JAMES DAVIS, DOLLY HOPKINS, SARAH HOPKINS joined May 1, 1802
- TIMOTHY MILLER, MARTHA DAVIS, SALLY RULIN, LILL (black woman), JULE (black woman) joined June 5, 1802
- JOSEPH MILLER, NANCY HAWKINS, LINE HUDSON, JONAH (black man) joined July 3, 1802
- JANE DAVIS wife of JESSE DAVIS joined July 31, 1802
- JEMIMA MILLER joined September 4, 1802
- MEHETABLE MILLER wife of TIMOTHY MILLER, ANNA GAROD wife of JOSEPH GAROD, ELIZAR BELLAS joined October 2, 1802
- JOHATHAN HALLOCK and his wife joined February 2, 1805
- HINDRICK HALLOCK joined April 11, 1807

Additional members received March 4, 1809:
MERRIDAY HAVEN, RICHARD DAVIS (CAPT.), PHILIP BROWN, JOHN DAVIS, ELISHA DAVIS, EVI SMITH (was excommunicated), JESSE DAVIS, ELISHA PETTA, JOEL NOTON, SAMUEL DAVIS, DAVID ROBBINS, DANIEL DAVIS, WILLIAM PHIULLIPS, EBENEZER JONES, GEORGE HOPKINS, ASSENETH ROBBINS, JOEL PETTA, MARY TUCKKER, HANNAH WELLS, NANCY NORTON, ELIZABETH BROWN, HANNAH PHILLIPS, SARA PHILLIPS, CLAREAVEA NORTON, CHARLOTTE DAVIS, HANNAH BROWN, MEHEATABLE ALLEBEAN, ELIZABETH DAVIS, ELIZA WOODHULL, MERIA DAVIS, GEORGE DAVIS, WILLIAM HOPKINS, ELIZABETH PHILLIPS, NICOLS TERREL (in 1812 was excommunicated), HENERY CONKLIN, BILLY DAVIS

Also joined:
- MEHEATABLE DAVIS joined April 1, 1809
- JAMES NORTON, DAVIS NORTON, THOMAS TUCKKER, SARA HALLET, RACHEL SMITH, POLLEY HALLOCK joined May 6, 1809
- MRS SMITH wife of WOODHULL SMITH joined September 2, 1809
- ABIGALE BENNIT wife of ISRAEL BENNIT, CATHERINE BROWN wife of LUTHER BROWN, JULIANEN PITTY wife of BENJAMIN PETTY, HULDAY ROE joined September 30, 1809
- FANNY PRINCE received and baptized June 1, 1810
- BETTY wife of LITUS (black man) joined June 1, 1810
- MRS. PHEBE TOOKER wife of LEVI TOOKER joined July 1, 1810
- Widow NANCY RUGGLES joined August 4, 1810
- MRS. HALLOCK wife of HALLOCK joined March 3, 1810
- PETER SKIDMORE and wife joined (then dismissed to Wading River church)
- SISTER DINAH joined April 2, 1808
- GAETCH (black woman) joined April 30, 1808
- BETSY HALLOCK wife of JONAS HALLOCK joined November 2, 1811
- DENCY REYNOR, BETHIAN HALLOCK, CALVIN EATON joined September 6, 1817
- NOAH H. GILLET joined December 6, 1817
- AMELIA (black woman) joined May 2, 1818
- ABIATHER BROWN, BETHIAH WELLS joined February 28, 1818 (recorded as 1918 in document, likely 1818)
- NICHOLAS TERREL returned to fellowship October 5, 1822 (previously excommunicated)
- JEREMIAH KINNER returned to fellowship February 1, 1811

Ministers/Pastors mentioned:
- NOAH HALLOCK (Pastor, died October 25, 1818, had been pastor 29 years)
- JACOB CORWIN (Elder/Minister)
- MOSES SWEAZY / SWEZEY (Elder/Minister)
- NATHAN DICKERSON (Elder)
- DAVID WELLS (Elder)

Deaths noted:
- NOAH HALLOCK died October 25, 1818`,

  "MSCC341829_11281829 (1820–1829)": `Church of Christ at Old Mans (Old Man's / Mount Sinai), Long Island, NY. March 1820 – November 1829.

Members received into fellowship (joined):
- PATTY MILLER and HETTA MINOR united August 4, 1821
- HANNAH M. GILLET wife of NOAH H. GILLET received by letter from church of Middler Island August 4, 1821
- JOANNE DAVIS wife of DANIEL DAVIS, ABIGAIL HOPKINS wife of WILLIAM HOPKINS joined May 5, 1821 (received again)
- SAMUEL EDWARDS received into church April 8, 1825 (the church by letter)
- MRS. HULDAH NORTON received January 31, 1824
- NATHANIEL DAVIS and JULIA ANN PETTY received February 1, 1823
- THOMAS TOOKER dismissed to West Middle Island church June 7, 1823
- SAMAUEL HOPKINS appointed clerk November 20, 1826

Large reception April 8, 1825 (listed as April 8, 1825 but likely 1826 based on surrounding entries):
JAMES DAVIS, HANNAH R. DAVIS, NOAH ROBBINSON, MARY BREWSTER, MARIA PAYNE, CLARISSA WOOD, LEWIS DAVIS, JAMES OVERTON, MARGARET HALLOCK, ERVERLINE FINCH, ELEANOR TERRY

Large reception May 20, 1826:
SARAH ROBBINS, POLLY MILLER, MARIA HALLOCK, ELUISE WELLS, SALLY W. HOMAN, CHARRY TOOKER, ANN DAVIS, CAROLIN MILLER, ELIZA CATHARINE MILLER, SOPHRONIA BROWN, CONKLIN DAVIS, MARIA KINNER, MARY DAVIS, SARAH HOWELL, SARAH HALLOCK, DANIEL R. MILLER, RUTH DAVIS, RICHARD M. WOOD, AUSTIN RAYNOR, CORINNA MILLER, LOUISA HALLOCK, CHARRY BROWN, CATHERINE TYLER, HANNAH SATERLY, HANNAH PETTY, ABBA SOPHIA CORWIN (died 4/20/38), CHARLES MILLER, WILLIAM M. BROWN, ELIZA DAVIS, ELISA HUDSON, CATHARINE GERARD, GILBERT HOPKINS, POLLY BROWN, HENDRICH H. HALLOCK, ELIZABETH DAVIS, JOEL WOOD, GERSHORN BROWN, SANFORD DAVIS

Large reception July 15, 1826:
ARMINDA BAILEY, SAPPING NORTON, CHARLES T. JONES, JOEL BROWN, MARIA HALLOCK, ROBBIN, DORCAS, MARY, MARTHA SIMON

July 16, 1826:
MARIA HOPKINS, ELIZA DAVIS, CAROLINE HALLOCK, CHARITY BAILEY, LUCINDA NORTON

September 23, 1826: TABETHA JONES received

December 3, 1826:
HENRY T. GUNDERSON, MARY ANN GUNDERSON, ABBIGAIL WILSE, ARMINDA BELLOWS, ELEANOR DAVIS
Also SALLY NORTON by letter from Greenfield, Connecticut

February 10, 1827: ISAAC BROWN, CALEB KINNER received

April 7, 1827: ELISABETH JAYNE received; SALLY MILLER received by letter from Presbyterian church at Huntington

May 19, 1827:
CHARLES ROBINSON, SARAH ANN ROBINSON, AZEAL ROE, MRS. ROE WIFE OF AZEL ROE, AMELIA KINNER

Baptisms:
- LOUISA daughter of SAMUEL and MARIAH HOPKINS baptized April 19, 1829
- JOSEPH Augustus, ELIZA LUCRETIA, SOPHRONIA, MARY ELIZABETH children of ISAAC and CHARITY BROWN baptized July 26, 1829

October 3, 1829: JNO BROWN and wife PHEBE M. received by letter

Members dismissed:
- POLLY HALLOCK wife of HENRY HALLOCK dismissed to Methodist Church at Stony Brook December 23, 1820
- WILLIAM WOODHULL dismissed to Presbyterian Church New York Rutgers Street September 2, 1820
- HETTA MINER dismissed to church at Lime, Connecticut September 21, 1828

Excommunications:
- JOSIAH HALLOCK excommunicated (letter dated June 1, 1822)
- JULIA (colored woman) excommunicated October 9, 1824
- BETSEY EDWARDS / MRS. BETSEY EDWARDS withdrawn from fellowship February 5, 1825 / April 2, 1825
- BETHIAH DAVIS excommunicated August 6, 1823

Deaths:
- Deacon DANIEL DAVIS died (mentioned October 3, 1829 - vacancy by his death)

Officers:
- NOAH H. GILLET (Pastor/Minister throughout this period)
- SAMAUEL HOPKINS (appointed clerk November 20, 1826)
- PHILLIP HALLOCK (Deacon)
- TIMOTHY MILLER (Deacon, later deceased)
- SAMUEL DAVIS (Deacon)
- DAVID ROBBINS (appointed Deacon January 23, 1830)`,

  "MSCC11281829_1121839 (1829–1839)": `Church of Christ at Old Mans (Old Man's / Mount Sinai), Long Island, NY. November 1829 – November 1839.

Deaths noted:
- RICHARD DAVIS died January 1, 1830
- TIMOTHY MILLER deceased (mentioned April 2, 1831 - his office was vacant)
- JEREMIAH KINNER — no church meeting November 3, 1838 on account of his funeral

Members received:
- DAVID ROBBINS elected Deacon January 23, 1830
- CHARLES MILLER elected Deacon April 2, 1831

April 28, 1832 received into fellowship:
HANNAH NORTON (wife of Timothy Norton), SARAH ANN HUTCHINSON, REBECCA CARTER, CHARRY SMITH, BETSEY CONKLING, CHARLOTTE BELLOWS, HULDAH WELLS (wife of MARTIN WELLS), CHARLES LOYD BAYLES

June 7, 1832 received:
DOLLY BAILEY, CAROLINE BAILEY, MARTHA BELL, CLARISSA ROE, CATHARINE JONES, HARRIOT NORTON

July 21, 1832 received:
ABIATHER LIRRARD, ISAAC JONES, DANIEL BROWER, LUCRETTA (a colored woman)

February 5, 1832 received:
MRS. MARTHA BROWN (by letter from Rutgers Street church), MRS. SARAH M. CARTER

October 13, 1832: JEFFREY A. WOODHULL and ELIZABETH his wife dismissed to church at Fresh Ponds

November 10, 1832 - members long absent noted:
PAUL T. NORTON, DAVIS NORTON, GERSHAM BROWN, ELMA WELLS, ELIZA SMITH, CHARITY DAVIS, HANNAH BENNET

November 24, 1832: CHARITY DAVIS returned to fellowship

January 6, 1833: PHILLIP BROWN funeral preached

March 30, 1833: ALMA WILLS restored to fellowship

April 2, 1836 received into fellowship:
FANNY JONES wife of CHARLES S. JONES (by letter from Dutch Reformed Church Tarrytown Westchester County), SAMUEL BROWN, DELIVERANCE BROWN wife of SAML BROWN, JOHN MERIT BROWN

March 3, 1838 received:
ADELIA wife of NOAH H. JONES

March 31, 1838 received:
MEHETABLE wife of CALVIN EATON, ANNE wife of JONATHAN PIKE, SUSAN M. widow of SIMEON DAVIS

Also dismissed March 31, 1838:
CAROLINE MILLER now wife of ISAIAH TERRY JR. (dismissed to church at Wading River)
CHARRY MILLER now wife of JOHN TERRY (dismissed to church at Wading River)

May 26, 1838 received:
HANNAH H. WOODHULL (by letter), HENRY HALLOCK, JOHN H. WOODHULL, FANNY M. DAVIS, DEBORAH M. BROWN, ABIGAIL REEVE

June 2, 1838 received:
MARTHA O. MILLS (now MILLER), BETHIAH HAWKINS (by letter), EDWIN N. MILLER, SYLVESTER R. DAVIS, GEORGE W. BROWN, JAMES HALLOCK (son of PHILIP HALLOCK), CALEB H. KING, CATHARINE O. HOPKINS, ELMINA wife of SYLVESTER R. DAVIS

August 4, 1838 received:
REBECCA HALLOCK wife of HENDRICK H. HALLOCK, JOANNA BROWN, MARY ANN TOOKER, JANE ANN EATON
Also FANNY PRINCE restored to fellowship

September 1, 1838: HANNAH A. HALLOCK united with the church (December 1, 1838)

February 2, 1839 received:
JOSIAH SATTERLY, JOHN HENRY BESIN, CATHARINE CORDELIA his wife

April 5, 1839 received:
MR. THOMAS HELME (candidate), MRS. SUSAN HELME wife of THOMAS HELME (by letter from Presbyterian Church Setauket), WM. O. AYERS (by letter from Church in Yale College New Haven Ct.)

June 2, 1839: LAURA C. KINNERS, MARY HOPKINS received

July 6, 1839: JOEL BROWN of Rocky Point, CHARLES I. JONES of Drown-meadow elected Deacons

August 31, 1839: MINEUS LYMAN received unanimously

Officers during this period:
- NOAH H. GILLET (Pastor, continues from previous period)
- SAMUEL HOPKINS (Clerk throughout)
- DAVID ROBBINS (Deacon)
- CHARLES MILLER (Deacon, elected April 2, 1831)
- PHILIP HALLOCK (Deacon)
- JOEL BROWN (Deacon, elected July 6, 1839)
- CHARLES I. JONES (Deacon, elected July 6, 1839)
- JOHN STOCKER / JOHN SATOCKER (Moderator, appears late 1833)
- REV. PARSHALL TERRY (Minister/Pastor, appears 1834 onwards)
- REV. E. PLATT (Minister/Pastor, appears 1838 onwards)

Excommunications/Withdrawals:
- ELISHA DAVIS excommunicated (letter approved May 15, 1830)
- ABBY HOPKINS cut off from church unanimously (May 15, 1830)
- JOHN DAVIS excommunicated (letter November 12, 1831)
- JAMES DAVIS excommunicated (letter September 1, 1832)
- GERSHAM BROWN excommunicated (letter September 19, 1833)
- DANIEL T. NORTON excommunicated (letter January 20, 1833)
- SANFORD DAVIS fellowship withdrawn (letter October 3, 1835)
- ALMA WELLS fellowship withdrawn October 3, 1835
- CONKLIN DAVIS and wife ELIZABETH DAVIS withdrew themselves January 25, 1835`
}

const SYSTEM_PROMPT = `You are a genealogy extraction assistant for the Granite Graph cemetery cataloging project. 
You will be given transcribed church meeting records from the Church of Christ at Old Man's (Mount Sinai), Long Island, New York.

Extract every individual person mentioned in these records. For each person return a JSON array where each element has:
- "full_name": Full name as it appears (normalize spelling where obviously variant, e.g. HALLOCK not HALLOC)  
- "first_name": First name
- "middle_name": Middle name or initial if present (null otherwise)
- "last_name": Last name
- "maiden_name": Maiden name if mentioned (null otherwise)
- "gender": "M" or "F" or null if unclear
- "event_type": One of: "joined", "dismissed", "excommunicated", "reinstated", "baptized", "died", "officer", "mentioned"
- "event_date_verbatim": The date as it appears in the text (e.g. "May 20, 1826") or null
- "event_year": 4-digit year as integer or null
- "notes": Any additional context (spouse of, wife of, colored woman, deacon, pastor, etc.)
- "source_notes": Brief excerpt or context from the record

Rules:
- Include ALL named individuals, even those only briefly mentioned
- For married women listed as "wife of X", include both the woman AND her husband as separate entries if the husband is named
- Normalize all-caps names to Title Case
- For people listed in bulk reception lists, use the event date of that list entry
- "officer" type = ministers, pastors, deacons, clerks, moderators, delegates
- Do NOT include unnamed references like "his wife" or "a colored woman" unless they have a name
- If a person appears multiple times, include only their most significant/informative entry
- Return ONLY valid JSON, no markdown fences, no explanation`

export default function ChurchImport() {
  const [step, setStep] = useState("select")
  const [selectedPdf, setSelectedPdf] = useState("")
  const [rawText, setRawText] = useState("")
  const [extracting, setExtracting] = useState(false)
  const [extracted, setExtracted] = useState([])
  const [error, setError] = useState(null)
  const [editIndex, setEditIndex] = useState(null)
  const [editData, setEditData] = useState(null)
  const [filter, setFilter] = useState("")
  const [filterType, setFilterType] = useState("all")
  const [copied, setCopied] = useState(false)
  const [customText, setCustomText] = useState(false)

  const EVENT_COLORS = {
    joined: "#15803d",
    dismissed: "#b45309",
    excommunicated: "#b91c1c",
    reinstated: "#0369a1",
    baptized: "#6d28d9",
    died: "#374151",
    officer: "#0f766e",
    mentioned: "#6b7280"
  }

  const loadPdf = (key) => {
    setSelectedPdf(key)
    setRawText(PDF_TEXTS[key])
    setCustomText(false)
    setExtracted([])
    setError(null)
    setStep("review-text")
  }

  const extract = async () => {
    setExtracting(true)
    setError(null)
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 8000,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: rawText }]
        })
      })
      const data = await res.json()
      const text = data.content?.[0]?.text || ""
      const cleaned = text.replace(/```json|```/g, "").trim()
      const parsed = JSON.parse(cleaned)
      const withIds = parsed.map((p, i) => ({ ...p, _id: i, _keep: true }))
      setExtracted(withIds)
      setStep("review-people")
    } catch (e) {
      setError("Extraction failed: " + e.message)
    }
    setExtracting(false)
  }

  const toggleKeep = (id) => {
    setExtracted(prev => prev.map(p => p._id === id ? { ...p, _keep: !p._keep } : p))
  }

  const startEdit = (person) => {
    setEditIndex(person._id)
    setEditData({ ...person })
  }

  const saveEdit = () => {
    setExtracted(prev => prev.map(p => p._id === editIndex ? { ...editData } : p))
    setEditIndex(null)
    setEditData(null)
  }

  const generateSQL = () => {
    const toInsert = extracted.filter(p => p._keep)
    const lines = toInsert.map(p => {
      const fn = (p.first_name || "").replace(/'/g, "''")
      const mn = p.middle_name ? `'${p.middle_name.replace(/'/g, "''")}'` : "NULL"
      const ln = (p.last_name || "").replace(/'/g, "''")
      const maiden = p.maiden_name ? `'${p.maiden_name.replace(/'/g, "''")}'` : "NULL"
      const gender = p.gender ? `'${p.gender}'` : "NULL"
      const notes = p.notes ? `'${p.notes.replace(/'/g, "''")}'` : "NULL"
      const srcNotes = `'${(p.source_notes || "").replace(/'/g, "''").substring(0, 200)}'`
      return `  ('${fn}', ${mn}, '${ln}', ${maiden}, ${gender}, '${CEMETERY_ID}', '${SOURCE_ID}', '${p.event_type || "mentioned"}', '${(p.event_date_verbatim || "").replace(/'/g, "''")}', ${p.event_year || "NULL"}, ${notes}, ${srcNotes})`
    })
    return `-- Granite Graph Church Records Import
-- Source: ${selectedPdf}
-- Generated: ${new Date().toISOString().split("T")[0]}
-- Records to insert: ${toInsert.length}

INSERT INTO deceased (
  first_name, middle_name, last_name, maiden_name, gender,
  cemetery_id, source_id, church_event_type, church_event_date_verbatim,
  church_event_year, notes, source_notes
) VALUES
${lines.join(",\n")}
ON CONFLICT DO NOTHING;

-- After running the above, verify with:
-- SELECT COUNT(*) FROM deceased WHERE source_id = '${SOURCE_ID}';`
  }

  const copySQL = () => {
    navigator.clipboard.writeText(generateSQL())
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const filtered = extracted.filter(p => {
    const matchFilter = filter === "" || p.full_name?.toLowerCase().includes(filter.toLowerCase()) || p.notes?.toLowerCase().includes(filter.toLowerCase())
    const matchType = filterType === "all" || p.event_type === filterType
    return matchFilter && matchType
  })

  const kept = extracted.filter(p => p._keep).length
  const total = extracted.length

  const eventTypes = [...new Set(extracted.map(p => p.event_type).filter(Boolean))]

  return (
    <div style={{ padding: "1rem 0", fontFamily: "var(--font-sans)" }}>

      {step === "select" && (
        <div>
          <p style={{ color: "var(--color-text-secondary)", fontSize: 14, marginBottom: "1.5rem" }}>
            Select a church record PDF to begin extraction, or paste custom text.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: "1.5rem" }}>
            {Object.keys(PDF_TEXTS).map(key => (
              <button key={key} onClick={() => loadPdf(key)}
                style={{ textAlign: "left", padding: "14px 16px", background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-lg)", cursor: "pointer", color: "var(--color-text-primary)", fontSize: 14 }}>
                <span style={{ fontWeight: 500 }}>{key}</span>
                <br />
                <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                  {key.includes("1778") ? "112 meetings, Oct 1799–Jul 1807 + earlier records" :
                   key.includes("1820") ? "Pages 107–156, March 1820–November 1829" :
                   "Pages 157–207+, November 1829–November 1839"}
                </span>
              </button>
            ))}
          </div>
          <button onClick={() => { setSelectedPdf("Custom text"); setRawText(""); setCustomText(true); setStep("review-text") }}
            style={{ width: "100%", padding: "12px", background: "transparent", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-md)", cursor: "pointer", color: "var(--color-text-secondary)", fontSize: 13 }}>
            Paste custom text
          </button>
        </div>
      )}

      {step === "review-text" && (
        <div>
          <button onClick={() => setStep("select")} style={{ fontSize: 13, color: "var(--color-text-secondary)", background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: "1rem" }}>
            ← Back
          </button>
          <p style={{ fontWeight: 500, marginBottom: 8, fontSize: 14 }}>{selectedPdf}</p>
          <p style={{ color: "var(--color-text-secondary)", fontSize: 13, marginBottom: 12 }}>
            {customText ? "Paste the church record text below." : "Review the pre-loaded text, then extract people."}
          </p>
          <textarea
            value={rawText}
            onChange={e => setRawText(e.target.value)}
            style={{ width: "100%", minHeight: 280, fontSize: 12, fontFamily: "var(--font-mono)", padding: "10px", background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-md)", color: "var(--color-text-primary)", boxSizing: "border-box", resize: "vertical" }}
          />
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button onClick={extract} disabled={extracting || rawText.trim().length < 50}
              style={{ flex: 1, padding: "12px", background: extracting ? "var(--color-background-secondary)" : "#15803d", border: "none", borderRadius: "var(--border-radius-md)", color: extracting ? "var(--color-text-secondary)" : "white", fontWeight: 500, cursor: extracting ? "not-allowed" : "pointer", fontSize: 14 }}>
              {extracting ? "Extracting people..." : "Extract People"}
            </button>
          </div>
          {error && <p style={{ color: "var(--color-text-danger)", fontSize: 13, marginTop: 10 }}>{error}</p>}
        </div>
      )}

      {step === "review-people" && (
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
            <button onClick={() => setStep("review-text")} style={{ fontSize: 13, color: "var(--color-text-secondary)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
              ← Re-extract
            </button>
            <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>{kept} of {total} selected</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: "1rem" }}>
            {[
              { label: "Total extracted", value: total },
              { label: "Selected for import", value: kept }
            ].map(m => (
              <div key={m.label} style={{ background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)", padding: "10px 12px" }}>
                <p style={{ fontSize: 12, color: "var(--color-text-secondary)", margin: "0 0 4px" }}>{m.label}</p>
                <p style={{ fontSize: 22, fontWeight: 500, margin: 0 }}>{m.value}</p>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input
              placeholder="Filter by name or notes..."
              value={filter}
              onChange={e => setFilter(e.target.value)}
              style={{ flex: 1, fontSize: 13 }}
            />
            <select value={filterType} onChange={e => setFilterType(e.target.value)} style={{ fontSize: 13 }}>
              <option value="all">All types</option>
              {eventTypes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 8 }}>
            {filtered.length} shown — uncheck to exclude from import
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 480, overflowY: "auto", paddingRight: 4 }}>
            {filtered.map(person => (
              <div key={person._id} style={{
                background: "var(--color-background-primary)",
                border: `0.5px solid ${person._keep ? "var(--color-border-secondary)" : "var(--color-border-tertiary)"}`,
                borderRadius: "var(--border-radius-md)",
                padding: "10px 12px",
                opacity: person._keep ? 1 : 0.45
              }}>
                {editIndex === person._id ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                      <input value={editData.first_name || ""} onChange={e => setEditData(p => ({ ...p, first_name: e.target.value }))} placeholder="First" style={{ fontSize: 12 }} />
                      <input value={editData.middle_name || ""} onChange={e => setEditData(p => ({ ...p, middle_name: e.target.value }))} placeholder="Middle" style={{ fontSize: 12 }} />
                      <input value={editData.last_name || ""} onChange={e => setEditData(p => ({ ...p, last_name: e.target.value }))} placeholder="Last" style={{ fontSize: 12 }} />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                      <input value={editData.maiden_name || ""} onChange={e => setEditData(p => ({ ...p, maiden_name: e.target.value }))} placeholder="Maiden name" style={{ fontSize: 12 }} />
                      <select value={editData.event_type || ""} onChange={e => setEditData(p => ({ ...p, event_type: e.target.value }))} style={{ fontSize: 12 }}>
                        {["joined", "dismissed", "excommunicated", "reinstated", "baptized", "died", "officer", "mentioned"].map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <input value={editData.event_date_verbatim || ""} onChange={e => setEditData(p => ({ ...p, event_date_verbatim: e.target.value }))} placeholder="Event date verbatim" style={{ fontSize: 12 }} />
                    <input value={editData.notes || ""} onChange={e => setEditData(p => ({ ...p, notes: e.target.value }))} placeholder="Notes" style={{ fontSize: 12 }} />
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={saveEdit} style={{ flex: 1, padding: "8px", background: "#15803d", border: "none", borderRadius: "var(--border-radius-md)", color: "white", fontSize: 12, cursor: "pointer" }}>Save</button>
                      <button onClick={() => { setEditIndex(null); setEditData(null) }} style={{ flex: 1, padding: "8px", background: "transparent", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", color: "var(--color-text-secondary)", fontSize: 12, cursor: "pointer" }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <input type="checkbox" checked={person._keep} onChange={() => toggleKeep(person._id)}
                      style={{ marginTop: 3, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontWeight: 500, fontSize: 14 }}>{person.full_name}</span>
                        <span style={{
                          fontSize: 11, padding: "2px 7px", borderRadius: 99,
                          background: (EVENT_COLORS[person.event_type] || "#6b7280") + "22",
                          color: EVENT_COLORS[person.event_type] || "#6b7280",
                          fontWeight: 500
                        }}>{person.event_type}</span>
                        {person.gender && <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>{person.gender}</span>}
                      </div>
                      {person.event_date_verbatim && <p style={{ fontSize: 12, color: "var(--color-text-secondary)", margin: "2px 0 0" }}>{person.event_date_verbatim}</p>}
                      {person.notes && <p style={{ fontSize: 12, color: "var(--color-text-secondary)", margin: "2px 0 0" }}>{person.notes}</p>}
                    </div>
                    <button onClick={() => startEdit(person)}
                      style={{ fontSize: 11, padding: "4px 8px", background: "transparent", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-md)", cursor: "pointer", color: "var(--color-text-secondary)", flexShrink: 0 }}>
                      Edit
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div style={{ marginTop: "1.5rem", display: "flex", gap: 10 }}>
            <button onClick={() => setStep("sql")}
              style={{ flex: 1, padding: "12px", background: "#15803d", border: "none", borderRadius: "var(--border-radius-md)", color: "white", fontWeight: 500, fontSize: 14, cursor: "pointer" }}>
              Generate SQL ({kept} records)
            </button>
          </div>
        </div>
      )}

      {step === "sql" && (
        <div>
          <button onClick={() => setStep("review-people")} style={{ fontSize: 13, color: "var(--color-text-secondary)", background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: "1rem" }}>
            ← Back to review
          </button>

          <div style={{ background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: "1rem", marginBottom: "1rem" }}>
            <p style={{ fontWeight: 500, fontSize: 14, margin: "0 0 6px" }}>Before running this SQL</p>
            <ul style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
              <li>Your <code>deceased</code> table needs columns: <code>church_event_type</code>, <code>church_event_date_verbatim</code>, <code>church_event_year</code>, <code>source_notes</code></li>
              <li>If those columns don't exist yet, run the migration SQL first (see below)</li>
              <li>After import, use the <strong>Search Records</strong> feature in the app to find and match church members to gravestone records</li>
            </ul>
          </div>

          <details style={{ marginBottom: "1rem" }}>
            <summary style={{ fontSize: 13, cursor: "pointer", color: "var(--color-text-secondary)", padding: "8px 0" }}>Migration SQL (run once if columns missing)</summary>
            <pre style={{ fontSize: 11, background: "var(--color-background-secondary)", padding: 12, borderRadius: "var(--border-radius-md)", overflow: "auto", color: "var(--color-text-primary)", marginTop: 8 }}>{`ALTER TABLE deceased
  ADD COLUMN IF NOT EXISTS church_event_type text,
  ADD COLUMN IF NOT EXISTS church_event_date_verbatim text,
  ADD COLUMN IF NOT EXISTS church_event_year integer,
  ADD COLUMN IF NOT EXISTS source_id uuid,
  ADD COLUMN IF NOT EXISTS source_notes text;`}</pre>
          </details>

          <pre style={{ fontSize: 11, background: "var(--color-background-secondary)", padding: 12, borderRadius: "var(--border-radius-md)", overflow: "auto", maxHeight: 400, color: "var(--color-text-primary)", border: "0.5px solid var(--color-border-tertiary)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {generateSQL()}
          </pre>

          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button onClick={copySQL}
              style={{ flex: 1, padding: "12px", background: copied ? "#15803d" : "var(--color-background-primary)", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", color: copied ? "white" : "var(--color-text-primary)", fontWeight: 500, fontSize: 14, cursor: "pointer" }}>
              {copied ? "Copied!" : "Copy SQL"}
            </button>
            <button onClick={() => { setStep("select"); setExtracted([]); setRawText(""); setSelectedPdf("") }}
              style={{ padding: "12px 16px", background: "transparent", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-md)", color: "var(--color-text-secondary)", fontSize: 14, cursor: "pointer" }}>
              Next PDF
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
