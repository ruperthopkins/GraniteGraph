// api/extractMallmann.js
// Claude vision extraction for Mallmann 1899 genealogy page images

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { image, mediaType = 'image/jpeg', familyName, pageNumber } = req.body
  if (!image) return res.status(400).json({ error: 'Missing image' })
  if (!familyName) return res.status(400).json({ error: 'Missing familyName' })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' })

  const schema = `{
  "family_name": string,
  "sections": [
    {
      "section_id": string,            // letter (A,B,C) or number (1,2,3...) — exactly as printed
      "head": {
        "full_name": string,           // Title Case, e.g. "Samuel Hopkins"
        "first_name": string,
        "middle_name": string|null,
        "last_name": string,
        "maiden_name": string|null,
        "gender": "M"|"F"|null,
        "mallmann_ref": string,        // e.g. "Hopkins_2"
        "date_of_birth_verbatim": string|null,
        "date_of_birth_year": number|null,
        "date_of_death_verbatim": string|null,
        "date_of_death_year": number|null,
        "parent_section_id": string|null,  // section ID of parent's family record, from "s." or "da." line
        "notes": string|null
      },
      "spouses": [
        {
          "seq": number,               // 1 for first marriage, 2 for second, etc.
          "full_name": string,
          "first_name": string,
          "middle_name": string|null,
          "last_name": string,
          "maiden_name": string|null,  // birth surname for married women, else null
          "gender": "M"|"F"|null,
          "mallmann_ref": string,      // e.g. "Hopkins_2_wife_1"
          "marriage_date_verbatim": string|null,
          "marriage_year": number|null,
          "date_of_birth_verbatim": string|null,
          "date_of_birth_year": number|null,
          "date_of_death_verbatim": string|null,
          "date_of_death_year": number|null,
          "consanguineous": boolean,   // true ONLY when BOTH the head AND this spouse name appear in SMALL CAPITALS
          "parentage": string|null     // e.g. "da. John and Elizabeth ( ) Robinson"
        }
      ],
      "child_count": number|null,      // from "N ch." line
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
          "spouse_seq": number|null,   // which parent spouse (1, 2...) based on birth dates
          "notes": string|null
        }
      ]
    }
  ]
}`

  const userContent = [
    {
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data: image },
    },
    {
      type: 'text',
      text: `Family name namespace: "${familyName}". Page number: ${pageNumber ?? 'unknown'}.

Extract all genealogy sections visible on this page. Return ONLY valid JSON — no markdown, no fences, no comments.

MALLMANN STRUCTURE RULES:
1. Sections are headed by a bold letter (A, B, C… for ancestors) or bold number (1, 2, 3… for descendants).
2. The section head's name is printed in SMALL CAPITALS at the top.
3. mallmann_ref for section heads: "${familyName}_{section_id}"  e.g. "Hopkins_2"
4. mallmann_ref for spouses: "${familyName}_{section_id}_wife_{seq}" or "_husband_{seq}"  e.g. "Hopkins_2_wife_1"
5. mallmann_ref for unnumbered children: "${familyName}_{section_id}_child_{FirstName}_{birth_year}"  e.g. "Hopkins_2_child_John_1783"
6. Numbered children (integer before name) → child_type:"numbered", mallmann_ref = "${familyName}_{that_number}"
7. Lettered children (letter before name) → child_type:"lettered", mallmann_ref = "${familyName}_{that_letter}"
8. Asterisked children (asterisk before name) → child_type:"asterisked"; resolve the footnote at the bottom of the section (e.g. "(*) see No. 39") to get the section number, then mallmann_ref = "${familyName}_{resolved_number}"
9. Unnumbered children (no prefix) → child_type:"unnumbered"
10. CONSANGUINEOUS: set consanguineous:true ONLY when BOTH the section head's name AND the spouse's name are typeset in SMALL CAPITALS. An asterisk alone does NOT mean consanguineous.
11. spouse_seq on each child: infer which parent's spouse based on birth dates. If child born before first wife's death → spouse_seq:1. If born after → spouse_seq:2, etc. If only one spouse or unclear, use spouse_seq:1.
12. Abbreviations: b.=born, d.=died, m.=married, s.=son of, da.=daughter of, ae.=aged, ch.=children, wid.=widow, d.a.p.=died without issue, d.unm.=died unmarried.
13. For the head's parent_section_id: if the text says "s. [Father] and [Mother] ([Maiden]) [Surname]" and that father appears as a section head with a known ID, record that section_id. Otherwise null.

${schema}`,
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
        model: 'claude-sonnet-4-20250514',
        max_tokens: 16000,
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

    // Try several strategies to extract JSON from whatever Claude returned
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
