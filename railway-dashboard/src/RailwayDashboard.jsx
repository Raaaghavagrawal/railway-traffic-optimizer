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
							if (critical) setLastCritical({ ts: Date.now(), alert: critical })
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
		<div style={{ 
			height: '100vh', 
			width: '100vw', 
			display: 'flex', 
			flexDirection: 'column',
			background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)'
		}}>
			{/* Floating critical alert toast */}
			{lastCritical && (Date.now() - (lastCritical.ts || 0) < 5000) && (
				<div style={{ position: 'fixed', top: 16, right: 16, zIndex: 1000 }} className="animate-slide-down">
					<div className="glass border border-red-400/40" style={{ padding: '12px 14px', borderRadius: 12, minWidth: 320 }}>
						<div className="flex items-start space-x-3">
							<ExclamationTriangleIcon style={{ width: '1.25rem', height: '1.25rem' }} className="text-red-400 flex-shrink-0" />
							<div className="space-y-1">
								<div className="text-sm font-semibold text-white">Collision risk: {lastCritical.alert.pair.a} ↔ {lastCritical.alert.pair.b}</div>
								<div className="text-xs text-gray-300">Distance {lastCritical.alert.distance_m} m · Rel speed {lastCritical.alert.relative_speed_mps} m/s</div>
								<ul className="text-xs text-gray-200 list-disc pl-5">
									{(lastCritical.alert.suggestions || []).slice(0, 2).map((s, i) => (<li key={i}>{s}</li>))}
								</ul>
							</div>
						</div>
					</div>
				</div>
			)}
			{/* Header */}
			<header className="glass border-b border-white/10 animate-slide-down" style={{ flexShrink: 0 }}>
				<div className="container-fluid py-4">
					<div className="flex items-center justify-between">
						<div className="flex items-center space-x-4">
							<div className="flex items-center space-x-2">
								<TruckIcon style={{ width: '1.5rem', height: '1.5rem' }} className="text-blue-400 animate-glow" />
								<h1 className="text-2xl font-bold text-gradient">Railway Traffic Optimizer</h1>
							</div>
								<div className="hidden md:flex items-center space-x-6 text-sm text-gray-300">
								<div className="flex items-center space-x-2">
									<TruckIcon style={{ width: '1rem', height: '1rem' }} />
									<span>{telemetry.length} Trains</span>
								</div>
								<div className="flex items-center space-x-2">
									<MapPinIcon style={{ width: '1rem', height: '1rem' }} />
									<span>{stations.length} Stations</span>
								</div>
								<div className="flex items-center space-x-2">
									<ExclamationTriangleIcon style={{ width: '1rem', height: '1rem' }} />
									<span>{signals.length} Signals</span>
								</div>
							</div>
						</div>
						<div className="flex items-center space-x-3">
							<div className={`status-indicator ${
								connectionMode === 'ws' 
									? 'status-running' 
									: 'status-held'
							}`}>
								{connectionMode === 'ws' ? 'Live' : 'Polling'}
							</div>
							{error && (
								<div className="status-indicator status-stopped">
									Connection Error
								</div>
							)}
						</div>
					</div>
				</div>
			</header>

			{/* Main Content */}
			<div style={{ 
				flex: 1, 
				display: 'flex', 
				minHeight: 0,
				overflow: 'hidden'
			}}>
				{/* Map Section */}
				<div style={{ 
					flex: 1, 
					position: 'relative',
					minWidth: 0
				}}>
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
						{stations.map((s, index) => (
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
										<div class="train-marker-container" style="display:flex;align-items:center;gap:4px;">
											<div style="font-size:18px;line-height:1;">🚆</div>
											<div class="train-marker-label">${t.id}</div>
										</div>
									` 
								})}
							>
								<Tooltip direction="right" offset={[8,0]} opacity={1} className="custom-tooltip">
									<div className="custom-tooltip">
										<div className="font-semibold">{t.id}</div>
										<div className="text-sm text-gray-600 capitalize">{t.status}</div>
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
											display:flex;align-items:center;gap:4px;
											background:rgba(255,255,255,0.95);
											padding:3px 8px;border-radius:15px;
											border:3px solid ${p.color || '#3b82f6'};
											box-shadow: 0 2px 8px rgba(0,0,0,0.3);
											transition: all 0.2s ease;
										">
											<div style="font-size:18px;line-height:1;">🚆</div>
											<div class="train-marker-label" style="
												font-weight:bold;
												color:${p.color || '#1e40af'};
												font-size:12px;
											">${p.train_id}</div>
										</div>
									`
								})}
							>
								<Tooltip direction="right" offset={[8,0]} opacity={1} className="custom-tooltip">
									<div className="custom-tooltip">
										<div className="font-semibold">{p.train_id}</div>
										<div className="text-sm text-gray-600">
											Progress: {Math.round((p.progress || 0) * 100)}%
										</div>
										<div className="text-sm text-gray-600">
											Direction: {p.direction > 0 ? 'Forward' : 'Reverse'}
										</div>
									</div>
								</Tooltip>
							</Marker>
						))}
					</Pane>
					</MapContainer>
				</div>

				{/* Control Panel */}
				<div className="glass border-l border-white/10 overflow-hidden animate-slide-up" style={{ 
					width: '24rem',
					flexShrink: 0,
					height: '100%'
				}}>
					<div style={{ 
						height: '100%', 
						display: 'flex', 
						flexDirection: 'column' 
					}}>
						{/* Panel Header */}
						<div className="card-header">
							<div className="flex items-center space-x-2">
								<Cog6ToothIcon style={{ width: '1.25rem', height: '1.25rem' }} className="text-blue-400 animate-float" />
								<h2 className="card-title">Control Center</h2>
							</div>
						</div>

						{/* Panel Content */}
						<div className="flex-1 overflow-auto p-6 space-y-6">
							<ControlPanel />
							
							{/* Timeline Section */}
							<div className="space-y-3 animate-fade-in">
								<div className="flex items-center space-x-2">
									<ChartBarIcon style={{ width: '1.25rem', height: '1.25rem' }} className="text-blue-400" />
									<h3 className="text-base font-semibold text-white">Train Timeline</h3>
								</div>
								<Timeline trains={telemetry} />
							</div>
							
							{/* Safety Alerts Section */}
							<div className="space-y-3 animate-fade-in">
								<div className="flex items-center space-x-2">
									<ExclamationTriangleIcon style={{ width: '1.25rem', height: '1.25rem' }} className="text-yellow-400" />
									<h3 className="text-base font-semibold text-white">Safety Alerts</h3>
								</div>
								<div className="space-y-2">
									{alerts.length === 0 && (
										<div className="text-sm text-gray-400">No alerts</div>
									)}
									{alerts.map((a, idx) => (
										<div key={`${(a?.pair?.a||'')}-${(a?.pair?.b||'')}-${idx}`} className={`glass border ${a.severity === 'critical' ? 'border-red-500/40' : 'border-yellow-500/30'}`} style={{ padding: '10px 12px', borderRadius: 10 }}>
											<div className="flex items-start justify-between">
												<div className="space-y-1">
													<div className="text-sm font-semibold text-white">{a.pair.a} ↔ {a.pair.b} · {a.severity}</div>
													<div className="text-xs text-gray-300">{a.distance_m} m · rel {a.relative_speed_mps} m/s{a.same_edge ? ' · same edge' : a.opposite_edge ? ' · opposing' : ''}</div>
													<ul className="text-xs text-gray-200 list-disc pl-5">
														{(a.suggestions || []).map((s, i) => (<li key={i}>{s}</li>))}
													</ul>
												</div>
												<button onClick={() => {
													const k = [String(a?.pair?.a||''), String(a?.pair?.b||'')].sort().join('|')
													setDismissedAlertKeys(prev => new Set([...prev, k]))
													setAlerts(prev => prev.filter((x) => {
														const key = [String(x?.pair?.a||''), String(x?.pair?.b||'')].sort().join('|')
														return key !== k
													}))
												}} className="text-xs text-gray-300 hover:text-white">Dismiss</button>
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
	)
}
