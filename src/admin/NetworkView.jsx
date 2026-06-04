// src/admin/NetworkView.jsx
// Community graph visualization — kinship network with patriot affiliation overlay

import { useState, useEffect, useRef, useCallback } from 'react'
import { ForceGraph2D } from 'react-force-graph'
import { supabase } from '../supabaseClient'

// ── Color palettes ────────────────────────────────────────────────────────────
const FAMILY_PALETTE = {
  Woodhull: '#f59e0b',
  Smith:    '#3b82f6',
  Hopkins:  '#10b981',
  Talmadge: '#8b5cf6',
  Davis:    '#94a3b8',
  Hallock:  '#6366f1',
  Brown:    '#78716c',
  Miller:   '#a8a29e',
  Norton:   '#f472b6',
  Hawkins:  '#67e8f9',
  Helme:    '#fde68a',
  Phillips: '#c4b5fd',
  Homan:    '#86efac',
  Tooker:   '#fb923c',
  Jones:    '#e879f9',
}

const AFFIL_META = {
  association_papers: { label: 'Association Papers', color: '#6ee7b7', bg: 'rgba(5,150,105,0.2)' },
  ny_militia:         { label: 'NY Militia',          color: '#6ee7b7', bg: 'rgba(5,150,105,0.2)' },
  continental_army:   { label: 'Continental Army',    color: '#34d399', bg: 'rgba(5,150,105,0.2)' },
  culper_ring:        { label: 'Culper Ring',         color: '#93c5fd', bg: 'rgba(37,99,235,0.2)' },
  loyalist:           { label: 'Crown Loyalist',      color: '#fca5a5', bg: 'rgba(185,28,28,0.2)' },
}

const LINK_COLORS = {
  parent:  'rgba(251,191,36,0.4)',
  child:   'rgba(251,191,36,0.4)',
  spouse:  'rgba(167,139,250,0.45)',
  sibling: 'rgba(148,163,184,0.25)',
  unknown: 'rgba(100,116,139,0.15)',
}

function hashColor(s) {
  let h = 0
  for (const c of (s || '')) h = (Math.imul(31, h) + c.charCodeAt(0)) | 0
  return `hsl(${(Math.abs(h) * 137) % 360}, 55%, 55%)`
}

function familyColor(lastName) {
  return FAMILY_PALETTE[lastName] || hashColor(lastName)
}

function topAffil(affiliations) {
  const order = ['culper_ring', 'continental_army', 'ny_militia', 'association_papers', 'loyalist']
  return order.find(a => (affiliations || []).includes(a)) || null
}

// ── BFS helper ────────────────────────────────────────────────────────────────
function bfsNodes(centerId, degrees, adjMap) {
  const visited = new Set([centerId])
  let frontier = [centerId]
  for (let d = 0; d < degrees; d++) {
    const next = []
    for (const id of frontier) {
      for (const nbr of (adjMap[id] || [])) {
        if (!visited.has(nbr)) { visited.add(nbr); next.push(nbr) }
      }
    }
    frontier = next
  }
  return visited
}

// ── Main component ────────────────────────────────────────────────────────────
export default function NetworkView({ onBack, onOpenPerson }) {
  const fgRef = useRef()
  const containerRef = useRef()
  const [dims, setDims] = useState({ w: 800, h: 600 })

  // Raw data
  const [allNodes, setAllNodes] = useState([])   // deceased records
  const [allLinks, setAllLinks] = useState([])   // deduplicated kinship pairs
  const [adjMap, setAdjMap]     = useState({})   // id → [id]
  const [loading, setLoading]   = useState(true)

  // View controls
  const [centerPerson, setCenterPerson] = useState(null)  // node object
  const [degrees, setDegrees]           = useState(2)
  const [showAll, setShowAll]           = useState(false)
  const [affilHighlight, setAffilHighlight] = useState(true)
  const [visibleFamilies, setVisibleFamilies] = useState(new Set())
  const [familyList, setFamilyList]           = useState([])

  // Search for ego center
  const [searchQ, setSearchQ]       = useState('')
  const [searchRes, setSearchRes]   = useState([])
  const [searching, setSearching]   = useState(false)

  // Selected node info panel
  const [selectedNode, setSelectedNode] = useState(null)

  // Derived graph data sent to ForceGraph
  const [graphData, setGraphData] = useState({ nodes: [], links: [] })

  // ── Load data ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const [dResp, kResp] = await Promise.all([
        supabase.from('deceased').select(
          'deceased_id,first_name,last_name,title,generation_suffix,date_of_birth_verbatim,date_of_death_verbatim,patriot_affiliations'
        ).limit(3000),
        supabase.from('kinship').select(
          'primary_deceased_id,relative_deceased_id,relationship_type'
        ).limit(5000),
      ])

      const deceasedMap = {}
      const nodeList = (dResp.data || []).map(p => {
        const baseName = [p.first_name, p.last_name].filter(Boolean).join(' ')
        const displayName = [p.title, baseName, p.generation_suffix].filter(Boolean).join(' ')
        const node = {
          id:          p.deceased_id,
          name:        displayName || '?',
          lastName:    p.last_name || '',
          color:       familyColor(p.last_name),
          affiliations: p.patriot_affiliations || [],
          bYear: (p.date_of_birth_verbatim || '').match(/\b(1[4-9]\d{2}|20\d{2})\b/)?.[1] || null,
          dYear: (p.date_of_death_verbatim || '').match(/\b(1[4-9]\d{2}|20\d{2})\b/)?.[1] || null,
          val: 3,
          degree: 0,
          raw: p,
        }
        deceasedMap[p.deceased_id] = node
        return node
      })

      // Deduplicate kinship — keep only pairs where primary < relative lexicographically
      const seen = new Set()
      const linkList = []
      const adj = {}
      for (const k of (kResp.data || [])) {
        const a = k.primary_deceased_id, b = k.relative_deceased_id
        if (!a || !b || a === b) continue
        const key = a < b ? `${a}|${b}` : `${b}|${a}`
        if (seen.has(key)) continue
        seen.add(key)
        if (!deceasedMap[a] || !deceasedMap[b]) continue
        linkList.push({ source: a, target: b, type: k.relationship_type })
        adj[a] = adj[a] || []; adj[a].push(b)
        adj[b] = adj[b] || []; adj[b].push(a)
      }

      // Compute degree and node size
      for (const node of nodeList) {
        node.degree = (adj[node.id] || []).length
        node.val = Math.max(2, Math.min(14, 2 + node.degree * 0.8))
      }

      // Build family list sorted by count (only families with ≥2 members)
      const fCount = {}
      for (const n of nodeList) fCount[n.lastName] = (fCount[n.lastName] || 0) + 1
      const families = Object.entries(fCount)
        .filter(([, c]) => c >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([name, count]) => ({ name, count, color: familyColor(name) }))

      setAllNodes(nodeList)
      setAllLinks(linkList)
      setAdjMap(adj)
      setFamilyList(families)
      setVisibleFamilies(new Set(families.map(f => f.name)))
      setLoading(false)
    }
    load()
  }, [])

  // ── Recompute graph data when filters change ─────────────────────────────────
  useEffect(() => {
    if (allNodes.length === 0) return

    let nodeIds

    if (centerPerson && !showAll) {
      // Ego network
      nodeIds = bfsNodes(centerPerson.id, degrees, adjMap)
    } else if (!showAll) {
      // Default: only nodes with at least one connection
      nodeIds = new Set(allNodes.filter(n => n.degree > 0).map(n => n.id))
      // Cap at 400 for performance
      if (nodeIds.size > 400) {
        const sorted = [...allNodes].filter(n => nodeIds.has(n.id))
          .sort((a, b) => b.degree - a.degree)
          .slice(0, 400)
        nodeIds = new Set(sorted.map(n => n.id))
      }
    } else {
      nodeIds = new Set(allNodes.map(n => n.id))
    }

    // Apply family filter
    const nodes = allNodes.filter(n => nodeIds.has(n.id) && visibleFamilies.has(n.lastName))
    const nodeSet = new Set(nodes.map(n => n.id))
    const links = allLinks.filter(l => nodeSet.has(l.source) && nodeSet.has(l.target))

    setGraphData({ nodes, links })
  }, [allNodes, allLinks, adjMap, centerPerson, degrees, showAll, visibleFamilies])

  // ── Container resize ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver(entries => {
      const e = entries[0]
      if (e) setDims({ w: e.contentRect.width, h: e.contentRect.height })
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  // ── Search for ego center ───────────────────────────────────────────────────
  const searchPerson = useCallback(async () => {
    if (!searchQ.trim()) return
    setSearching(true)
    const terms = searchQ.trim().split(/\s+/)
    const last = terms[terms.length - 1]
    const { data } = await supabase.from('v_deceased_search').select('*')
      .ilike('last_name', `%${last}%`).order('last_name').limit(20)
    setSearchRes(data || [])
    setSearching(false)
  }, [searchQ])

  const pickCenter = useCallback((person) => {
    const node = allNodes.find(n => n.id === person.deceased_id)
    if (node) { setCenterPerson(node); setShowAll(false) }
    setSearchRes([])
    setSearchQ('')
  }, [allNodes])

  // ── Node canvas rendering ───────────────────────────────────────────────────
  const paintNode = useCallback((node, ctx, globalScale) => {
    const r = Math.sqrt(node.val) * 2.5
    const affilKey = affilHighlight ? topAffil(node.affiliations) : null
    const isFocal = centerPerson?.id === node.id

    // Glow ring for patriot affiliations
    if (affilKey) {
      ctx.beginPath()
      ctx.arc(node.x, node.y, r + 3, 0, 2 * Math.PI)
      ctx.fillStyle = AFFIL_META[affilKey]?.bg || 'rgba(110,231,183,0.2)'
      ctx.fill()
    }

    // Focal highlight
    if (isFocal) {
      ctx.beginPath()
      ctx.arc(node.x, node.y, r + 4, 0, 2 * Math.PI)
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 2 / globalScale
      ctx.stroke()
    }

    // Node circle
    ctx.beginPath()
    ctx.arc(node.x, node.y, r, 0, 2 * Math.PI)
    ctx.fillStyle = node.color
    ctx.fill()

    // Affiliation border ring
    if (affilKey) {
      ctx.beginPath()
      ctx.arc(node.x, node.y, r, 0, 2 * Math.PI)
      ctx.strokeStyle = AFFIL_META[affilKey]?.color || '#6ee7b7'
      ctx.lineWidth = 2 / globalScale
      ctx.stroke()
    }

    // Label — show at zoom ≥ 1.8, or always for focal / affiliated
    const showLabel = globalScale >= 1.8 || isFocal || (affilHighlight && affilKey)
    if (showLabel) {
      const fontSize = Math.min(12, 11 / globalScale)
      ctx.font = `${isFocal ? 'bold ' : ''}${fontSize}px sans-serif`
      ctx.fillStyle = '#f1f5f9'
      ctx.textAlign = 'center'
      ctx.fillText(node.name, node.x, node.y + r + fontSize + 1)
    }
  }, [centerPerson, affilHighlight])

  const linkColor = useCallback(link => LINK_COLORS[link.type] || LINK_COLORS.unknown, [])
  const linkWidth = useCallback(link => link.type === 'spouse' ? 1.5 : 0.8, [])

  // ── Node click ───────────────────────────────────────────────────────────────
  const handleNodeClick = useCallback(node => {
    setSelectedNode(prev => prev?.id === node.id ? null : node)
  }, [])

  // ── Styles ───────────────────────────────────────────────────────────────────
  const panel = {
    background: 'rgba(15,23,42,0.95)',
    border: '0.5px solid #1e293b',
    borderRadius: 8,
    padding: '12px 14px',
  }
  const label = { fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 4px', fontWeight: 500 }
  const mutedBtn = (active) => ({
    fontSize: 11, padding: '3px 10px', borderRadius: 99, cursor: 'pointer',
    background: active ? '#1e3a5f' : 'transparent',
    border: `0.5px solid ${active ? '#3b82f6' : '#334155'}`,
    color: active ? '#93c5fd' : '#64748b',
  })

  // ── RENDER ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0f172a', color: '#e2e8f0', fontFamily: 'sans-serif' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: '#0f172a', borderBottom: '0.5px solid #1e293b', flexShrink: 0 }}>
        {onBack && <button onClick={onBack} style={{ fontSize: 13, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer' }}>← Admin</button>}
        <p style={{ fontWeight: 600, fontSize: 15, margin: 0, color: '#e2e8f0' }}>Community Graph</p>
        <span style={{ fontSize: 12, color: '#475569' }}>
          {loading ? 'Loading…' : `${graphData.nodes.length} people · ${graphData.links.length} connections`}
        </span>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* ── Left sidebar ── */}
        <div style={{ width: 260, flexShrink: 0, overflowY: 'auto', padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 10, borderRight: '0.5px solid #1e293b' }}>

          {/* Ego center search */}
          <div style={panel}>
            <p style={label}>Center on person</p>
            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <input value={searchQ} onChange={e => { setSearchQ(e.target.value); setSearchRes([]) }}
                onKeyDown={e => e.key === 'Enter' && searchPerson()}
                placeholder="Last name…"
                style={{ flex: 1, fontSize: 12, background: '#1e293b', border: '0.5px solid #334155', borderRadius: 6, padding: '4px 8px', color: '#e2e8f0', outline: 'none' }} />
              <button onClick={searchPerson} disabled={searching}
                style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: '#1e3a5f', border: '0.5px solid #3b82f6', color: '#93c5fd', cursor: 'pointer' }}>
                {searching ? '…' : 'Go'}
              </button>
            </div>
            {searchRes.length > 0 && (
              <div style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
                {searchRes.map(r => (
                  <div key={r.deceased_id} onClick={() => pickCenter(r)}
                    style={{ fontSize: 12, padding: '4px 8px', borderRadius: 5, cursor: 'pointer', background: '#1e293b', color: '#cbd5e1' }}>
                    {r.full_name}
                    {r.date_of_death_verbatim && <span style={{ color: '#475569' }}> d.{r.date_of_death_verbatim.match(/\d{4}/)?.[0]}</span>}
                  </div>
                ))}
              </div>
            )}
            {centerPerson && (
              <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, color: '#93c5fd', fontWeight: 500 }}>{centerPerson.name}</span>
                <button onClick={() => { setCenterPerson(null); setShowAll(false) }}
                  style={{ fontSize: 10, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
              </div>
            )}
          </div>

          {/* Degree radius */}
          {centerPerson && (
            <div style={panel}>
              <p style={label}>Degrees from center</p>
              <div style={{ display: 'flex', gap: 5 }}>
                {[1, 2, 3, 4].map(d => (
                  <button key={d} onClick={() => setDegrees(d)} style={mutedBtn(degrees === d && !showAll)}>{d}</button>
                ))}
              </div>
            </div>
          )}

          {/* Show mode */}
          <div style={panel}>
            <p style={label}>View mode</p>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              <button onClick={() => setShowAll(false)} style={mutedBtn(!showAll && !centerPerson)}>Connected</button>
              <button onClick={() => setShowAll(true)} style={mutedBtn(showAll)}>All</button>
            </div>
          </div>

          {/* Affiliation highlight */}
          <div style={panel}>
            <p style={label}>Overlay</p>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 12, color: affilHighlight ? '#6ee7b7' : '#64748b' }}>
              <input type="checkbox" checked={affilHighlight} onChange={e => setAffilHighlight(e.target.checked)} />
              Patriot affiliations
            </label>
            {affilHighlight && (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {Object.entries(AFFIL_META).map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: v.color, flexShrink: 0 }} />
                    <span style={{ color: '#94a3b8' }}>{v.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Family filter */}
          <div style={panel}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <p style={{ ...label, margin: 0 }}>Families</p>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => setVisibleFamilies(new Set(familyList.map(f => f.name)))}
                  style={{ fontSize: 10, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer' }}>all</button>
                <button onClick={() => setVisibleFamilies(new Set())}
                  style={{ fontSize: 10, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer' }}>none</button>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 300, overflowY: 'auto' }}>
              {familyList.map(f => (
                <label key={f.name} style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 12,
                  color: visibleFamilies.has(f.name) ? '#e2e8f0' : '#475569' }}>
                  <input type="checkbox" checked={visibleFamilies.has(f.name)} onChange={e => {
                    setVisibleFamilies(prev => {
                      const next = new Set(prev)
                      e.target.checked ? next.add(f.name) : next.delete(f.name)
                      return next
                    })
                  }} />
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: f.color, flexShrink: 0, display: 'inline-block' }} />
                  {f.name} <span style={{ color: '#475569', marginLeft: 'auto' }}>{f.count}</span>
                </label>
              ))}
            </div>
          </div>

        </div>

        {/* ── Canvas area ── */}
        <div ref={containerRef} style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <p style={{ color: '#475569', fontSize: 14 }}>Loading graph data…</p>
            </div>
          ) : graphData.nodes.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <p style={{ color: '#475569', fontSize: 14 }}>No nodes match the current filters.</p>
            </div>
          ) : (
            <ForceGraph2D
              ref={fgRef}
              width={dims.w}
              height={dims.h}
              graphData={graphData}
              nodeId="id"
              nodeLabel="name"
              nodeCanvasObject={paintNode}
              nodeCanvasObjectMode={() => 'replace'}
              linkColor={linkColor}
              linkWidth={linkWidth}
              onNodeClick={handleNodeClick}
              backgroundColor="#0f172a"
              linkDirectionalParticles={0}
              cooldownTicks={120}
              d3AlphaDecay={0.02}
              d3VelocityDecay={0.3}
            />
          )}

          {/* Selected node info panel */}
          {selectedNode && (
            <div style={{
              position: 'absolute', bottom: 16, right: 16, width: 240,
              background: 'rgba(15,23,42,0.97)', border: '0.5px solid #1e293b',
              borderRadius: 10, padding: '14px 16px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <p style={{ fontWeight: 600, fontSize: 14, margin: 0, color: '#e2e8f0', lineHeight: 1.3 }}>{selectedNode.name}</p>
                <button onClick={() => setSelectedNode(null)}
                  style={{ color: '#475569', background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>✕</button>
              </div>
              <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 6px' }}>
                {selectedNode.lastName}
                {selectedNode.bYear && ` · b.${selectedNode.bYear}`}
                {selectedNode.dYear && ` · d.${selectedNode.dYear}`}
              </p>
              <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 10px' }}>
                {selectedNode.degree} connection{selectedNode.degree !== 1 ? 's' : ''} in graph
              </p>
              {selectedNode.affiliations?.length > 0 && (
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 10 }}>
                  {selectedNode.affiliations.map(a => (
                    <span key={a} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99,
                      border: `0.5px solid ${AFFIL_META[a]?.color || '#94a3b8'}`,
                      color: AFFIL_META[a]?.color || '#94a3b8',
                      background: AFFIL_META[a]?.bg || 'transparent',
                    }}>{AFFIL_META[a]?.label || a}</span>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => { setCenterPerson(selectedNode); setShowAll(false); setSelectedNode(null) }}
                  style={{ flex: 1, fontSize: 11, padding: '5px 0', borderRadius: 6, background: '#1e293b', border: '0.5px solid #334155', color: '#94a3b8', cursor: 'pointer' }}>
                  Center here
                </button>
                {onOpenPerson && (
                  <button onClick={() => onOpenPerson(selectedNode.raw)}
                    style={{ flex: 1, fontSize: 11, padding: '5px 0', borderRadius: 6, background: '#1e3a5f', border: '0.5px solid #3b82f6', color: '#93c5fd', cursor: 'pointer' }}>
                    Open record →
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
