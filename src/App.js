import { useState, useEffect, useRef } from 'react'
import { supabase } from './supabaseClient'
import Login from './Login'
import Home from './Home'
import Map from './Map'
import Recent from './Recent'
import Search from './Search'
import AdminHome from './admin/AdminHome'
import ChurchImport from './admin/ChurchImport'

function App() {
  const [session, setSession] = useState(null)
  const [page, setPage] = useState('search')
  const [authChecked, setAuthChecked] = useState(false)
  const [profile, setProfile] = useState(null)
  const [profileChecked, setProfileChecked] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const fetchingProfile = useRef(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setAuthChecked(true)
      if (session) fetchProfile(session.user.id)
      else setProfileChecked(true)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session) {
        setPage('home')
        fetchProfile(session.user.id)
      } else {
        setProfile(null)
        setProfileChecked(false)
        fetchingProfile.current = false
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const fetchProfile = async (userId) => {
    if (fetchingProfile.current) return
    fetchingProfile.current = true
    const { data } = await supabase
      .from('volunteer_profiles')
      .select('*')
      .eq('user_id', userId)
      .single()
    setProfile(data || null)
    setProfileChecked(true)
  }

  const saveProfile = async () => {
    if (!displayName.trim()) return
    setSavingProfile(true)
    const { data, error } = await supabase
      .from('volunteer_profiles')
      .insert({
        user_id: session.user.id,
        display_name: displayName.trim(),
        role: 'volunteer',
        cemetery_id: 'd8bd1f88-cdde-4ef2-a448-5ab04d2d8107'
      })
      .select()
      .single()
    if (error) {
      alert('Error saving profile: ' + error.message)
    } else {
      setProfile(data)
    }
    setSavingProfile(false)
  }

  if (!authChecked) return null

  if (!session) {
    if (page === 'login') return <Login onLogin={() => {}} />
    return <Search onLogin={() => setPage('login')} />
  }

  if (profileChecked && !profile) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center p-4">
        <div className="bg-gray-800 rounded-lg p-8 max-w-md w-full">
          <h1 className="text-xl font-bold text-green-400 mb-2">Welcome to Granite Graph!</h1>
          <p className="text-gray-400 text-sm mb-6">
            Before you start, please enter your name so your contributions can be credited.
          </p>
          <input
            type="text"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && saveProfile()}
            placeholder="Your full name"
            className="w-full bg-gray-700 border border-gray-600 rounded-lg p-3 text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-green-500 mb-4"
          />
          <button
            onClick={saveProfile}
            disabled={savingProfile || !displayName.trim()}
            className="w-full bg-green-700 hover:bg-green-600 disabled:bg-gray-600 text-white font-bold py-3 rounded-lg"
          >
            {savingProfile ? 'Saving...' : 'Get Started'}
          </button>
        </div>
      </div>
    )
  }

  const isAdmin = profile?.role === 'admin'

  return (
    <div>
      {page === 'search' && <Search onLogin={null} onHome={() => setPage('home')} />}
      {page === 'home' && (
        <Home
          session={session}
          profile={profile}
          onMap={() => setPage('map')}
          onRecent={() => setPage('recent')}
          onAdmin={isAdmin ? () => setPage('admin') : null}
        />
      )}
      {page === 'map' && <Map onBack={() => setPage('home')} />}
      {page === 'recent' && <Recent onBack={() => setPage('home')} />}

      {/* Admin area — only reachable when profile.role === 'admin' */}
      {page === 'admin' && isAdmin && (
        <AdminHome
          profile={profile}
          onBack={() => setPage('home')}
          onNavigate={(tool) => setPage('admin_' + tool)}
        />
      )}
      {page === 'admin_import' && isAdmin && (
        <ChurchImport onBack={() => setPage('admin')} />
      )}
    </div>
  )
}

export default App