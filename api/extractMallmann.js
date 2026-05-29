// api/extractMallmann.js
// Claude vision extraction for Mallmann 1899 genealogy page images

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { image, mediaType = 'image/jpeg', familyName, pageNumber } = req.body
  if (!image) return res.status(400).json({ error: 'Missing image' })
  if (!familyName) return res.status(400).json({ error: 'Missing familyName' })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' })

  const systemPrompt = `You are a genealogy extraction assistant for the Granite Graph project — a social network graph of a historic Long Island community (Seaview Cemetery / Mount Sinai, NY).

Extract all genealogy sections visible on the provided Mallmann 1899 genealogy page scan. Return ONLY valid JSON — no markdown, no fences, no explanation.

RETURN FORMAT:
{
  "family_name": string,
  "sections": [
    {
      "section_id": string,
      "head": {
        "full_name": string,
        "first_name": string,
        "middle_name": string|null,
        "last_name": string,
        "maiden_name": string|null,
        "gender": "M"|"F"|null,
        "mallmann_ref": string,
        "date_of_birth_verbatim": string|null,
        "date_of_birth_year": number|null,
        "date_of_death_verbatim": string|null,
        "date_of_death_year": number|null,
        "parent_section_id": string|null,
        "notes": string|null
      },
      "spouses": [
        {
          "seq": number,
          "full_name": string,
          "first_name": string,
          "middle_name": string|null,
          "last_name": string,
          "maiden_name": string|null,
          "gender": "M"|"F"|null,
          "mallmann_ref": string,
          "marriage_date_verbatim": string|null,
          "marriage_year": number|null,
          "date_of_birth_verbatim": string|null,
          "date_of_birth_year": number|null,
          "date_of_death_verbatim": string|null,
          "date_of_death_year": number|null,
          "consanguineous": boolean,
          "parentage": string|null
        }
      ],
      "child_count": number|null,
      "children": [
        {
          "full_name": string,
          "first_name": string,
          "middle_name": string|null,
          "last_name": string,
          "gender": "M"|"F"|null,
          "mallmann_ref": string,
          "date_of_birth_verbatim": string|null,
          "date_of_birth_year": number|null,
          "date_of_death_verbatim": string|null,
          "date_of_death_year": number|null,
          "child_type": "numbered"|"lettered"|"asterisked"|"unnumbered",
          "spouse_seq": number|null,
          "notes": string|null
        }
      ]
    }
  ]
}

MALLMANN STRUCTURE RULES:
1. Sections are headed by a bold letter (A, B, C… ancestors) or bold number (1, 2, 3… descendants).
2. Section head's name is printed in SMALL CAPITALS at the top.
3. mallmann_ref for section heads: "{familyName}_{section_id}"  e.g. "Hopkins_2"
4. mallmann_ref for spouses: "{familyName}_{section_id}_wife_{seq}" or "_husband_{seq}"  e.g. "Hopkins_2_wife_1"
5. mallmann_ref for unnumbered children: "{familyName}_{section_id}_child_{FirstName}_{birth_year}"  e.g. "Hopkins_2_child_John_1783"
6. Numbered children (integer before name) → child_type:"numbered", mallmann_ref = "{familyName}_{that_number}"
7. Lettered children (letter before name) → child_type:"lettered", mallmann_ref = "{familyName}_{that_letter}"
8. Asterisked children (* before name) → child_type:"asterisked"; resolve the footnote (e.g. "(*) see No. 39") to get the section number, mallmann_ref = "{familyName}_{resolved_number}"
9. Unnumbered children (no prefix) → child_type:"unnumbered"
10. CONSANGUINEOUS: true ONLY when BOTH section head AND spouse are typeset in SMALL CAPITALS. Asterisk alone does NOT indicate consanguinity.
11. spouse_seq on each child: infer from birth dates vs spouse's death date. If unclear, use 1.
12. Abbreviations: b.=born, d.=died, m.=married, s.=son of, da.=daughter of, ae.=aged, ch.=children, wid.=widow, d.a.p.=died without issue, d.unm.=died unmarried.
13. parent_section_id: if text says "s. [Father] and [Mother]..." and that father has a known section ID, record it. Otherwise null.
14. MIDDLE NAMES: "George Gilbert Hopkins" → first_name:"George", middle_name:"Gilbert"; "Hannah Y. Hopkins" → first_name:"Hannah", middle_name:"Y". Apply to heads, spouses, and children.
15. DATE PARSING — critical:
    - "b. [date]; m. [date], [Name]" → date after "b." = birth, date after "m." = marriage NOT death; set date_of_death_verbatim:null; put "m. [date], [Name]" in notes.
    - "b. [date], d. [date]" → birth and death.
    - Semicolon before "m." is Mallmann's birth/marriage separator — never treat a marriage date as a death date.
    - Only set date_of_death_verbatim when text explicitly contains "d." followed by a date.`

  const userContent = [
    {
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data: image },
    },
    {
      type: 'text',
      text: `Family name: "${familyName}". Page: ${pageNumber ?? 'unknown'}. Use mallmann_ref prefix "${familyName}_". Extract all sections visible on this page.`,
    },
  ]

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'output-128k-2025-02-19',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 32000,
        system: systemPrompt,
        messages: [
          { role: 'user', content: userContent },
        ],
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
    console.error('extractMallmann error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
