// api/extract.js
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { text, system } = req.body
  if (!text || !system) {
    return res.status(400).json({ error: 'Missing text or system prompt' })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set in environment' })
  }

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
        system,
        messages: [{ role: 'user', content: text }],
      }),
    })

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}))
      console.error('Anthropic HTTP error:', response.status, JSON.stringify(errData))
      return res.status(response.status).json({ error: errData.error?.message || 'Anthropic API error', type: errData.error?.type })
    }

    const data = await response.json()

    if (data.error) {
      console.error('Anthropic error:', JSON.stringify(data.error))
      return res.status(400).json({ error: data.error.message, type: data.error.type })
    }

    return res.status(200).json(data)
  } catch (err) {
    console.error('Extract handler error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}