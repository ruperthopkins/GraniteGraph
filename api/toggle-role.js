import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { stone_id, deceased_id, role } = req.body || {}
  if (!stone_id || !deceased_id || !role) {
    return res.status(400).json({ error: 'stone_id, deceased_id, and role are required' })
  }
  if (!['occupant', 'mentioned'].includes(role)) {
    return res.status(400).json({ error: 'role must be occupant or mentioned' })
  }

  const supabase = createClient(
    process.env.REACT_APP_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const { error } = await supabase
    .from('stone_deceased')
    .update({ role })
    .eq('stone_id', stone_id)
    .eq('deceased_id', deceased_id)

  if (error) return res.status(500).json({ error: error.message })
  return res.status(200).json({ ok: true })
}
