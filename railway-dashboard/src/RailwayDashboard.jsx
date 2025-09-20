import { useEffect, useMemo, useRef, useState } from 'react'
import ControlPanel from './ControlPanel'
import { MapContainer, TileLayer, Polyline, Rectangle, Marker, Tooltip, Pane, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import Timeline from './Timeline'
import { 
  MapPinIcon, 
  ClockIcon, 
  TruckIcon, 
  ExclamationTriangleIcon,
  ChartBarIcon,
  Cog6ToothIcon,
} from '@heroicons/react/24/outline'

function FitBounds({ bbox }) {
	const map = useMap()
	useEffect(() => {
		if (!bbox) return
		const bounds = L.latLngBounds(
			[bbox.minLat, bbox.minLon],
			[bbox.maxLat, bbox.maxLon]
		)
		map.fitBounds(bounds, { padding: [20, 20] })
	}, [bbox, map])
	return null
}


function CenterOnPosition({ position }) {
    const map = useMap()
    useEffect(() => {
        if (!position) return
        const { lat, lon } = position
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
            map.flyTo([lat, lon], Math.max(map.getZoom(), 15), { duration: 0.6 })
        }
    }, [position, map])
    return null
}

export default function RailwayDashboard() {
	const [graph, setGraph] = useState({ nodes: [], edges: [] })
	const [stations, setStations] = useState([])
	const [signals, setSignals] = useState([])
	const [telemetry, setTelemetry] = useState([])
	const [alerts, setAlerts] = useState([])
	const [lastCritical, setLastCritical] = useState(null)
	const [dismissedCritical, setDismissedCritical] = useState(false)
	const [dismissedAlertKeys, setDismissedAlertKeys] = useState(new Set())
	const [highlightPairs, setHighlightPairs] = useState(new Set())
	const [isPlaying, setIsPlaying] = useState(true)
	const [simTime, setSimTime] = useState(0)

	const [bbox, setBbox] = useState(null)
	const [error, setError] = useState('')
	const [connectionMode, setConnectionMode] = useState('')
	const [lastUpdateMs, setLastUpdateMs] = useState(0)
	const [selectedPosition, setSelectedPosition] = useState(null)
	const [livePositions, setLivePositions] = useState([])
	const [trainRoutes, setTrainRoutes] = useState([])
	const lastTelemetryRef = useRef({ data: [], ts: 0 })
	const rafRef = useRef(0)

	useEffect(() => {
		let cancelled = false
		async function loadStatic() {
			try {
				const netRes = await fetch('http://localhost:8000/network')
				const net = await netRes.json()
				if (!cancelled) {
					setGraph({ nodes: net.nodes || [], edges: net.edges || [] })
					const lats = []
					const lons = []
					;(net.nodes || []).forEach(n => { if (n.lat != null && n.lon != null) { lats.push(n.lat); lons.push(n.lon) } })
					if (lats.length && lons.length) setBbox({ minLat: Math.min(...lats), maxLat: Math.max(...lats), minLon: Math.min(...lons), maxLon: Math.max(...lons) })
					setStations((net.nodes || []).filter(n => n.type === 'station'))
					setSignals([])
				}
			} catch (e) { if (!cancelled) setError(String(e)) }
		}
		loadStatic()
		return () => { cancelled = true }
	}, [])

	// Live train positions polling (separate from main simulation)
	useEffect(() => {
		let cancelled = false
		let timer
		async function poll() {
			try {
				const res = await fetch('http://localhost:8000/train_positions', { cache: 'no-store' })
				const json = await res.json()
				if (!cancelled && json && json.success) {
					setLivePositions(json.data || [])
					if (json.routes) {
						setTrainRoutes(json.routes)
					}
				}
			} catch (e) {
				// ignore polling errors
			}
			finally {
				if (!cancelled) timer = setTimeout(poll, 50) // Poll every 50ms for ultra smooth movement
			}
		}
		poll()
		return () => {
			cancelled = true
			if (timer) clearTimeout(timer)
		}
	}, [])

	// Live updates: try WS; fallback to HTTP polling if WS not available
	useEffect(() => {
		let cancelled = false
		let ws
		let httpTimer
		function startHttpFallback() {
			async function poll() {
				try {
					const res = await fetch('http://localhost:8000/trains', { cache: 'no-store' })
					const json = await res.json()
					if (!cancelled) {
						const data = json.trains || []
						const ts = performance.now()
						lastTelemetryRef.current = { data, ts }
						setTelemetry(data)
						setLastUpdateMs(ts)
						setConnectionMode('http')
					}
				} catch (e) { if (!cancelled) setError(String(e)) }
				finally { if (!cancelled) httpTimer = setTimeout(poll, 1000) }
			}
			poll()
		}
		async function connect() {
			try {
				ws = new WebSocket('ws://localhost:8000/updates')
				ws.onopen = () => { if (httpTimer) { clearTimeout(httpTimer); httpTimer = undefined } setConnectionMode('ws') }
				ws.onmessage = (ev) => {
					if (cancelled) return
					try {
						const msg = JSON.parse(ev.data)
						if (msg.type === 'state' && msg.data && msg.data.trains) {
							const data = msg.data.trains
							const ts = performance.now()
							lastTelemetryRef.current = { data, ts }
							setTelemetry(data)
							setLastUpdateMs(ts)
						}
						if (msg.type === 'alerts' && Array.isArray(msg.data)) {
							// Merge new alerts into existing list; keep old ones until user dismisses
							const makeKey = (a) => {
								const p = a && a.pair ? a.pair : { a: '', b: '' }
								const s1 = String(p.a || '')
								const s2 = String(p.b || '')
								return [s1, s2].sort().join('|')
							}
							const incomingByKey = new Map()
							for (const a of msg.data) {
								const k = makeKey(a)
								if (!dismissedAlertKeys.has(k)) incomingByKey.set(k, a)
							}
							setAlerts(prev => {
								const prevByKey = new Map(prev.map(a => [makeKey(a), a]))
								// Update or add incoming
								for (const [k, a] of incomingByKey.entries()) {
									prevByKey.set(k, a)
								}
								// Keep previously existing alerts (even if not in incoming) unless dismissed
								const merged = Array.from(prevByKey.values())
								// Optional: sort by severity then distance
								merged.sort((x, y) => {
									const sv = (s) => s === 'critical' ? 2 : s === 'warn' ? 1 : 0
									const aS = sv(x.severity), bS = sv(y.severity)
									if (bS !== aS) return bS - aS
									return (x.distance_m || 0) - (y.distance_m || 0)
								})
								return merged
							})
							const critical = msg.data.find(a => a.severity === 'critical' && !dismissedAlertKeys.has(makeKey(a)))
							if (critical) {
								setLastCritical({ ts: Date.now(), alert: critical })
								setDismissedCritical(false) // Reset dismissed state for new critical alerts
							}
						}
					} catch {}
				}
				ws.onerror = () => { if (!httpTimer) startHttpFallback() }
				ws.onclose = () => { if (!httpTimer) startHttpFallback() }
			} catch (e) { if (!cancelled) setError(String(e)); startHttpFallback() }
		}
		connect()
		return () => { cancelled = true; if (ws) ws.close(); if (httpTimer) clearTimeout(httpTimer) }
	}, [])

	// (Removed duplicate WS effect to avoid double connections)

	useEffect(() => {
		function step() {
			const snap = lastTelemetryRef.current
			const ageMs = Math.max(0, performance.now() - (snap.ts || 0))
			const ageS = ageMs / 1000
			if (snap.data && snap.data.length) {
				if (!isPlaying) {
					setTelemetry(snap.data)
				} else {
					setTelemetry(snap.data.map(t => {
						const edgeLen = t.edge_length_m || 1
						const base = typeof t.progress === 'number' ? t.progress : 0
						const speed = t.speed_mps || 0
						const delta = (speed * ageS) / edgeLen
						return { ...t, progress: Math.max(0, Math.min(1, base + delta)) }
					}))
				}
			}
			rafRef.current = requestAnimationFrame(step)
		}
		rafRef.current = requestAnimationFrame(step)
		return () => cancelAnimationFrame(rafRef.current)
	}, [isPlaying])

	// Build node map for quick lookups
	const nodeById = useMemo(() => {
		const m = new Map()
		for (const n of graph.nodes || []) m.set(n.id, n)
		return m
	}, [graph.nodes])

	// Listen for selected route to highlight and realtime locate event
	useEffect(() => {
		function onSimRoute(ev) {
			try {
				const route = (ev?.detail?.route || []).filter(Boolean)
				const pairs = new Set()
				for (let i = 0; i + 1 < route.length; i++) {
					pairs.add(`${route[i]}|${route[i+1]}`)
				}
				setHighlightPairs(pairs)
			} catch {}
		}
		function onSetPlaying(ev) {
			try { setIsPlaying(!!ev?.detail?.playing) } catch {}
		}
		async function onLocateTrain(ev) {
			try {
				const trainId = ev?.detail?.trainId
				if (!trainId) return
				const res = await fetch(`http://localhost:8000/train/${encodeURIComponent(trainId)}/position`, { cache: 'no-store' })
				const json = await res.json()
				if (json.success && json.position) setSelectedPosition({ id: trainId, ...json.position })
			} catch {}
		}
		window.addEventListener('simulateRoute', onSimRoute)
		window.addEventListener('setPlaying', onSetPlaying)
		window.addEventListener('locateTrain', onLocateTrain)
		return () => { 
			window.removeEventListener('simulateRoute', onSimRoute)
			window.removeEventListener('setPlaying', onSetPlaying)
			window.removeEventListener('locateTrain', onLocateTrain)
		}
	}, [])

	// Decode edges into latlngs (WKT or fallback straight between nodes) with unique keys
	const edgeLatLngs = useMemo(() => {
		const out = []
		const edges = graph.edges || []
		for (let i = 0; i < edges.length; i++) {
			const e = edges[i]
			const wkt = e.geometry_wkt
			let latlngs = []
			if (wkt && wkt.startsWith('LINESTRING')) {
				const inside = wkt.slice(wkt.indexOf('(') + 1, wkt.lastIndexOf(')'))
				latlngs = inside.split(',').map(s => s.trim()).map(p => {
					const [lonStr, latStr] = p.split(/\s+/)
					return [parseFloat(latStr), parseFloat(lonStr)]
				}).filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon))
			} else {
				const a = nodeById.get(e.source)
				const b = nodeById.get(e.target)
				if (a && b && a.lat != null && a.lon != null && b.lat != null && b.lon != null) latlngs = [[a.lat, a.lon], [b.lat, b.lon]]
			}
			if (latlngs.length >= 2) out.push({ key: `${e.source}->${e.target}#${i}`, pair: `${e.source}|${e.target}`, latlngs })
		}
		return out
	}, [graph.edges, nodeById])

	// Occupied edge pairs from telemetry
	const occupiedPairs = useMemo(() => {
		const s = new Set()
		for (const t of telemetry) {
			if (t.edge && t.edge.u && t.edge.v) s.add(`${t.edge.u}|${t.edge.v}`)
		}
		return s
	}, [telemetry])

	// Train positions as latlngs (use first edge per pair for mapping)
	const trainLatLngs = useMemo(() => {
		const m = new Map()
		for (const e of edgeLatLngs) { if (!m.has(e.pair)) m.set(e.pair, e.latlngs) }
		return telemetry.map(t => {
			const pairKey = t.edge && t.edge.u && t.edge.v ? `${t.edge.u}|${t.edge.v}` : null
			let latlngs = pairKey ? m.get(pairKey) : null
			if ((!latlngs || latlngs.length < 2) && pairKey) {
				const a = nodeById.get(t.edge.u)
				const b = nodeById.get(t.edge.v)
				if (a && b) latlngs = [[a.lat, a.lon], [b.lat, b.lon]]
			}
			if (!latlngs || latlngs.length < 2) {
				const a = t.edge && nodeById.get(t.edge.u)
				if (a) return { id: t.id, lat: a.lat, lon: a.lon, status: t.status }
				return null
			}
			const total = latlngs.reduce((acc, cur, i) => i ? acc + L.latLng(cur).distanceTo(L.latLng(latlngs[i-1])) : 0, 0)
			if (total <= 0) return null
			const target = Math.max(0, Math.min(1, t.progress || 0)) * total
			let acc = 0
			for (let i = 1; i < latlngs.length; i++) {
				const a = L.latLng(latlngs[i-1])
				const b = L.latLng(latlngs[i])
				const d = a.distanceTo(b)
				if (acc + d >= target) {
					const f = (target - acc) / (d || 1)
					const lat = a.lat + (b.lat - a.lat) * f
					const lon = a.lng + (b.lng - a.lng) * f
					return { id: t.id, lat, lon, status: t.status }
				}
				acc += d
			}
			const last = latlngs[latlngs.length - 1]
			return { id: t.id, lat: last[0], lon: last[1], status: t.status }
		}).filter(Boolean)
	}, [telemetry, edgeLatLngs])

	const center = bbox ? [(bbox.minLat + bbox.maxLat)/2, (bbox.minLon + bbox.maxLon)/2] : [28.6448, 77.2167]

	return (
		<div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 font-primary">
			<div className="h-screen w-full flex flex-col overflow-hidden animate-fade-in">
				{/* Floating critical alert toast */}
				{lastCritical && (Date.now() - (lastCritical.ts || 0) < 5000) && !dismissedCritical && (
					<div className="fixed top-4 right-4 z-[9999] animate-popup-enter">
						<div className="bg-gradient-to-r from-slate-800 to-slate-900 border-2 border-red-400 rounded-xl p-4 min-w-80 max-w-sm shadow-2xl shadow-red-500/50 ring-1 ring-red-400 relative">
							{/* Close button */}
							<button
								onClick={() => setDismissedCritical(true)}
								className="absolute top-2 right-2 text-gray-400 hover:text-white hover:bg-red-500/20 rounded-full p-1 transition-all duration-200 hover:scale-110"
								aria-label="Close alert"
							>
								<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
								</svg>
							</button>
							<div className="flex items-start space-x-3">
								<div className="flex-shrink-0">
									<div className="w-8 h-8 bg-red-500/20 rounded-full flex items-center justify-center animate-pulse">
										<ExclamationTriangleIcon className="w-5 h-5 text-red-400" />
									</div>
								</div>
								<div className="space-y-2 flex-1">
									<div className="flex items-center space-x-2">
										<div className="w-2 h-2 bg-red-400 rounded-full animate-pulse"></div>
										<span className="text-xs font-bold text-red-200 uppercase tracking-wide">CRITICAL ALERT</span>
									</div>
									<div className="text-base font-bold text-white">
										Collision Risk: {lastCritical.alert.pair.a} ↔ {lastCritical.alert.pair.b}
									</div>
									<div className="text-xs text-gray-200 bg-slate-700 rounded-lg px-2 py-1">
										Distance: {lastCritical.alert.distance_m}m · Speed: {lastCritical.alert.relative_speed_mps}m/s
									</div>
									{(lastCritical.alert.suggestions || []).length > 0 && (
										<div className="bg-slate-700 border border-red-400 rounded-lg p-2">
											<p className="text-xs font-semibold text-red-200 mb-1">Actions:</p>
											<ul className="text-xs text-red-100 space-y-0.5">
												{(lastCritical.alert.suggestions || []).slice(0, 2).map((s, i) => (
													<li key={i} className="flex items-start space-x-1">
														<span className="text-red-400 mt-0.5">•</span>
														<span>{s}</span>
													</li>
												))}
											</ul>
										</div>
									)}
								</div>
							</div>
						</div>
					</div>
				)}
				{/* Header */}
				<header className="bg-slate-800/50 backdrop-blur-md border-b border-white/10 flex-shrink-0">
					<div className="px-4 sm:px-6 py-4">
						<div className="flex items-center justify-between">
							<div className="flex items-center space-x-4 lg:space-x-6">
								<div className="flex items-center space-x-3">
									<div className="p-2 bg-blue-500/20 rounded-lg">
										<TruckIcon className="w-5 h-5 sm:w-6 sm:h-6 text-blue-400" />
									</div>
									<div>
										<h1 className="text-lg sm:text-xl lg:text-2xl font-display font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
											Railway Traffic Optimizer
										</h1>
										<p className="text-xs sm:text-sm text-gray-400 hidden sm:block font-primary">Real-time Railway Network Management</p>
									</div>
								</div>
								<div className="hidden md:flex items-center space-x-4 lg:space-x-8 text-sm">
									<div className="flex items-center space-x-2 bg-slate-700/50 px-2 lg:px-3 py-2 rounded-lg">
										<TruckIcon className="w-3 h-3 lg:w-4 lg:h-4 text-green-400" />
										<span className="text-white font-medium text-xs lg:text-sm">10</span>
										<span className="text-gray-400 text-xs lg:text-sm hidden lg:inline">Active Trains</span>
									</div>
									<div className="flex items-center space-x-2 bg-slate-700/50 px-2 lg:px-3 py-2 rounded-lg">
										<MapPinIcon className="w-3 h-3 lg:w-4 lg:h-4 text-blue-400"/>
										<span className="text-white font-medium text-xs lg:text-sm">{Math.min(stations.length, 4)}</span>
										<span className="text-gray-400 text-xs lg:text-sm hidden lg:inline">Stations</span>
									</div>
									<div className="flex items-center space-x-2 bg-slate-700/50 px-2 lg:px-3 py-2 rounded-lg">
										<ExclamationTriangleIcon className="w-3 h-3 lg:w-4 lg:h-4 text-yellow-400" />
										<span className="text-white font-medium text-xs lg:text-sm">{signals.length}</span>
										<span className="text-gray-400 text-xs lg:text-sm hidden lg:inline">Signals</span>
									</div>
								</div>
							</div>
							<div className="flex items-center space-x-2 lg:space-x-3">
								<div className={`px-2 lg:px-3 py-1.5 rounded-full text-xs font-medium ${
									connectionMode === 'ws' 
										? 'bg-green-500/20 text-green-400 border border-green-500/30' 
										: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
								}`}>
									<div className="flex items-center space-x-1.5">
										<div className={`w-2 h-2 rounded-full ${
											connectionMode === 'ws' ? 'bg-green-400 animate-pulse' : 'bg-yellow-400'
										}`}></div>
										<span className="hidden sm:inline">{connectionMode === 'ws' ? 'Live' : 'Polling'}</span>
									</div>
								</div>
								{error && (
									<div className="px-2 lg:px-3 py-1.5 rounded-full text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30">
										<div className="flex items-center space-x-1.5">
											<div className="w-2 h-2 rounded-full bg-red-400"></div>
											<span className="hidden sm:inline">Error</span>
										</div>
									</div>
								)}
							</div>
						</div>
					</div>
				</header>

				{/* Main Content */}
				<div className="flex-1 flex min-h-0 overflow-hidden">
					{/* Map Section */}
					<div className="flex-1 relative min-w-0">
						<div className="absolute inset-0 bg-gradient-to-br from-blue-900/20 to-purple-900/20 z-10 pointer-events-none" />
					<MapContainer center={center} zoom={14} className="w-full h-full" preferCanvas>
						{/* Base OSM */}
						<TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
						{/* Railway overlay */}
						<TileLayer url="https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png" opacity={0.8} attribution="&copy; OpenRailwayMap" />
					{bbox && <FitBounds bbox={bbox} />}
					{selectedPosition && <CenterOnPosition position={selectedPosition} />}

					{/* Render edges on top for emphasis */}
					<Pane name="tracks" style={{ zIndex: 410 }}>
						{edgeLatLngs.map((e, index) => {
							const occ = occupiedPairs.has(e.pair)
							return (
								<Polyline 
									key={`track-${e.key}-${index}`} 
									positions={e.latlngs} 
									color={occ ? '#ef4444' : '#94a3b8'} 
									weight={occ ? 10 : 6} 
									opacity={occ ? 0.95 : 0.85}
									className="transition-all duration-300"
								/>
							)
						})}
					</Pane>

					{/* Train Routes */}
					<Pane name="train-routes" style={{ zIndex: 415 }}>
						{trainRoutes.map((route, index) => (
							<Polyline
								key={`route-${index}`}
								positions={route.coordinates}
								color={route.color}
								weight={3}
								opacity={0.6}
								dashArray="5, 5"
							/>
						))}
					</Pane>

					{/* Stations */}
					<Pane name="stations" style={{ zIndex: 420 }}>
						{stations.slice(0, 10).map((s, index) => (
							<Rectangle 
								key={`station-${s.id}-${index}`} 
								bounds={[[s.lat - 0.00005, s.lon - 0.00005],[s.lat + 0.00005, s.lon + 0.00005]]} 
								pathOptions={{ 
									color: '#ffffff', 
									weight: 2, 
									fillColor: '#3b82f6', 
									fillOpacity: 0.9,
									className: 'station-marker'
								}} 
							>
								<Tooltip direction="top" offset={[0, -4]} opacity={1} className="custom-tooltip">
									<div className="custom-tooltip">
										<span className="font-semibold">{s.name || s.id}</span>
									</div>
								</Tooltip>
							</Rectangle>
						))}
					</Pane>

					{/* Realtime selected train pin */}
					<Pane name="selected-train" style={{ zIndex: 450 }}>
						{selectedPosition && (
							<Marker position={[selectedPosition.lat, selectedPosition.lon]} icon={L.divIcon({ className: 'train-icon', html: `
								<div class="train-marker-container" style="display:flex;align-items:center;gap:4px;">
									<div style="font-size:20px;line-height:1;">🚆</div>
									<div class="train-marker-label">${selectedPosition.id}</div>
								</div>
							` })}>
								<Tooltip direction="right" offset={[8,0]} opacity={1} className="custom-tooltip">
									<div className="custom-tooltip">
										<div className="font-semibold">{selectedPosition.id}</div>
										<div className="text-sm text-gray-600">Realtime</div>
									</div>
								</Tooltip>
							</Marker>
						)}
					</Pane>

					{/* Signals */}
					<Pane name="signals" style={{ zIndex: 430 }}>
						{signals.map((sig, index) => (
							<Rectangle 
								key={`signal-${sig.id}-${index}`} 
								bounds={[[sig.lat - 0.00004, sig.lon - 0.00004],[sig.lat + 0.00004, sig.lon + 0.00004]]} 
								pathOptions={{ 
									color: '#ffffff', 
									weight: 2, 
									fillColor: sig.state === 'green' ? '#22c55e' : '#ef4444', 
									fillOpacity: 0.9 
								}} 
							/>
						))}
					</Pane>

					{/* Trains */}
					<Pane name="trains" style={{ zIndex: 440 }}>
						{trainLatLngs.map((t, index) => (
							<Marker 
								key={`train-${t.id}-${index}`} 
								position={[t.lat, t.lon]} 
								icon={L.divIcon({ 
									className: 'train-icon', 
									html: `
										<div class="train-marker-container" style="
											display: flex;
											align-items: center;
											gap: 6px;
											background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%);
											padding: 6px 12px;
											border-radius: 20px;
											border: 2px solid #ffffff;
											box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
											transition: all 0.3s ease;
											cursor: pointer;
										">
											<div style="font-size: 16px; line-height: 1;">🚆</div>
											<div style="
												color: white;
												font-weight: 600;
												font-size: 12px;
												text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
											">${t.id}</div>
										</div>
									` 
								})}
							>
								<Tooltip direction="right" offset={[8,0]} opacity={1} className="custom-tooltip">
									<div className="bg-slate-800/95 backdrop-blur-md border border-white/20 rounded-lg p-3 shadow-xl">
										<div className="font-semibold text-white text-sm">{t.id}</div>
										<div className="text-xs text-gray-300 capitalize mt-1">{t.status}</div>
									</div>
								</Tooltip>
							</Marker>
						))}
					</Pane>

					{/* Live Train Positions Overlay */}
					<Pane name="live-overlay" style={{ zIndex: 460 }}>
						{livePositions.map((p, idx) => (
							<Marker
								key={`live-${p.train_id}`}
								position={[p.lat, p.lon]}
								icon={L.divIcon({
									className: 'train-icon',
									html: `
										<div class="train-marker-container" style="
											display: flex;
											align-items: center;
											gap: 6px;
											background: linear-gradient(135deg, ${p.color || '#3b82f6'} 0%, ${p.color || '#1e40af'} 100%);
											padding: 8px 14px;
											border-radius: 25px;
											border: 3px solid #ffffff;
											box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
											transition: all 0.3s ease;
											cursor: pointer;
											animation: pulse 2s infinite;
										">
											<div style="font-size: 18px; line-height: 1;">🚆</div>
											<div style="
												color: white;
												font-weight: 700;
												font-size: 13px;
												text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
											">${p.train_id}</div>
										</div>
									`
								})}
							>
								<Tooltip direction="right" offset={[8,0]} opacity={1} className="custom-tooltip">
									<div className="bg-slate-800/95 backdrop-blur-md border border-white/20 rounded-lg p-4 shadow-xl min-w-48">
										<div className="font-semibold text-white text-sm mb-2">{p.train_id}</div>
										<div className="space-y-1">
											<div className="text-xs text-gray-300">
												Progress: <span className="text-blue-400 font-medium">{Math.round((p.progress || 0) * 100)}%</span>
											</div>
											<div className="text-xs text-gray-300">
												Direction: <span className="text-green-400 font-medium">{p.direction > 0 ? 'Forward' : 'Reverse'}</span>
											</div>
											<div className="text-xs text-gray-300">
												Status: <span className="text-yellow-400 font-medium">Live</span>
											</div>
										</div>
									</div>
								</Tooltip>
							</Marker>
						))}
					</Pane>
					</MapContainer>
				</div>

					{/* Control Panel */}
					<div className="w-80 lg:w-96 bg-slate-800/50 backdrop-blur-md border-l border-white/10 flex-shrink-0 h-full overflow-hidden">
						<div className="h-full flex flex-col">
							{/* Panel Header */}
							<div className="bg-slate-700/50 border-b border-white/10 px-4 lg:px-6 py-4">
								<div className="flex items-center space-x-3">
									<div className="p-2 bg-blue-500/20 rounded-lg">
										<Cog6ToothIcon className="w-4 h-4 lg:w-5 lg:h-5 text-blue-400" />
									</div>
									<div>
										<h2 className="text-base lg:text-lg font-display font-semibold text-white">Control Center</h2>
										<p className="text-xs text-gray-400 hidden sm:block font-primary">Railway Network Management</p>
									</div>
								</div>
							</div>

							{/* Panel Content */}
							<div className="flex-1 overflow-auto p-4 lg:p-6 space-y-4 lg:space-y-6">
								<ControlPanel />
								
								{/* Timeline Section */}
								<div className="space-y-4">
									<div className="flex items-center space-x-3">
										<div className="p-1.5 bg-blue-500/20 rounded-lg">
											<ChartBarIcon className="w-4 h-4 text-blue-400" />
										</div>
										<h3 className="text-base font-semibold text-white">Train Timeline</h3>
									</div>
									<div className="bg-slate-700/30 rounded-lg p-4">
										<Timeline trains={telemetry} />
									</div>
								</div>
								
								{/* Safety Alerts Section */}
								<div className="space-y-4">
									<div className="flex items-center space-x-3">
										<div className="p-2 bg-yellow-500/20 rounded-lg animate-pulse">
											<ExclamationTriangleIcon className="w-5 h-5 text-yellow-400" />
										</div>
										<h3 className="text-lg font-display font-bold text-white">Safety Alerts</h3>
										{alerts.length > 0 && (
											<div className="bg-red-500/20 text-red-300 px-2 py-1 rounded-full text-xs font-bold animate-pulse">
												{alerts.length} Active
											</div>
										)}
									</div>
									<div className="space-y-3">
										{alerts.length === 0 && (
											<div className="text-center py-12 text-gray-400 animate-bounce-in">
												<div className="w-16 h-16 mx-auto mb-4 bg-gray-600/30 rounded-full flex items-center justify-center animate-pulse">
													<ExclamationTriangleIcon className="w-8 h-8 text-gray-500" />
												</div>
												<p className="text-sm font-primary">No active alerts</p>
												<p className="text-xs text-gray-500 mt-1">System monitoring in progress...</p>
											</div>
										)}
										{alerts.map((a, idx) => (
											<div 
												key={`${(a?.pair?.a||'')}-${(a?.pair?.b||'')}-${idx}`} 
												className={`animate-bounce-in border-2 rounded-2xl p-5 transition-all duration-300 hover:scale-[1.02] ${
													a.severity === 'critical' 
														? 'border-red-500 bg-gradient-to-r from-slate-800 to-slate-900 shadow-lg shadow-red-500/50' 
														: 'border-yellow-500 bg-gradient-to-r from-slate-800 to-slate-900 shadow-lg shadow-yellow-500/50'
												}`}
												style={{ animationDelay: `${idx * 100}ms` }}
											>
												<div className="flex items-start justify-between">
													<div className="space-y-3 flex-1">
														<div className="flex items-center space-x-3">
															<div className={`w-3 h-3 rounded-full ${
																a.severity === 'critical' ? 'bg-red-400 animate-pulse' : 'bg-yellow-400 animate-pulse'
															}`}></div>
															<span className="text-base font-bold text-white font-display">
																{a.pair.a} ↔ {a.pair.b}
															</span>
															<span className={`text-xs px-3 py-1 rounded-full font-bold uppercase tracking-wide ${
																a.severity === 'critical' 
																	? 'bg-red-500/30 text-red-200 border border-red-400/40' 
																	: 'bg-yellow-500/30 text-yellow-200 border border-yellow-400/40'
															}`}>
																{a.severity}
															</span>
														</div>
														<div className="bg-slate-800 rounded-lg p-3 space-y-2">
															<p className="text-sm text-gray-200 font-medium">
																Distance: {a.distance_m}m · Speed: {a.relative_speed_mps}m/s
															</p>
															{a.same_edge && (
																<div className="flex items-center space-x-2 text-yellow-400 bg-yellow-800 rounded-lg px-3 py-2">
																	<span className="text-lg">⚠️</span>
																	<span className="text-sm font-medium">Same track</span>
																</div>
															)}
															{a.opposite_edge && (
																<div className="flex items-center space-x-2 text-red-400 bg-red-800 rounded-lg px-3 py-2">
																	<span className="text-lg">🚨</span>
																	<span className="text-sm font-medium">Opposing direction</span>
																</div>
															)}
														</div>
														{(a.suggestions || []).length > 0 && (
															<div className="bg-slate-700 border border-slate-600 rounded-lg p-4">
																<p className="text-sm font-bold text-gray-200 mb-3 flex items-center space-x-2">
																	<span>💡</span>
																	<span>Recommended Actions:</span>
																</p>
																<ul className="space-y-2">
																	{(a.suggestions || []).map((s, i) => (
																		<li key={i} className="flex items-start space-x-3 text-sm text-gray-100">
																			<span className="text-blue-400 mt-1 font-bold">{i + 1}.</span>
																			<span>{s}</span>
																		</li>
																	))}
																</ul>
															</div>
														)}
													</div>
													<button 
														onClick={() => {
															const k = [String(a?.pair?.a||''), String(a?.pair?.b||'')].sort().join('|')
															setDismissedAlertKeys(prev => new Set([...prev, k]))
															setAlerts(prev => prev.filter((x) => {
																const key = [String(x?.pair?.a||''), String(x?.pair?.b||'')].sort().join('|')
																return key !== k
															}))
														}} 
														className="text-gray-400 hover:text-white hover:bg-red-500/20 rounded-full p-2 transition-all duration-200 hover:scale-110"
													>
														<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
															<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
														</svg>
													</button>
												</div>
											</div>
										))}
									</div>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	)
}
