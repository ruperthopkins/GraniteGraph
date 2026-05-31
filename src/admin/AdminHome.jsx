// src/admin/AdminHome.jsx
import StatsPanel from './StatsPanel'

const ALL_TOOLS = [
  {
    id: 'review',
    icon: '🔍',
    title: 'Person Research & QA',
    description: 'Search, review and curate people, relationships and gravestone records',
    status: 'active',
    roles: ['admin', 'researcher'],
  },
  {
    id: 'import',
    icon: '📜',
    title: 'Church Records Import',
    description: 'Extract people & relationships from historical church meeting records and other reference sources',
    status: 'active',
    roles: ['admin'],
  },
  {
    id: 'mallmann',
    icon: '📖',
    title: 'Mallmann Import',
    description: 'Import Mallmann 1899 genealogy pages via Claude vision — understands cross-reference numbering',
    status: 'active',
    roles: ['admin'],
  },
  {
    id: 'white',
    icon: '📗',
    title: 'White Genealogy Import',
    description: 'Import Willis H. White genealogy pages via Claude vision — supports any White volume',
    status: 'active',
    roles: ['admin'],
  },
  {
    id: 'dedup',
    icon: '⚖️',
    title: 'Duplicate Scan',
    description: 'Score all records for name and date similarity — review flagged pairs, merge or dismiss',
    status: 'active',
    roles: ['admin'],
  },
  {
    id: 'stones',
    icon: '🪨',
    title: 'Unmatched Stones',
    description: 'Link photographed stones to deceased records — assign Buried Here or Mentioned, confirm kinship',
    status: 'active',
    roles: ['admin'],
  },
  {
    id: 'inscriptions',
    icon: '🔍',
    title: 'Inscription Analysis',
    description: 'Run AI analysis on submitted gravestone photos',
    status: 'coming_soon',
    roles: ['admin'],
  },
  {
    id: 'relationships',
    icon: '🕸️',
    title: 'Relationship Editor',
    description: 'Curate and verify kinship connections in the community graph',
    status: 'coming_soon',
    roles: ['admin'],
  },
  {
    id: 'sources',
    icon: '📚',
    title: 'Source Manager',
    description: 'Manage reference sources — genealogies, census records, town histories',
    status: 'coming_soon',
    roles: ['admin'],
  },
]

export default function AdminHome({ profile, onNavigate, onBack }) {
  const role = profile?.role || 'volunteer'
  const tools = ALL_TOOLS.filter(t => t.roles.includes(role))
  const isResearcher = role === 'researcher'

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="bg-gray-800 p-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-green-400">
            {isResearcher ? 'Granite Graph Research' : 'Granite Graph Admin'}
          </h1>
          <p className="text-gray-400 text-xs mt-0.5">Signed in as {profile?.display_name}</p>
        </div>
        <button onClick={onBack} className="text-gray-300 text-sm hover:text-white">
          ← Field App
        </button>
      </div>

      <div className="p-4 max-w-lg mx-auto mt-4">
        <StatsPanel />

        <div className="flex flex-col gap-3">
          {tools.map(tool => (
            <button
              key={tool.id}
              onClick={() => tool.status === 'active' && onNavigate(tool.id)}
              disabled={tool.status !== 'active'}
              className={
                'bg-gray-800 rounded-lg p-4 border text-left w-full ' +
                (tool.status === 'active'
                  ? 'border-green-800 hover:bg-gray-700 cursor-pointer'
                  : 'border-gray-700 opacity-50 cursor-default')
              }
            >
              <div className="flex items-start gap-3">
                <span className="text-2xl leading-none mt-0.5">{tool.icon}</span>
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-bold text-white">{tool.title}</p>
                    {tool.status === 'coming_soon' && (
                      <span className="text-xs bg-gray-700 text-gray-400 px-2 py-0.5 rounded-full">
                        coming soon
                      </span>
                    )}
                  </div>
                  <p className="text-gray-400 text-sm mt-1">{tool.description}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
