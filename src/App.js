// v5 - multi person support
import { useState, useEffect } from 'react'
```

Save then push:
```
git add .
git commit -m "Bust Vercel cache v5"
git pushimport { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import Login from './Login'
import Home from './Home'
import Map from './Map'

function App() {
  const [session, setSession] = useState(null)
  const [page, setPage] = useState('home')

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
    })
    supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
  }, [])

  if (!session) {
    return <Login onLogin={() => supabase.auth.getSession()
      .then(({ data: { session } }) => setSession(session))} />
  }

  return (
    <div>
      {page === 'home' && (
        <Home session={session} onMap={() => setPage('map')} />
      )}
      {page === 'map' && (
        <Map onBack={() => setPage('home')} />
      )}
    </div>
  )
}

export default App