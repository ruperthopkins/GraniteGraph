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

// Extract first/last name from full_name when the individual fields are absent
// (e.g. Seaview cemetery records imported as full_name only)
function extractFirstName(person) {
  if (person.first_name) return normToken(person.first_name)
  if (person.full_name) return normToken(person.full_name.trim().split(/\s+/)[0])
  return ''
}

function extractLastName(person) {
  if (person.last_name) return person.last_name.charAt(0).toUpperCase() + person.last_name.slice(1).toLowerCase()
  if (person.full_name) {
    const parts = person.full_name.trim().split(/\s+/)
    if (parts.length > 1) return normToken(parts[parts.length - 1])
  }
  return ''
}

export function normaliseName(person) {
  return {
    first_name: extractFirstName(person),
    middle_name: normToken(person.middle_name),
    last_name: extractLastName(person),
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

// Returns { score, reasons } where reasons is an array of { label, detail, points }.
// Use this when you need to explain the match to a user.
export function matchScoreDetails(a, b) {
  const na = normaliseName(a)
  const nb = normaliseName(b)
  const reasons = []
  let score = 0

  const fa = na.first_name.toLowerCase()
  const fb = nb.first_name.toLowerCase()
  const la = na.last_name.toLowerCase()
  const lb = nb.last_name.toLowerCase()
  const mida = na.middle_name.toLowerCase()
  const midb = nb.middle_name.toLowerCase()
  const ma = na.maiden_name.toLowerCase()
  const mb = nb.maiden_name.toLowerCase()

  // First name
  let firstNameScore = 0
  if (fa && fb) {
    if (fa === fb) {
      firstNameScore = 35
      reasons.push({ label: 'First name', detail: `${na.first_name} = ${nb.first_name}`, points: 35 })
    } else if (fa.startsWith(fb.slice(0, 3)) || fb.startsWith(fa.slice(0, 3)) || levenshtein(fa, fb) <= 2) {
      firstNameScore = 15
      reasons.push({ label: 'First name', detail: `${na.first_name} ≈ ${nb.first_name}`, points: 15 })
    }
  }
  score += firstNameScore

  // Last name
  if (la && lb) {
    if (la === lb) {
      score += 25
      reasons.push({ label: 'Last name', detail: `${na.last_name} = ${nb.last_name}`, points: 25 })
    } else if (levenshtein(la, lb) <= 2) {
      score += 10
      reasons.push({ label: 'Last name', detail: `${na.last_name} ≈ ${nb.last_name}`, points: 10 })
    }
  }

  // Middle name / initial
  if (mida && midb && firstNameScore > 0) {
    if (mida === midb) {
      score += 10
      reasons.push({ label: 'Middle name', detail: `${na.middle_name} = ${nb.middle_name}`, points: 10 })
    } else if (mida[0] === midb[0]) {
      score += 5
      reasons.push({ label: 'Middle initial', detail: `${mida[0].toUpperCase()} = ${midb[0].toUpperCase()}`, points: 5 })
    }
  }

  // Maiden ↔ last cross-match
  if (firstNameScore > 0) {
    if (ma && lb && ma === lb) {
      score += 25; reasons.push({ label: 'Maiden = last name', detail: `${na.maiden_name} = ${nb.last_name}`, points: 25 })
    }
    if (mb && la && mb === la) {
      score += 25; reasons.push({ label: 'Maiden = last name', detail: `${nb.maiden_name} = ${na.last_name}`, points: 25 })
    }
    if (ma && mb && ma === mb) {
      score += 15; reasons.push({ label: 'Maiden name', detail: `${na.maiden_name} = ${nb.maiden_name}`, points: 15 })
    }
  }

  // Birth date — reward matches, penalise confirmed mismatches
  // Penalty prevents same-name different-generation records from appearing as duplicates.
  const pbA = a.date_of_birth_parsed || parseDate(a.date_of_birth_verbatim)
  const pbB = b.date_of_birth_parsed || parseDate(b.date_of_birth_verbatim)
  if (pbA && pbB) {
    const yA = parseInt(pbA, 10), yB = parseInt(pbB, 10)
    const len = Math.min(pbA.length, pbB.length)
    if (pbA.slice(0, len) === pbB.slice(0, len)) {
      const pts = pbA.length >= 10 && pbB.length >= 10 ? 20 : pbA.length >= 7 && pbB.length >= 7 ? 15 : 10
      score += pts
      reasons.push({ label: 'Birth date', detail: `${pbA} = ${pbB}`, points: pts })
    } else if (Math.abs(yA - yB) <= 1) {
      score += 5; reasons.push({ label: 'Birth year', detail: `${yA} ≈ ${yB}`, points: 5 })
    } else {
      score -= 25; reasons.push({ label: 'Birth date mismatch', detail: `${pbA} ≠ ${pbB}`, points: -25 })
    }
  } else {
    const bayA = a.date_of_birth_year, bayB = b.date_of_birth_year
    if (bayA && bayB) {
      if (Math.abs(bayA - bayB) <= 2) {
        score += 10; reasons.push({ label: 'Birth year', detail: `${bayA} ≈ ${bayB}`, points: 10 })
      } else {
        score -= 25; reasons.push({ label: 'Birth year mismatch', detail: `${bayA} ≠ ${bayB}`, points: -25 })
      }
    }
  }

  // Death date — same logic
  const pdA = a.date_of_death_parsed || parseDate(a.date_of_death_verbatim)
  const pdB = b.date_of_death_parsed || parseDate(b.date_of_death_verbatim)
  if (pdA && pdB) {
    const dA = parseInt(pdA, 10), dB = parseInt(pdB, 10)
    const len = Math.min(pdA.length, pdB.length)
    if (pdA.slice(0, len) === pdB.slice(0, len)) {
      const pts = pdA.length >= 10 && pdB.length >= 10 ? 20 : pdA.length >= 7 && pdB.length >= 7 ? 15 : 10
      score += pts
      reasons.push({ label: 'Death date', detail: `${pdA} = ${pdB}`, points: pts })
    } else if (Math.abs(dA - dB) <= 1) {
      score += 5; reasons.push({ label: 'Death year', detail: `${dA} ≈ ${dB}`, points: 5 })
    } else {
      score -= 25; reasons.push({ label: 'Death date mismatch', detail: `${pdA} ≠ ${pdB}`, points: -25 })
    }
  } else {
    const dayA = a.date_of_death_year, dayB = b.date_of_death_year
    if (dayA && dayB) {
      if (Math.abs(dayA - dayB) <= 2) {
        score += 10; reasons.push({ label: 'Death year', detail: `${dayA} ≈ ${dayB}`, points: 10 })
      } else {
        score -= 25; reasons.push({ label: 'Death year mismatch', detail: `${dayA} ≠ ${dayB}`, points: -25 })
      }
    }
  }

  // Church event date
  if (a.church_event_date_verbatim && b.church_event_date_verbatim &&
      a.church_event_date_verbatim.trim() === b.church_event_date_verbatim.trim() &&
      firstNameScore > 0) {
    score += 15
    reasons.push({ label: 'Church event', detail: a.church_event_date_verbatim.trim(), points: 15 })
  }

  // Gender
  if (a.gender && b.gender && a.gender === b.gender) {
    score += 5; reasons.push({ label: 'Gender', detail: a.gender, points: 5 })
  }

  return { score, reasons }
}

export function matchScore(a, b) {
  return matchScoreDetails(a, b).score
}

export const MONTH_ABBR = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function fmtDate(verbatim, parsed) {
  const p = parsed || parseDate(verbatim)
  if (!p) return verbatim || null
  const parts = p.split('-')
  if (parts.length === 3) return `${parseInt(parts[2])} ${MONTH_ABBR[parseInt(parts[1])]} ${parts[0]}`
  if (parts.length === 2) return `${MONTH_ABBR[parseInt(parts[1])]} ${parts[0]}`
  return parts[0]
}
