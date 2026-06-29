import { supabase } from '../supabaseClient'

export function parseKinshipHints(hints) {
  if (!hints?.length) return []
  const out = []
  hints.forEach(hint => {
    const h = hint.trim()
    if (/\b(his|her)\s+wife\b/i.test(h)) { out.push({ type: 'spouse', rawNames: [], hint, implicit: true }); return }
    const spouseM = h.match(/\b(?:wife|husband|spouse|consort)\s+of\s+(.+)/i)
    if (spouseM) { out.push({ type: 'spouse', rawNames: [spouseM[1].trim().replace(/\.$/, '')], hint, implicit: false }); return }
    const childM = h.match(/\b(?:son|daughter|child)\s+of\s+(.+)/i)
    if (childM) {
      const names = childM[1].trim().replace(/\.$/, '').split(/\s+and\s+|\s*&\s*/i).map(n => n.trim()).filter(n => n.length > 2)
      out.push({ type: 'child', rawNames: names, hint, implicit: false }); return
    }
    if (/\btheir\s+(?:son|daughter|child)\b/i.test(h)) { out.push({ type: 'child', rawNames: [], hint, implicit: true, theirChild: true }); return }
    const parentM = h.match(/\b(?:father|mother|parent)\s+of\s+(.+)/i)
    if (parentM) {
      const names = parentM[1].trim().replace(/\.$/, '').split(/\s+and\s+|\s*&\s*/i).map(n => n.trim()).filter(n => n.length > 2)
      out.push({ type: 'parent', rawNames: names, hint, implicit: false }); return
    }
    const sibM = h.match(/\b(?:brother|sister|sibling)\s+of\s+(.+)/i)
    if (sibM) {
      const names = sibM[1].trim().replace(/\.$/, '').split(/\s+and\s+|\s*&\s*/i).map(n => n.trim()).filter(n => n.length > 2)
      out.push({ type: 'sibling', rawNames: names, hint, implicit: false })
    }
  })
  return out
}

export function cleanNameForSearch(name) {
  return name
    .replace(/\b[A-Z]\.\s*/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/[.,;:'"]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function buildPersonSearchQuery(name, deathYearVerbatim) {
  const terms = name.trim().split(/[\s,]+/).filter(Boolean)
  let q = supabase.from('v_deceased_search').select('*')
  if (terms.length === 1) {
    q = q.or(`first_name.ilike.*${terms[0]}*,last_name.ilike.*${terms[0]}*,maiden_name.ilike.*${terms[0]}*`)
  } else {
    q = q.ilike('last_name', `%${terms[terms.length - 1]}%`)
    terms.slice(0, -1).forEach(t => q = q.or(`first_name.ilike.%${t}%,middle_name.ilike.%${t}%,maiden_name.ilike.%${t}%`))
  }
  const yr = (deathYearVerbatim || '').match(/\d{4}/)?.[0]
  if (yr) {
    const y = parseInt(yr)
    if (y >= 1700 && y <= 2030)
      q = q.or(`date_of_death.is.null,and(date_of_death.gte.${y - 15}-01-01,date_of_death.lte.${y + 15}-12-31)`)
  }
  return q.order('last_name').order('first_name').limit(20)
}
