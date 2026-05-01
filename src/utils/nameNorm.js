const MONTH_NAMES = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
}

// Parses a verbatim date string into a normalized partial-ISO string.
// Returns "YYYY-MM-DD", "YYYY-MM", "YYYY", or null.
// Handles formats like: "Jun 22, 1830", "June 22, 1830", "1830 Jun 22",
//   "Aug. 2, 1792", "March 28, 1812", "b. 1812 Mar 28", "1830"
export function parseDate(verbatim) {
  if (!verbatim) return null
  let s = String(verbatim).trim()
  // Strip leading qualifiers: b., d., m., ca., c., abt., circa
  s = s.replace(/^(ca?\.?|abt\.?|circa|[bdmc]\.)\s*/i, '')

  const yearMatch = s.match(/\b(1[5-9]\d\d|20\d\d)\b/)
  if (!yearMatch) return null
  const year = yearMatch[1]

  const wordMatch = s.match(/\b([a-zA-Z]+)\.?\b/)
  let month = null
  if (wordMatch) {
    const key = wordMatch[1].toLowerCase()
    month = MONTH_NAMES[key] ?? null
  }
  if (!month) return year

  const noYear = s.replace(yearMatch[0], '')
  const noMonth = noYear.replace(wordMatch[0], '')
  const dayMatch = noMonth.match(/\b([12]?\d)\b/)
  if (!dayMatch) return `${year}-${String(month).padStart(2, '0')}`
  const day = parseInt(dayMatch[1], 10)
  if (day < 1 || day > 31) return `${year}-${String(month).padStart(2, '0')}`
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export const FIRST_NAME_MAP = {
  'jno': 'John',
  'wm': 'William',
  'thos': 'Thomas',
  'jas': 'James',
  'saml': 'Samuel',
  'robt': 'Robert',
  'richd': 'Richard',
  'edwd': 'Edward',
  'nathl': 'Nathaniel',
  'benj': 'Benjamin',
  'eliz': 'Elizabeth',
  'cath': 'Catherine',
  'phebe': 'Phoebe',
  'mehetable': 'Mehitabel',
  'meheatable': 'Mehitabel',
  'bethiah': 'Bethia',
  'bethian': 'Bethia',
  'abigale': 'Abigail',
  'abbigail': 'Abigail',
}

export function normToken(token) {
  if (!token) return ''
  const stripped = token.replace(/\.$/, '').trim()
  const lower = stripped.toLowerCase()
  if (FIRST_NAME_MAP[lower]) return FIRST_NAME_MAP[lower]
  return stripped.charAt(0).toUpperCase() + stripped.slice(1).toLowerCase()
}

// Extract first name from full_name if first_name field is absent (e.g. view records)
function extractFirstName(person) {
  if (person.first_name) return normToken(person.first_name)
  if (person.full_name) return normToken(person.full_name.trim().split(/\s+/)[0])
  return ''
}

export function normaliseName(person) {
  return {
    first_name: extractFirstName(person),
    middle_name: normToken(person.middle_name),
    last_name: person.last_name
      ? person.last_name.charAt(0).toUpperCase() + person.last_name.slice(1).toLowerCase()
      : '',
    maiden_name: person.maiden_name
      ? person.maiden_name.charAt(0).toUpperCase() + person.maiden_name.slice(1).toLowerCase()
      : '',
  }
}

function levenshtein(a, b) {
  const m = a.length, n = b.length
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}

export function matchScore(a, b) {
  const na = normaliseName(a)
  const nb = normaliseName(b)
  let score = 0

  const fa = na.first_name.toLowerCase()
  const fb = nb.first_name.toLowerCase()
  const la = na.last_name.toLowerCase()
  const lb = nb.last_name.toLowerCase()
  const ma = na.maiden_name.toLowerCase()
  const mb = nb.maiden_name.toLowerCase()

  // First name (required signal — no score without it)
  let firstNameScore = 0
  if (fa && fb) {
    if (fa === fb) firstNameScore = 35
    else if (fa.startsWith(fb.slice(0, 3)) || fb.startsWith(fa.slice(0, 3)) || levenshtein(fa, fb) <= 2) firstNameScore = 15
  }
  score += firstNameScore

  // Last name exact or fuzzy
  if (la && lb) {
    if (la === lb) score += 25
    else if (levenshtein(la, lb) <= 2) score += 10
  }

  // Maiden ↔ last cross-match: one record's maiden name is the other's surname.
  // This is the primary signal for the same woman appearing under different names.
  // Only award if first names also matched (firstNameScore > 0).
  if (firstNameScore > 0) {
    if (ma && lb && ma === lb) score += 25   // a.maiden = b.last
    if (mb && la && mb === la) score += 25   // b.maiden = a.last
    if (ma && mb && ma === mb) score += 15   // same maiden name on both
  }

  // Birth date — use parsed precision when available, fall back to year integer
  const pbA = a.date_of_birth_parsed || parseDate(a.date_of_birth_verbatim)
  const pbB = b.date_of_birth_parsed || parseDate(b.date_of_birth_verbatim)
  if (pbA && pbB) {
    const len = Math.min(pbA.length, pbB.length)
    if (pbA.slice(0, len) === pbB.slice(0, len)) {
      score += pbA.length >= 10 && pbB.length >= 10 ? 20  // full date match
             : pbA.length >= 7  && pbB.length >= 7  ? 15  // year+month match
             : 10                                          // year only match
    } else {
      const yA = parseInt(pbA, 10), yB = parseInt(pbB, 10)
      if (Math.abs(yA - yB) <= 1) score += 5
    }
  } else {
    const bayA = a.date_of_birth_year, bayB = b.date_of_birth_year
    if (bayA && bayB && Math.abs(bayA - bayB) <= 2) score += 10
  }

  // Death date — same logic
  const pdA = a.date_of_death_parsed || parseDate(a.date_of_death_verbatim)
  const pdB = b.date_of_death_parsed || parseDate(b.date_of_death_verbatim)
  if (pdA && pdB) {
    const len = Math.min(pdA.length, pdB.length)
    if (pdA.slice(0, len) === pdB.slice(0, len)) {
      score += pdA.length >= 10 && pdB.length >= 10 ? 20
             : pdA.length >= 7  && pdB.length >= 7  ? 15
             : 10
    } else {
      const dA = parseInt(pdA, 10), dB = parseInt(pdB, 10)
      if (Math.abs(dA - dB) <= 1) score += 5
    }
  } else {
    const dayA = a.date_of_death_year, dayB = b.date_of_death_year
    if (dayA && dayB && Math.abs(dayA - dayB) <= 2) score += 10
  }

  // Church event date match (catches same-day marriages across name variants)
  if (a.church_event_date_verbatim && b.church_event_date_verbatim &&
      a.church_event_date_verbatim.trim() === b.church_event_date_verbatim.trim() &&
      firstNameScore > 0) {
    score += 15
  }

  // Gender match (minor boost)
  if (a.gender && b.gender && a.gender === b.gender) score += 5

  return score
}
