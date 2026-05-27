// api/extractWhite.js
// Claude vision extraction for Willis H. White genealogy page images.
// White writes in numbered prose sections — different from Mallmann's structured format.

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { image, mediaType = 'image/jpeg', bookKey, pageNumber } = req.body
  if (!image)   return res.status(400).json({ error: 'Missing image' })
  if (!bookKey) return res.status(400).json({ error: 'Missing bookKey' })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' })

  const systemPrompt = `You are a genealogy extraction assistant for the Granite Graph project — a social network graph of a historic Long Island community (Seaview Cemetery / Mount Sinai, NY).

Extract all genealogy sections visible on this page from Willis H. White's genealogy. White writes in numbered prose sections. Return ONLY valid JSON — no markdown, no fences, no comments.

RETURN FORMAT — follow this structure exactly:
{
  "book_key": string,
  "page_number": number|null,
  "sections": [
    {
      "section_number": integer,
      "lineage": ["FirstName1", "FirstName2"],
      "head": {
        "full_name": string,
        "first_name": string, "middle_name": string|null, "last_name": string, "maiden_name": string|null,
        "gender": "M"|"F"|null,
        "generation": integer|null,
        "white_ref": string,
        "parent_section_number": integer|null,
        "date_of_birth_verbatim": string|null, "date_of_birth_year": number|null,
        "date_of_death_verbatim": string|null, "date_of_death_year": number|null,
        "burial_place": string|null,
        "notes": string|null
      },
      "spouses": [ ...spouse objects ],
      "children": [ ...child objects ]
    }
  ]
}

SECTION HEAD (nested inside "head"): Each section begins with "N. FIRSTNAME LASTNAME (lineage_chain) was born..."
- full_name, first_name, middle_name (null if absent), last_name, maiden_name (null if absent), gender ("M"|"F"|null)
- generation: superscript or inline generation number on the head's name (e.g. WILLIAM¹ → 1); null if not present
- white_ref: "{bookKey}_{section_number}"  e.g. "Tillotson_1"
- parent_section_number: section number where this person appeared as a "+" child; null if not determinable
- date_of_birth_verbatim: string|null, date_of_birth_year: number|null
- date_of_death_verbatim: string|null, date_of_death_year: number|null
- burial_place: cemetery or place name if "was buried at/in X"; null otherwise
- notes: any remaining information; include footnote references as [cite:N]

SPOUSE fields (array "spouses" at the section level, NOT inside head):
- seq: 1 for first marriage, 2 for second, etc.
- full_name, first_name, middle_name, last_name, maiden_name, gender
- white_ref: "{bookKey}_{section_number}_wife_{seq}" or "_husband_{seq}"
- marriage_date_verbatim: string|null, marriage_year: number|null
- date_of_birth_verbatim, date_of_birth_year, date_of_death_verbatim, date_of_death_year
- parentage: full parentage phrase if given, e.g. "daughter of James Blydenburgh and Alma Davis"; null otherwise

CHILDREN fields (array "children"):
- roman_numeral: the roman numeral label (i, ii, iii, iv, v, vi...) as a string
- has_section: true if the child has a "+" prefix (they have their own numbered section)
- section_number_ref: if has_section=true, the section number assigned to this child (may appear on this page or a later page); null if not yet determinable
- full_name, first_name, middle_name, last_name, maiden_name, gender
- white_ref:
    - if has_section=true and section_number_ref is known: "{bookKey}_{section_number_ref}"
    - if has_section=true and section_number_ref is null: "{bookKey}_{section_number}_{roman_numeral}_pending"
    - if has_section=false: "{bookKey}_{section_number}_{roman_numeral}"
- date_of_birth_verbatim, date_of_birth_year, date_of_death_verbatim, date_of_death_year
- burial_place: null unless explicitly stated for this child
- spouse_seq: number|null — which parent marriage this child belongs to (1, 2...) based on birth dates relative to parent's marriages; default 1
- notes: marriage info, burial place, footnote references as [cite:N]; null if none

PROSE PARSING RULES:
1. Birth: "born [date] at [place]", "born about [year]", "was born [date]" → date_of_birth_verbatim
2. Death: "died [date] at [place]", "died [date]" → date_of_death_verbatim
3. Marriage of section head: "X married [date], [SpouseName]" or "X married [date/place], [SpouseName], [parentage]"
4. Multiple marriages of head: "(1) [date], [Name]" and "(2) [date], [Name]" → seq 1 and 2
5. Gender: infer from "He married", "She married", "his wife", "her husband", "son of", "daughter of"
6. Parentage: "the son/daughter of X and Y (née Z) Surname" or "Y née Z" → maiden_name = Z
7. "probably" or "about" before a date → include in verbatim, use year as approximate
8. Footnote superscripts in text → record as [cite:N] in the notes field at the point they appear
9. Burial at named cemetery → burial_place field
10. MIDDLE NAMES: "John A. Tillotson" → first_name:"John", middle_name:"A"
11. "+" prefix on a child → has_section:true; the section number sometimes appears inline as the "+" number

Only extract what is visible on this page. If a section begins near the bottom and its content continues on the next page, extract what is visible and note "continues" in the head's notes.`

  const userContent = [
    {
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data: image },
    },
    {
      type: 'text',
      text: `Book key: "${bookKey}". Page number: ${pageNumber ?? 'unknown'}.

Extract all genealogy sections visible on this page. Return ONLY valid JSON.`,
    },
  ]

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 16000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }],
      }),
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      return res.status(response.status).json({ error: err.error?.message || 'Anthropic API error' })
    }

    const data = await response.json()
    if (data.error) return res.status(400).json({ error: data.error.message })

    const raw = data.content?.filter(b => b.type === 'text').map(b => b.text).join('') ?? ''

    let parsed = null
    const first = raw.indexOf('{')
    const last  = raw.lastIndexOf('}')
    const candidates = [
      raw.trim(),
      raw.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim(),
      first !== -1 && last > first ? raw.slice(first, last + 1) : null,
    ].filter(Boolean)

    for (const candidate of candidates) {
      try { parsed = JSON.parse(candidate); break } catch { /* try next */ }
    }

    if (!parsed) {
      console.error('Non-JSON from Claude (first 500):', raw.substring(0, 500))
      return res.status(422).json({ error: 'Model returned non-JSON', preview: raw.substring(0, 400) })
    }

    return res.status(200).json(parsed)
  } catch (err) {
    console.error('extractWhite error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
