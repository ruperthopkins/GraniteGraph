// src/admin/NetworkView.jsx
// Community graph — self-contained canvas force simulation, zero extra deps

import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../supabaseClient'

// ── Color palettes ────────────────────────────────────────────────────────────
const FAMILY_PALETTE = {
  Woodhull: '#f59e0b', Smith:    '#3b82f6', Hopkins:  '#10b981',
  Talmadge: '#8b5cf6', Davis:    '#94a3b8', Hallock:  '#6366f1',
  Brown:    '#78716c', Miller:   '#a8a29e', Norton:   '#f472b6',
  Hawkins:  '#67e8f9', Helme:    '#fde68a', Phillips: '#c4b5fd',
  Homan:    '#86efac', Tooker:   '#fb923c', Jones:    '#e879f9',
}
const AFFIL_META = {
  association_papers: { label: 'Association Papers', color: '#6ee7b7', glow: 'rgba(110,231,183,0.35)' },
  ny_militia:         { label: 'NY Militia',          color: '#6ee7b7', glow: 'rgba(110,231,183,0.35)' },
  continental_army:   { label: 'Continental Army',    color: '#34d399', glow: 'rgba(52,211,153,0.35)' },
  culper_ring:        { label: 'Culper Ring',         color: '#93c5fd', glow: 'rgba(147,197,253,0.45)' },
  loyalist:           { label: 'Crown Loyalist',      color: '#fca5a5', glow: 'rgba(252,165,165,0.35)' },
}
const LINK_COLORS = {
  parent: 'rgba(251,191,36,0.35)', child: 'rgba(251,191,36,0.35)',
  spouse: 'rgba(167,139,250,0.45)', sibling: 'rgba(148,163,184,0.2)',
  unknown: 'rgba(100,116,139,0.15)',
}

function hashColor(s) {
  let h = 0
  for (const c of (s || '')) h = (Math.imul(31, h) + c.charCodeAt(0)) | 0
  return `hsl(${(Math.abs(h) * 137) % 360},55%,55%)`
}
function nodeColor(lastName) { return FAMILY_PALETTE[lastName] || hashColor(lastName) }
function topAffil(aff) {
  return ['culper_ring','continental_army','ny_militia','association_papers','loyalist']
    .find(a => (aff||[]).includes(a)) || null
}

// ── Physics constants ─────────────────────────────────────────────────────────
const REPULSION   = 2200
const REPEL_DIST  = 220
const LINK_DIST   = 90
const SPRING      = 0.06
const CENTER_FORCE= 0.012
const DAMPING     = 0.82

// ── Force simulation tick ─────────────────────────────────────────────────────
function tick(nodes, links, alpha) {
  // Repulsion
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i]
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j]
      const dx = b.x - a.x, dy = b.y - a.y
      const d2 = dx*dx + dy*dy || 0.01
      if (d2 > REPEL_DIST*REPEL_DIST) continue
      const d = Math.sqrt(d2)
      const f = (REPULSION * alpha) / d2
      const fx = f*dx/d, fy = f*dy/d
      a.vx -= fx; a.vy -= fy
      b.vx += fx; b.vy += fy
    }
  }
  // Spring along links
  for (const lk of links) {
    const a = lk.srcNode, b = lk.tgtNode
    if (!a || !b) continue
    const dx = b.x - a.x, dy = b.y - a.y
    const d = Math.sqrt(dx*dx + dy*dy) || 1
    const f = (d - LINK_DIST) * SPRING * alpha / d
    a.vx += f*dx; a.vy += f*dy
    b.vx -= f*dx; b.vy -= f*dy
  }
  // Center pull
  let cx = 0, cy = 0
  for (const n of nodes) { cx += n.x; cy += n.y }
  cx /= nodes.length; cy /= nodes.length
  for (const n of nodes) {
    n.vx -= (n.x - cx) * CENTER_FORCE * alpha
    n.vy -= (n.y - cy) * CENTER_FORCE * alpha
  }
  // Integrate
  for (const n of nodes) {
    if (n.fixed) continue
    n.vx *= DAMPING; n.vy *= DAMPING
    n.x += n.vx; n.y += n.vy
  }
}

// ── BFS ───────────────────────────────────────────────────────────────────────
function bfsIds(centerId, degrees, adj) {
  const seen = new Set([centerId])
  let front = [centerId]
  for (let d = 0; d < degrees; d++) {
    const next = []
    for (const id of front)
      for (const nb of (adj[id]||[]))
        if (!seen.has(nb)) { seen.add(nb); next.push(nb) }
    front = next
  }
  return seen
}

// ── Main component ────────────────────────────────────────────────────────────
export default function NetworkView({ onBack, onOpenPerson }) {
  const canvasRef = useRef()
  const simRef    = useRef({ nodes:[], links:[], alpha:1, raf:null })
  const viewRef   = useRef({ tx:0, ty:0, scale:1 })
  const dragRef   = useRef(null)   // { nodeIdx, startX, startY, origX, origY } | { pan, startX, startY, origTx, origTy }

  const [allNodes,  setAllNodes]  = useState([])
  const [allLinks,  setAllLinks]  = useState([])
  const [adjMap,    setAdjMap]    = useState({})
  const [loading,   setLoading]   = useState(true)

  const [center,    setCenter]    = useState(null)
  const [degrees,   setDegrees]   = useState(2)
  const [showAll,   setShowAll]   = useState(false)
  const [affilHL,   setAffilHL]   = useState(true)
  const [famVisible,setFamVisible]= useState(new Set())
  const [famList,   setFamList]   = useState([])

  const [searchQ,   setSearchQ]   = useState('')
  const [searchRes, setSearchRes] = useState([])
  const [searching, setSearching] = useState(false)

  const [selected,  setSelected]  = useState(null)
  const [graphStats,setGraphStats]= useState({ nodes:0, links:0 })

  // ── Load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const [dRes, kRes] = await Promise.all([
        supabase.from('deceased').select(
          'deceased_id,first_name,last_name,title,generation_suffix,date_of_birth_verbatim,date_of_death_verbatim,patriot_affiliations'
        ).limit(3000),
        supabase.from('kinship').select(
          'primary_deceased_id,relative_deceased_id,relationship_type'
        ).limit(6000),
      ])
      const byId = {}
      const nodes = (dRes.data||[]).map(p => {
        const base = [p.first_name, p.last_name].filter(Boolean).join(' ')
        const n = {
          id: p.deceased_id,
          name: [p.title, base, p.generation_suffix].filter(Boolean).join(' ') || '?',
          lastName: p.last_name||'',
          color: nodeColor(p.last_name),
          affiliations: p.patriot_affiliations||[],
          bYear: (p.date_of_birth_verbatim||'').match(/\b(1[4-9]\d{2}|20\d{2})\b/)?.[1]||null,
          dYear: (p.date_of_death_verbatim||'').match(/\b(1[4-9]\d{2}|20\d{2})\b/)?.[1]||null,
          degree: 0, raw: p,
        }
        byId[p.deceased_id] = n
        return n
      })
      const seen = new Set(), links = [], adj = {}
      for (const k of (kRes.data||[])) {
        const a = k.primary_deceased_id, b = k.relative_deceased_id
        if (!a||!b||a===b||!byId[a]||!byId[b]) continue
        const key = a<b?`${a}|${b}`:`${b}|${a}`
        if (seen.has(key)) continue
        seen.add(key)
        links.push({ src:a, tgt:b, type:k.relationship_type })
        adj[a]=[...( adj[a]||[]),b]; adj[b]=[...(adj[b]||[]),a]
      }
      for (const n of nodes) n.degree = (adj[n.id]||[]).length

      const fCount = {}
      for (const n of nodes) fCount[n.lastName]=(fCount[n.lastName]||0)+1
      const fams = Object.entries(fCount)
        .filter(([,c])=>c>=2).sort((a,b)=>b[1]-a[1]).slice(0,20)
        .map(([name,count])=>({ name, count, color:nodeColor(name) }))

      setAllNodes(nodes); setAllLinks(links); setAdjMap(adj)
      setFamList(fams); setFamVisible(new Set(fams.map(f=>f.name)))
      setLoading(false)
    }
    load()
  }, [])

  // ── Build simulation graph when filters change ─────────────────────────────
  useEffect(() => {
    if (!allNodes.length) return
    let ids
    if (center && !showAll) {
      ids = bfsIds(center.id, degrees, adjMap)
    } else {
      ids = new Set(allNodes.filter(n=>n.degree>0).map(n=>n.id))
      if (ids.size > 350) {
        const top = [...allNodes].filter(n=>ids.has(n.id))
          .sort((a,b)=>b.degree-a.degree).slice(0,350)
        ids = new Set(top.map(n=>n.id))
      }
    }
    const visNodes = allNodes.filter(n=>ids.has(n.id)&&famVisible.has(n.lastName))
    const visSet   = new Set(visNodes.map(n=>n.id))
    const visLinks = allLinks.filter(l=>visSet.has(l.src)&&visSet.has(l.tgt))

    // Spread initial positions, preserve existing if re-filtering
    const W = canvasRef.current?.width||900, H = canvasRef.current?.height||600
    const cx = W/2, cy = H/2
    const existing = {}
    for (const n of simRef.current.nodes) existing[n.id]={x:n.x,y:n.y,vx:n.vx,vy:n.vy}

    const simNodes = visNodes.map((n,i) => {
      const ex = existing[n.id]
      const angle = (i/visNodes.length)*2*Math.PI
      const r = 80 + (n.degree*8)
      return {
        ...n,
        x: ex?.x ?? cx + r*Math.cos(angle),
        y: ex?.y ?? cy + r*Math.sin(angle),
        vx: ex?.vx ?? 0, vy: ex?.vy ?? 0,
      }
    })
    const idxById = {}
    simNodes.forEach((n,i) => { idxById[n.id]=i })
    const simLinks = visLinks.map(l=>({
      ...l,
      srcNode: simNodes[idxById[l.src]],
      tgtNode: simNodes[idxById[l.tgt]],
    }))

    simRef.current.nodes  = simNodes
    simRef.current.links  = simLinks
    simRef.current.alpha  = 1
    setGraphStats({ nodes: simNodes.length, links: simLinks.length })
  }, [allNodes, allLinks, adjMap, center, degrees, showAll, famVisible])

  // ── Animation loop ────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')

    const draw = () => {
      const sim = simRef.current
      const v   = viewRef.current
      if (sim.alpha > 0.002) {
        tick(sim.nodes, sim.links, sim.alpha)
        sim.alpha *= 0.97
      }

      const { tx, ty, scale } = v
      const W = canvas.width, H = canvas.height
      ctx.clearRect(0,0,W,H)
      ctx.save()
      ctx.translate(tx,ty)
      ctx.scale(scale,scale)

      // Links
      for (const lk of sim.links) {
        const a = lk.srcNode, b = lk.tgtNode
        if (!a||!b) continue
        ctx.beginPath()
        ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y)
        ctx.strokeStyle = LINK_COLORS[lk.type]||LINK_COLORS.unknown
        ctx.lineWidth = lk.type==='spouse' ? 1.5/scale : 0.8/scale
        ctx.stroke()
      }

      // Nodes
      for (const n of sim.nodes) {
        const r = Math.max(3, Math.min(12, 3 + n.degree*0.7))
        const afKey = affilHL ? topAffil(n.affiliations) : null
        const isSel = selected?.id===n.id
        const isCtr = center?.id===n.id

        // Glow
        if (afKey) {
          const meta = AFFIL_META[afKey]
          ctx.beginPath(); ctx.arc(n.x,n.y,r+5,0,2*Math.PI)
          ctx.fillStyle = meta.glow; ctx.fill()
        }
        // Focal ring
        if (isCtr||isSel) {
          ctx.beginPath(); ctx.arc(n.x,n.y,r+4,0,2*Math.PI)
          ctx.strokeStyle = isSel?'#fff':'#94a3b8'
          ctx.lineWidth = 2/scale; ctx.stroke()
        }
        // Fill
        ctx.beginPath(); ctx.arc(n.x,n.y,r,0,2*Math.PI)
        ctx.fillStyle = n.color; ctx.fill()
        // Affil ring
        if (afKey) {
          ctx.beginPath(); ctx.arc(n.x,n.y,r,0,2*Math.PI)
          ctx.strokeStyle = AFFIL_META[afKey].color
          ctx.lineWidth = 1.8/scale; ctx.stroke()
        }
        // Label
        if (scale > 1.6 || isSel || isCtr || (affilHL&&afKey)) {
          const fs = Math.min(13, 11/scale)
          ctx.font = `${isCtr?'bold ':''}${fs}px sans-serif`
          ctx.fillStyle = '#f1f5f9'; ctx.textAlign = 'center'
          ctx.fillText(n.name, n.x, n.y+r+fs+1)
        }
      }
      ctx.restore()
      sim.raf = requestAnimationFrame(draw)
    }

    if (simRef.current.raf) cancelAnimationFrame(simRef.current.raf)
    simRef.current.raf = requestAnimationFrame(draw)
    const sim = simRef.current
    return () => { if (sim.raf) cancelAnimationFrame(sim.raf) }
  }, [graphStats, affilHL, selected, center])  // re-bind when graph changes

  // ── Mouse events ──────────────────────────────────────────────────────────
  const canvasToWorld = useCallback((cx,cy) => {
    const v = viewRef.current
    return { x:(cx-v.tx)/v.scale, y:(cy-v.ty)/v.scale }
  },[])

  const hitTest = useCallback((wx,wy) => {
    const nodes = simRef.current.nodes
    for (let i = nodes.length-1; i >= 0; i--) {
      const n = nodes[i]
      const r = Math.max(3, Math.min(12,3+n.degree*0.7)) + 4
      if ((wx-n.x)**2+(wy-n.y)**2 <= r*r) return n
    }
    return null
  },[])

  const onMouseDown = useCallback(e => {
    const rect = canvasRef.current.getBoundingClientRect()
    const cx = e.clientX-rect.left, cy = e.clientY-rect.top
    const {x,y} = canvasToWorld(cx,cy)
    const hit = hitTest(x,y)
    if (hit) {
      dragRef.current = { type:'node', node:hit, startX:cx, startY:cy, origX:hit.x, origY:hit.y }
      hit.fixed = true
    } else {
      const v = viewRef.current
      dragRef.current = { type:'pan', startX:cx, startY:cy, origTx:v.tx, origTy:v.ty }
    }
  },[canvasToWorld, hitTest])

  const onMouseMove = useCallback(e => {
    if (!dragRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const cx = e.clientX-rect.left, cy = e.clientY-rect.top
    const d = dragRef.current
    if (d.type==='node') {
      const {x,y} = canvasToWorld(cx,cy)
      d.node.x = x; d.node.y = y
      d.node.vx = 0; d.node.vy = 0
      simRef.current.alpha = Math.max(simRef.current.alpha, 0.3)
    } else {
      viewRef.current.tx = d.origTx + (cx-d.startX)
      viewRef.current.ty = d.origTy + (cy-d.startY)
    }
  },[canvasToWorld])

  const onMouseUp = useCallback(e => {
    if (!dragRef.current) return
    const d = dragRef.current
    if (d.type==='node') {
      const rect = canvasRef.current.getBoundingClientRect()
      const moved = Math.abs(e.clientX-rect.left-d.startX)+Math.abs(e.clientY-rect.top-d.startY)
      if (moved < 5) setSelected(prev => prev?.id===d.node.id ? null : d.node)
      else d.node.fixed = true  // keep pinned after drag
    }
    dragRef.current = null
  },[])

  const onWheel = useCallback(e => {
    e.preventDefault()
    const rect = canvasRef.current.getBoundingClientRect()
    const cx = e.clientX-rect.left, cy = e.clientY-rect.top
    const factor = e.deltaY < 0 ? 1.12 : 0.89
    const v = viewRef.current
    v.scale = Math.max(0.15, Math.min(8, v.scale*factor))
    v.tx = cx - (cx-v.tx)*factor
    v.ty = cy - (cy-v.ty)*factor
  },[])

  // ── Search ────────────────────────────────────────────────────────────────
  const doSearch = useCallback(async () => {
    if (!searchQ.trim()) return
    setSearching(true)
    const last = searchQ.trim().split(/\s+/).at(-1)
    const { data } = await supabase.from('v_deceased_search').select('*')
      .ilike('last_name',`%${last}%`).order('last_name').limit(25)
    setSearchRes(data||[]); setSearching(false)
  },[searchQ])

  const pickCenter = useCallback(person => {
    const node = simRef.current.nodes.find(n=>n.id===person.deceased_id)
      || allNodes.find(n=>n.id===person.deceased_id)
    if (node) { setCenter(node); setShowAll(false) }
    setSearchRes([]); setSearchQ('')
  },[allNodes])

  // ── Fit view ──────────────────────────────────────────────────────────────
  const fitView = useCallback(() => {
    const nodes = simRef.current.nodes
    if (!nodes.length) return
    const xs = nodes.map(n=>n.x), ys = nodes.map(n=>n.y)
    const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys)
    const W=canvasRef.current.width, H=canvasRef.current.height
    const s = Math.min(0.9*W/(maxX-minX||1), 0.9*H/(maxY-minY||1), 3)
    viewRef.current = {
      scale:s,
      tx: W/2 - s*(minX+maxX)/2,
      ty: H/2 - s*(minY+maxY)/2,
    }
  },[])

  // ── Canvas sizing ─────────────────────────────────────────────────────────
  const containerRef = useRef()
  useEffect(() => {
    if (!containerRef.current||!canvasRef.current) return
    const ro = new ResizeObserver(([e]) => {
      canvasRef.current.width  = e.contentRect.width
      canvasRef.current.height = e.contentRect.height
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  },[])

  // ── Styles ────────────────────────────────────────────────────────────────
  const panel = { background:'rgba(15,23,42,0.96)', border:'0.5px solid #1e293b', borderRadius:8, padding:'12px 14px' }
  const lbl   = { fontSize:10, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em', margin:'0 0 6px', fontWeight:500 }
  const chip  = active => ({
    fontSize:11, padding:'3px 10px', borderRadius:99, cursor:'pointer',
    background: active?'#1e3a5f':'transparent',
    border:`0.5px solid ${active?'#3b82f6':'#334155'}`,
    color: active?'#93c5fd':'#64748b',
  })

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100vh', background:'#0f172a', color:'#e2e8f0', fontFamily:'sans-serif', fontSize:13 }}>

      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 16px', borderBottom:'0.5px solid #1e293b', flexShrink:0 }}>
        {onBack && <button onClick={onBack} style={{ fontSize:13, color:'#64748b', background:'none', border:'none', cursor:'pointer' }}>← Admin</button>}
        <p style={{ fontWeight:600, fontSize:15, margin:0 }}>Community Graph</p>
        <span style={{ fontSize:12, color:'#475569' }}>
          {loading ? 'Loading…' : `${graphStats.nodes} people · ${graphStats.links} connections`}
        </span>
        <button onClick={fitView} style={{ marginLeft:'auto', fontSize:11, padding:'4px 12px', borderRadius:6, background:'#1e293b', border:'0.5px solid #334155', color:'#94a3b8', cursor:'pointer' }}>
          Fit view
        </button>
      </div>

      <div style={{ display:'flex', flex:1, overflow:'hidden' }}>

        {/* Sidebar */}
        <div style={{ width:256, flexShrink:0, overflowY:'auto', padding:'10px 8px', display:'flex', flexDirection:'column', gap:8, borderRight:'0.5px solid #1e293b' }}>

          {/* Search */}
          <div style={panel}>
            <p style={lbl}>Center on person</p>
            <div style={{ display:'flex', gap:5, marginBottom:6 }}>
              <input value={searchQ} onChange={e=>{setSearchQ(e.target.value);setSearchRes([])}}
                onKeyDown={e=>e.key==='Enter'&&doSearch()} placeholder="Last name…"
                style={{ flex:1, fontSize:12, background:'#1e293b', border:'0.5px solid #334155', borderRadius:6, padding:'4px 8px', color:'#e2e8f0', outline:'none' }} />
              <button onClick={doSearch} disabled={searching}
                style={{ fontSize:11, padding:'3px 8px', borderRadius:6, background:'#1e3a5f', border:'0.5px solid #3b82f6', color:'#93c5fd', cursor:'pointer' }}>
                {searching?'…':'Go'}
              </button>
            </div>
            {searchRes.length>0 && (
              <div style={{ maxHeight:160, overflowY:'auto', display:'flex', flexDirection:'column', gap:2 }}>
                {searchRes.map(r=>(
                  <div key={r.deceased_id} onClick={()=>pickCenter(r)}
                    style={{ fontSize:12, padding:'4px 8px', borderRadius:5, cursor:'pointer', background:'#1e293b', color:'#cbd5e1' }}>
                    {r.full_name}
                    {r.date_of_death_verbatim&&<span style={{color:'#475569'}}> d.{r.date_of_death_verbatim.match(/\d{4}/)?.[0]}</span>}
                  </div>
                ))}
              </div>
            )}
            {center && (
              <div style={{ marginTop:6, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <span style={{ fontSize:12, color:'#f59e0b', fontWeight:600 }}>{center.name}</span>
                <button onClick={()=>{setCenter(null);setShowAll(false)}}
                  style={{ fontSize:11, color:'#475569', background:'none', border:'none', cursor:'pointer' }}>✕</button>
              </div>
            )}
          </div>

          {/* Degree */}
          {center && (
            <div style={panel}>
              <p style={lbl}>Degrees from center</p>
              <div style={{ display:'flex', gap:4 }}>
                {[1,2,3,4].map(d=>(
                  <button key={d} onClick={()=>setDegrees(d)} style={chip(degrees===d&&!showAll)}>{d}</button>
                ))}
              </div>
            </div>
          )}

          {/* Mode */}
          <div style={panel}>
            <p style={lbl}>View mode</p>
            <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
              <button onClick={()=>setShowAll(false)} style={chip(!showAll&&!center)}>Connected</button>
              <button onClick={()=>setShowAll(true)}  style={chip(showAll)}>All</button>
            </div>
          </div>

          {/* Affiliation overlay */}
          <div style={panel}>
            <p style={lbl}>Overlay</p>
            <label style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer', fontSize:12, color:affilHL?'#6ee7b7':'#64748b' }}>
              <input type="checkbox" checked={affilHL} onChange={e=>setAffilHL(e.target.checked)} />
              Patriot affiliations
            </label>
            {affilHL && (
              <div style={{ marginTop:8, display:'flex', flexDirection:'column', gap:4 }}>
                {Object.entries(AFFIL_META).map(([k,v])=>(
                  <div key={k} style={{ display:'flex', alignItems:'center', gap:6, fontSize:11 }}>
                    <div style={{ width:9, height:9, borderRadius:'50%', background:v.color, flexShrink:0 }}/>
                    <span style={{ color:'#94a3b8' }}>{v.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Family filter */}
          <div style={panel}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
              <p style={{...lbl, margin:0}}>Families</p>
              <div style={{ display:'flex', gap:8 }}>
                <button onClick={()=>setFamVisible(new Set(famList.map(f=>f.name)))}
                  style={{ fontSize:10, color:'#64748b', background:'none', border:'none', cursor:'pointer' }}>all</button>
                <button onClick={()=>setFamVisible(new Set())}
                  style={{ fontSize:10, color:'#64748b', background:'none', border:'none', cursor:'pointer' }}>none</button>
              </div>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:2, maxHeight:280, overflowY:'auto' }}>
              {famList.map(f=>(
                <label key={f.name} style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer', fontSize:12,
                  color:famVisible.has(f.name)?'#e2e8f0':'#475569' }}>
                  <input type="checkbox" checked={famVisible.has(f.name)} onChange={e=>{
                    setFamVisible(prev=>{ const s=new Set(prev); e.target.checked?s.add(f.name):s.delete(f.name); return s })
                  }}/>
                  <span style={{ width:9, height:9, borderRadius:'50%', background:f.color, flexShrink:0, display:'inline-block' }}/>
                  {f.name}<span style={{ color:'#475569', marginLeft:'auto' }}>{f.count}</span>
                </label>
              ))}
            </div>
          </div>

          <div style={{ ...panel, fontSize:11, color:'#475569', lineHeight:1.6 }}>
            <p style={{...lbl, margin:'0 0 4px'}}>Controls</p>
            Scroll — zoom<br/>
            Drag canvas — pan<br/>
            Drag node — pin<br/>
            Click node — select
          </div>
        </div>

        {/* Canvas */}
        <div ref={containerRef} style={{ flex:1, position:'relative', overflow:'hidden' }}>
          {loading ? (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%' }}>
              <p style={{ color:'#475569' }}>Loading graph data…</p>
            </div>
          ) : (
            <canvas ref={canvasRef}
              onMouseDown={onMouseDown} onMouseMove={onMouseMove}
              onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
              onWheel={onWheel}
              style={{ display:'block', cursor:'crosshair', width:'100%', height:'100%' }}
            />
          )}

          {/* Selected node panel */}
          {selected && (
            <div style={{ position:'absolute', bottom:16, right:16, width:230,
              background:'rgba(15,23,42,0.97)', border:'0.5px solid #1e293b', borderRadius:10, padding:'14px 16px' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:6 }}>
                <p style={{ fontWeight:600, fontSize:14, margin:0, color:'#e2e8f0', lineHeight:1.3 }}>{selected.name}</p>
                <button onClick={()=>setSelected(null)} style={{ color:'#475569', background:'none', border:'none', cursor:'pointer', fontSize:16 }}>✕</button>
              </div>
              <p style={{ fontSize:12, color:'#64748b', margin:'0 0 4px' }}>
                {selected.lastName}
                {selected.bYear&&` · b.${selected.bYear}`}
                {selected.dYear&&` · d.${selected.dYear}`}
              </p>
              <p style={{ fontSize:12, color:'#94a3b8', margin:'0 0 10px' }}>
                {selected.degree} connection{selected.degree!==1?'s':''} in graph
              </p>
              {selected.affiliations?.length>0 && (
                <div style={{ display:'flex', gap:4, flexWrap:'wrap', marginBottom:10 }}>
                  {selected.affiliations.map(a=>(
                    <span key={a} style={{ fontSize:10, padding:'2px 8px', borderRadius:99,
                      border:`0.5px solid ${AFFIL_META[a]?.color||'#94a3b8'}`,
                      color:AFFIL_META[a]?.color||'#94a3b8',
                      background:AFFIL_META[a]?.glow||'transparent' }}>
                      {AFFIL_META[a]?.label||a}
                    </span>
                  ))}
                </div>
              )}
              <div style={{ display:'flex', gap:6 }}>
                <button onClick={()=>{setCenter(selected);setShowAll(false);setSelected(null)}}
                  style={{ flex:1, fontSize:11, padding:'5px 0', borderRadius:6, background:'#1e293b', border:'0.5px solid #334155', color:'#94a3b8', cursor:'pointer' }}>
                  Center here
                </button>
                {onOpenPerson && (
                  <button onClick={()=>onOpenPerson(selected.raw)}
                    style={{ flex:1, fontSize:11, padding:'5px 0', borderRadius:6, background:'#1e3a5f', border:'0.5px solid #3b82f6', color:'#93c5fd', cursor:'pointer' }}>
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
