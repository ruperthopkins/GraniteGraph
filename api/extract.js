// api/extract.js  — drop this in your /api folder alongside analyze.js
// Proxies text extraction requests to Anthropic so the API key stays server-side

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { text, system } = req.body
  if (!text || !system) {
    return res.status(400).json({ error: 'Missing text or system prompt' })
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
         model: 'claude-sonnet-4-20250514',
        max_tokens: 6000,
        system,
        messages: [{ role: 'user', content: text }],
      }),
    })

    const data = await response.json()
    return res.status(200).json(data)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
