import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import Login from './Login'
import Home from './Home'
import Map from './Map'
import Recent from './Recent'
import Search from './Search'

function App() {
  const [session, setSession] = useState(null)
  const [page, setPage] = useState('search')
  const [authChecked, setAuthChecked] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setAuthChecked(true)
    })
    supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session) setPage('home')
    })
  }, [])

  if (!authChecked) return null

  // Public search — no login required
  if (!session) {
    if (page === 'login') {
      return <Login onLogin={() => {}} />
    }
    return <Search onLogin={() => setPage('login')} />
  }

  // Volunteer app — logged in
  return (
    <div>
      {page === 'search' && (
        <Search onLogin={null} onHome={() => setPage('home')} />
      )}
      {page === 'home' && (
        <Home session={session} onMap={() => setPage('map')} onRecent={() => setPage('recent')} onSearch={() => setPage('search')} />
      )}
      {page === 'map' && (
        <Map onBack={() => setPage('home')} />
      )}
      {page === 'recent' && (
        <Recent onBack={() => setPage('home')} />
      )}
    </div>
  )
}

export default App