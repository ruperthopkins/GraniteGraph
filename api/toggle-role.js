import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Verify caller is authenticated and has admin or researcher role
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim()
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const userClient = createClient(
    process.env.REACT_APP_SUPABASE_URL,
    process.env.REACT_APP_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  )
  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError || !user) return res.status(401).json({ error: 'Unauthorized' })

  const { data: profile } = await userClient
    .from('volunteer_profiles')
    .select('role')
    .eq('user_id', user.id)
    .single()
  if (!profile || !['admin', 'researcher'].includes(profile.role)) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  const { stone_id, deceased_id, role } = req.body || {}
  if (!stone_id || !deceased_id || !role) {
    return res.status(400).json({ error: 'stone_id, deceased_id, and role are required' })
  }
  if (!['occupant', 'mentioned'].includes(role)) {
    return res.status(400).json({ error: 'role must be occupant or mentioned' })
  }

  const serviceClient = createClient(
    process.env.REACT_APP_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
  const { error } = await serviceClient
    .from('stone_deceased')
    .update({ role })
    .eq('stone_id', stone_id)
    .eq('deceased_id', deceased_id)

  if (error) return res.status(500).json({ error: error.message })
  return res.status(200).json({ ok: true })
}
