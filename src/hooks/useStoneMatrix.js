import { useState, useRef } from 'react'
import { supabase } from '../supabaseClient'
import { parseKinshipHints, cleanNameForSearch, buildPersonSearchQuery } from '../utils/stoneMatrixUtils'

export function useStoneMatrix() {
  const [stoneMatrix, setStoneMatrixState] = useState(null)
  const stoneMatrixRef = useRef(null)
  const autoSearchTimer = useRef(null)

  const [matchingIndex, setMatchingIndex] = useState(0)
  const [matchSearchQuery, setMatchSearchQuery] = useState('')
  const [matchSearchResults, setMatchSearchResults] = useState([])
  const [matchSearching, setMatchSearching] = useState(false)
  const [matchSearchAttempted, setMatchSearchAttempted] = useState(false)

  // Keeps ref in sync with state on every update so async callbacks always read current data
  const setStoneMatrix = (updater) => {
    setStoneMatrixState(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      stoneMatrixRef.current = next
      return next
    })
  }

  // ── Initialisation ───────────────────────────────────────────────────────────

  const initMatrix = (geminiPeople, stone_condition, stone_notes) => {
    const people = (geminiPeople || []).map((p, index) => ({
      index,
      geminiData: p,
      correctedName: [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' '),
      role: 'occupant',
      relationships: parseKinshipHints(p.kinship_hints || []),
      confirmedRelationships: [],
      matchedRecord: null,
      matchStatus: 'pending',
    }))
    const matrix = { stone_condition: stone_condition || 'fair', stone_notes: stone_notes || '', people }
    stoneMatrixRef.current = matrix
    setStoneMatrixState(matrix)
    return matrix
  }

  const resetMatrix = () => {
    stoneMatrixRef.current = null
    setStoneMatrixState(null)
    setMatchingIndex(0)
    setMatchSearchQuery('')
    setMatchSearchResults([])
    setMatchSearching(false)
    setMatchSearchAttempted(false)
    if (autoSearchTimer.current) clearTimeout(autoSearchTimer.current)
  }

  // ── Matrix review handlers ───────────────────────────────────────────────────

  const updatePersonRole = (index, role) =>
    setStoneMatrix(prev => ({ ...prev, people: prev.people.map((p, i) => i === index ? { ...p, role } : p) }))

  const updateCorrectedName = (index, name) => {
    setStoneMatrix(prev => ({ ...prev, people: prev.people.map((p, i) => i === index ? { ...p, correctedName: name } : p) }))
    if (autoSearchTimer.current) clearTimeout(autoSearchTimer.current)
    autoSearchTimer.current = setTimeout(() => preSearchPerson(index, name), 800)
  }

  const preSearchPerson = async (index, name) => {
    if (!name.trim() || name.trim().length < 3) return
    const deathYear = stoneMatrixRef.current?.people?.[index]?.geminiData?.date_of_death_verbatim
    const { data } = await buildPersonSearchQuery(name, deathYear)
    if (data?.length) {
      setStoneMatrix(prev => {
        if (!prev?.people?.[index]) return prev
        return { ...prev, people: prev.people.map((p, i) => i === index ? { ...p, preSearchResults: data } : p) }
      })
    }
  }

  const updateRelField = (pIndex, rIndex, field, value) =>
    setStoneMatrix(prev => ({
      ...prev,
      people: prev.people.map((p, i) => i !== pIndex ? p : {
        ...p, relationships: p.relationships.map((r, ri) => ri !== rIndex ? r : { ...r, [field]: value })
      })
    }))

  const searchRelatedPerson = async (pIndex, rIndex, name) => {
    if (!name.trim()) return
    setStoneMatrix(prev => ({
      ...prev,
      people: prev.people.map((p, i) => i !== pIndex ? p : {
        ...p, relationships: p.relationships.map((r, ri) => ri !== rIndex ? r : { ...r, relSearching: true, relSearchResults: null })
      })
    }))
    const terms = name.trim().split(/\s+/)
    let q = supabase.from('v_deceased_search').select('*')
    if (terms.length === 1) {
      q = q.or(`first_name.ilike.*${terms[0]}*,last_name.ilike.*${terms[0]}*,maiden_name.ilike.*${terms[0]}*`)
    } else {
      q = q.ilike('last_name', `%${terms[terms.length - 1]}%`)
      terms.slice(0, -1).forEach(t => q = q.or(`first_name.ilike.%${t}%,middle_name.ilike.%${t}%,maiden_name.ilike.%${t}%`))
    }
    const { data } = await q.limit(5)
    setStoneMatrix(prev => ({
      ...prev,
      people: prev.people.map((p, i) => i !== pIndex ? p : {
        ...p, relationships: p.relationships.map((r, ri) => ri !== rIndex ? r : { ...r, relSearching: false, relSearchResults: data || [] })
      })
    }))
  }

  const confirmRelationship = (personIndex, rel, objectIndex) =>
    setStoneMatrix(prev => {
      const people = [...prev.people]
      const person = { ...people[personIndex] }
      person.confirmedRelationships = [...person.confirmedRelationships, {
        type: rel.type, hint: rel.hint, objectIndex,
        objectName: people[objectIndex]?.correctedName || rel.rawNames[0] || 'Unknown',
      }]
      people[personIndex] = person
      return { ...prev, people }
    })

  const skipRelationship = (personIndex, relIndex) =>
    setStoneMatrix(prev => ({
      ...prev,
      people: prev.people.map((p, i) => i !== personIndex ? p : {
        ...p, relationships: p.relationships.filter((_, ri) => ri !== relIndex)
      })
    }))

  const confirmRelationshipExternal = (pIndex, rIndex, rel, record) => {
    const objectName = record.full_name || [record.first_name, record.last_name].filter(Boolean).join(' ')
    setStoneMatrix(prev => {
      const people = [...prev.people]
      const person = { ...people[pIndex] }
      const rels = [...person.relationships]; rels.splice(rIndex, 1)
      person.relationships = rels
      person.confirmedRelationships = [...person.confirmedRelationships,
        { type: rel.type, hint: rel.hint, objectIndex: null, objectDeceasedId: record.deceased_id, objectName }]
      people[pIndex] = person
      return { ...prev, people }
    })
  }

  const confirmRelationshipNameOnly = (pIndex, rIndex, rel) => {
    const objectName = rel.relatedName || rel.rawNames[0] || 'Unknown'
    setStoneMatrix(prev => {
      const people = [...prev.people]
      const person = { ...people[pIndex] }
      const rels = [...person.relationships]; rels.splice(rIndex, 1)
      person.relationships = rels
      person.confirmedRelationships = [...person.confirmedRelationships,
        { type: rel.type, hint: rel.hint, objectIndex: null, objectDeceasedId: null, objectName }]
      people[pIndex] = person
      return { ...prev, people }
    })
  }

  // ── Match phase handlers ─────────────────────────────────────────────────────

  const prepareMatch = () => {
    supabase.from('v_deceased_search').select('deceased_id').limit(1) // warm connection
    const people = stoneMatrixRef.current?.people || []
    setMatchingIndex(0)
    setMatchSearchAttempted(false)
    setMatchSearchResults([])
    if (people.length > 0) {
      const first = people[0]
      setMatchSearchQuery(cleanNameForSearch(first.correctedName))
      if (first.preSearchResults?.length) {
        setMatchSearchResults(first.preSearchResults)
        setMatchSearchAttempted(true)
      }
    }
  }

  const handleMatchSearch = async (query) => {
    if (!query.trim()) return
    setMatchSearching(true)
    setMatchSearchResults([])
    setMatchSearchAttempted(true)
    const deathYear = stoneMatrixRef.current?.people?.[matchingIndex]?.geminiData?.date_of_death_verbatim
    const buildQ = () => buildPersonSearchQuery(query, deathYear)
    let { data, error } = await buildQ()
    if (error || !data) { await new Promise(r => setTimeout(r, 400)); ;({ data, error } = await buildQ()) }
    if (!error) setMatchSearchResults(data || [])
    setMatchSearching(false)
  }

  const selectMatch = (record) =>
    setStoneMatrix(prev => ({
      ...prev,
      people: prev.people.map((p, i) => i === matchingIndex ? { ...p, matchedRecord: record, matchStatus: 'matched' } : p)
    }))

  // Returns true when all people have been processed
  const advancePerson = () => {
    const next = matchingIndex + 1
    const people = stoneMatrixRef.current?.people || []
    setMatchingIndex(next)
    if (next < people.length) {
      const nextP = people[next]
      setMatchSearchQuery(cleanNameForSearch(nextP.correctedName))
      setMatchSearchResults(nextP.preSearchResults || [])
      setMatchSearchAttempted(!!(nextP.preSearchResults?.length))
    }
    return next >= people.length
  }

  const skipMatch = () =>
    setStoneMatrix(prev => ({
      ...prev,
      people: prev.people.map((p, i) => i === matchingIndex ? { ...p, matchStatus: 'skipped' } : p)
    }))

  const markAsNewRecord = () =>
    setStoneMatrix(prev => ({
      ...prev,
      people: prev.people.map((p, i) => i === matchingIndex ? { ...p, matchStatus: 'new' } : p)
    }))

  return {
    stoneMatrix, setStoneMatrix, stoneMatrixRef,
    matchingIndex, setMatchingIndex,
    matchSearchQuery, setMatchSearchQuery,
    matchSearchResults, setMatchSearchResults,
    matchSearching, matchSearchAttempted, setMatchSearchAttempted,
    initMatrix, resetMatrix, prepareMatch,
    updatePersonRole, updateCorrectedName, updateRelField,
    searchRelatedPerson, preSearchPerson,
    confirmRelationship, skipRelationship,
    confirmRelationshipExternal, confirmRelationshipNameOnly,
    handleMatchSearch, selectMatch, advancePerson, skipMatch, markAsNewRecord,
  }
}
