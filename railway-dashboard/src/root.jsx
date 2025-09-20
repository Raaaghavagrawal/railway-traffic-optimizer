import { useState } from 'react'
import HomeApp from './App.tsx'
import MapApp from './App.jsx'

export default function Root() {
  const [showMap, setShowMap] = useState(false)
  if (!showMap) {
    // Ensure homepage styles apply (white bg, scrollable)
    if (typeof document !== 'undefined') {
      document.body.classList.add('home-mode')
    }
    return (
      <div className="min-h-screen bg-white text-gray-900">
        <HomeApp onOpenSimulation={() => setShowMap(true)} />
      </div>
    )
  }
  // Switch to map view; restore dark gradient bg and lock body scroll
  if (typeof document !== 'undefined') {
    document.body.classList.remove('home-mode')
  }
  return (
    <MapApp />
  )
}