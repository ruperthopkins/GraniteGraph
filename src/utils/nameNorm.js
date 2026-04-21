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

export function normaliseName(person) {
  return {
    first_name: normToken(person.first_name),
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

  // First name
  const fa = na.first_name.toLowerCase()
  const fb = nb.first_name.toLowerCase()
  if (fa && fb) {
    if (fa === fb) {
      score += 40
    } else if (fa.startsWith(fb.slice(0, 3)) || fb.startsWith(fa.slice(0, 3)) || levenshtein(fa, fb) <= 2) {
      score += 20
    }
  }

  // Last name
  const la = na.last_name.toLowerCase()
  const lb = nb.last_name.toLowerCase()
  if (la && lb) {
    if (la === lb) {
      score += 30
    } else if (levenshtein(la, lb) <= 2) {
      score += 15
    }
  }

  // Birth year proximity
  const bayA = a.date_of_birth_year, bayB = b.date_of_birth_year
  if (bayA && bayB && Math.abs(bayA - bayB) <= 2) score += 10

  // Death year proximity
  const dayA = a.date_of_death_year, dayB = b.date_of_death_year
  if (dayA && dayB && Math.abs(dayA - dayB) <= 2) score += 10

  // Maiden name cross-match
  if (na.maiden_name && nb.maiden_name) {
    if (na.maiden_name.toLowerCase() === nb.maiden_name.toLowerCase()) score += 5
  } else if (na.maiden_name && nb.last_name) {
    if (na.maiden_name.toLowerCase() === nb.last_name.toLowerCase()) score += 5
  } else if (nb.maiden_name && na.last_name) {
    if (nb.maiden_name.toLowerCase() === na.last_name.toLowerCase()) score += 5
  }

  // Gender match
  if (a.gender && b.gender && a.gender === b.gender) score += 5

  return score
}
