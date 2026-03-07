import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import Login from './Login'
import Home from './Home'

function App() {
  const [session, setSession] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
    })
    supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
  }, [])

  return (
    <div>
      {!session ? (
        <Login onLogin={() => supabase.auth.getSession()
          .then(({ data: { session } }) => setSession(session))} />
      ) : (
        <Home session={session} />
      )}
    </div>
  )
}

export default App