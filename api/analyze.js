export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
}

export default async function handler(req, res) {
  // Handle CORS preflight
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { imageBase64 } = req.body

  if (!imageBase64) {
    return res.status(400).json({ error: 'No image provided' })
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [
            { text: 'You are transcribing text from a historic cemetery gravestone photograph. The stone may be weathered, poorly lit, or use 18th/19th century typography. There may be ONE or MULTIPLE people on the same stone.\n\nExtract ALL people mentioned on the stone. For each person extract:\n- First name, middle name, last name\n- Maiden name (often shown as nee or born)\n- Birth date exactly as inscribed\n- Death date exactly as inscribed\n- Any kinship text EXACTLY as written (e.g. "His Wife", "Son of John & Mary Hopkins", "Daughter of")\n- Any titles (Rev, Dr, Pvt, Capt etc.)\n\nRules:\n- Transcribe exactly what you see, do not guess or infer\n- For uncertain characters use ? (e.g. 18?4)\n- For unreadable sections use [unreadable]\n- The long S character should be transcribed as regular s\n- If a last name is not shown, infer it from context (e.g. family stone header)\n- For stone_condition use only: excellent, good, fair, poor, illegible, or missing\n- kinship_hints must contain the EXACT text from the stone, not paraphrased\n- Return ONLY a JSON object, no other text\n\nReturn this exact JSON structure:\n{\n  "people": [\n    {\n      "first_name": "",\n      "middle_name": "",\n      "last_name": "",\n      "maiden_name": "",\n      "date_of_birth_verbatim": "",\n      "date_of_death_verbatim": "",\n      "kinship_hints": [],\n      "titles": "",\n      "confidence": "high|medium|low",\n      "notes": ""\n    }\n  ],\n  "stone_condition": "good",\n  "stone_notes": ""\n}' },
            { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } }
          ]}],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 4096,
            thinkingConfig: { thinkingBudget: 0 }
          }
        })
      }
    )

    const data = await response.json()
    return res.status(200).json(data)
  } catch (err) {
    console.error('Gemini API error:', err)
    return res.status(500).json({ error: err.message })
  }
}
