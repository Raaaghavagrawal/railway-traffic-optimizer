import { useEffect, useMemo, useState } from 'react'
import { LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { 
  PlayIcon, 
  PauseIcon, 
  ArrowPathIcon, 
  ClockIcon, 
  ChartBarIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  XCircleIcon,
  MagnifyingGlassIcon,
  MapPinIcon
} from '@heroicons/react/24/outline'

export default function ControlPanel() {
	const [trains, setTrains] = useState([])
	const [optimizing, setOptimizing] = useState(false)
	const [error, setError] = useState('')
	const [history, setHistory] = useState([]) // metrics over time
	const [query, setQuery] = useState('')
	const [results, setResults] = useState([])
	const [selected, setSelected] = useState(null)
	const [schedule, setSchedule] = useState([])

	// Poll /trains for table data every 2s
	useEffect(() => {
		let cancelled = false
		let timer
		async function poll() {
			try {
				const res = await fetch('http://localhost:8000/trains', { cache: 'no-store' })
				const json = await res.json()
				if (!cancelled) {
					setTrains((json.trains || []).map(t => ({
						train_id: t.id,
						current_node: t.edge?.u,
						target_node: t.edge?.v,
						speed_mps: t.speed_mps,
						delay_s: (t.delay_min || 0) * 60,
						state: t.status
					})))
				}
			} catch (e) {
				if (!cancelled) setError(String(e))
			} finally {
				if (!cancelled) timer = setTimeout(poll, 2000)
			}
		}
		poll()
		return () => { cancelled = true; if (timer) clearTimeout(timer) }
	}, [])

	// Derived metrics
	const metrics = useMemo(() => {
		const num = trains.length || 1
		const avgSpeed = trains.reduce((s, t) => s + (t.speed_mps || 0), 0) / num
		const throughput = trains.filter(t => t.state === 'running').length * 6 // rough proxy trains/hour
		const avgDelay = trains.reduce((s, t) => s + (t.delay_s || 0), 0) / num
		return { avgSpeed, throughput, avgDelay }
	}, [trains])

	// update metric history
	useEffect(() => {
		setHistory(h => [...h.slice(-60), { t: Date.now(), avgSpeed: Number(metrics.avgSpeed?.toFixed?.(2) || metrics.avgSpeed), throughput: metrics.throughput, avgDelay: Number(metrics.avgDelay?.toFixed?.(1) || metrics.avgDelay) }])
	}, [metrics])

	async function postControl(body) {
		try {
			if (body.command === 'reset') {
				const res = await fetch('http://localhost:8000/reset', { method: 'POST' })
				const json = await res.json()
				if (!json.success) throw new Error(json.error || 'reset failed')
				return
			}
			if (body.command === 'reseed') {
				const res = await fetch('http://localhost:8000/simulate/reseed', { method: 'POST' })
				const json = await res.json()
				if (!json.success) throw new Error(json.error || 'reseed failed')
				return
			}
			if (body.command === 'delay') {
				const res = await fetch('http://localhost:8000/delay', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ train_id: body.train_id, delay_min: body.delay_min || 1 })
				})
				const json = await res.json()
				if (!json.success) throw new Error(json.error || 'delay failed')
				return
			}
			throw new Error('Unsupported control')
		} catch (e) {
			setError(String(e))
		}
	}

	async function search() {
		setError('')
		setSchedule([])
		setSelected(null)
		try {
			const res = await fetch(`http://localhost:8000/train/search?q=${encodeURIComponent(query)}`)
			const json = await res.json()
			setResults(json.trains || [])
		} catch (e) {
			setError(String(e))
		}
	}

	async function loadSchedule(trainNo) {
		setError('')
		try {
			const res = await fetch(`http://localhost:8000/train/${encodeURIComponent(trainNo)}/route`)
			const json = await res.json()
			setSchedule(json.stations || [])
		} catch (e) {
			setError(String(e))
		}
	}

	async function simulateByTrainNo(trainNo) {
		setError('')
		try {
			const res = await fetch(`http://localhost:8000/simulate/by_train_no?train_no=${encodeURIComponent(trainNo)}`, { method: 'POST' })
			const json = await res.json()
			if (!json.success) throw new Error(json.error || 'Simulation failed')
			try { window.dispatchEvent(new CustomEvent('setPlaying', { detail: { playing: true } })) } catch {}
			try { window.dispatchEvent(new CustomEvent('simulateRoute', { detail: { route: json.route || [] } })) } catch {}
			try { window.dispatchEvent(new CustomEvent('locateTrain', { detail: { trainId: json.train_id } })) } catch {}
		} catch (e) {
			setError(String(e))
		}
	}

	function setPlaying(playing) {
		try { window.dispatchEvent(new CustomEvent('setPlaying', { detail: { playing } })) } catch {}
	}

	function locateTrainNow(trainId) {
		try { window.dispatchEvent(new CustomEvent('locateTrain', { detail: { trainId } })) } catch {}
	}

	async function simulate(direction) {
		setError('')
		try {
			const res = await fetch('http://localhost:8000/simulate/train', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ train_no: selected?.Train_No, direction })
			})
			const json = await res.json()
			if (!json.success) throw new Error('Simulation failed')
			// Notify map to highlight the intended route
			try { window.dispatchEvent(new CustomEvent('simulateRoute', { detail: { route: json.route || [] } })) } catch {}
		} catch (e) {
			setError(String(e))
		}
	}

	async function runOptimizer() {
		setOptimizing(true)
		setError('')
		try {
			const res = await fetch('http://localhost:8000/optimize', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ headway_s: 60 })
			})
			const json = await res.json()
			if (!json.success) throw new Error(json.error || 'optimizer error')
		} catch (e) {
			setError(String(e))
		} finally {
			setOptimizing(false)
		}
	}

	return (
		<div className="space-y-6">
			{/* Train Search */}
			<div className="card animate-fade-in">
				<div className="flex items-center space-x-2 mb-3">
					<MagnifyingGlassIcon style={{ width: '1.0rem', height: '1.0rem' }} className="text-blue-400" />
					<h3 className="text-sm font-semibold text-white">Search Train</h3>
				</div>
				<div className="flex space-x-2 mb-3">
					<input 
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Enter train number or name"
						className="input flex-1"
					/>
					<button onClick={search} className="btn btn-primary hover-lift">Search</button>
				</div>
				{results.length > 0 && (
					<div className="space-y-2 max-h-40 overflow-auto">
						{results.map((r, idx) => (
							<div 
								key={`${r.Train_No}-${idx}`} 
								className={`w-full px-3 py-2 rounded border ${selected?.Train_No === r.Train_No ? 'border-blue-500 bg-blue-500/10' : 'border-white/10 hover:border-white/20'} text-white`}
							>
								<div className="flex items-center justify-between">
									<button onClick={() => { setSelected(r); loadSchedule(r.Train_No) }} className="text-left flex-1">
										<div className="flex items-center gap-2">
											<span role="img" aria-label="train">🚆</span>
											<div className="font-mono">{r.Train_No}</div>
											<div className="truncate ml-2 flex-1">{r.Train_Name}</div>
										</div>
										<div className="text-xs text-gray-300">{r.Source_Station_Name} → {r.Destination_Station_Name} · {r.days}</div>
									</button>
									<button onClick={() => simulateByTrainNo(r.Train_No)} className="btn btn-primary hover-lift" style={{ fontSize: '0.75rem', marginLeft: '0.5rem' }}>Simulate</button>
								</div>
							</div>
						))}
					</div>
				)}
				{selected && (
					<div className="mt-3 space-y-2">
						<div className="flex items-center space-x-2 text-gray-200">
							<MapPinIcon style={{ width: '1rem', height: '1rem' }} />
							<span className="text-sm">Schedule (first 10 stops)</span>
						</div>
						<div className="text-xs text-gray-300 max-h-32 overflow-auto border border-white/10 rounded">
							<table className="w-full text-left">
								<thead>
									<tr className="text-gray-400">
										<th className="px-2 py-1">Code</th>
										<th className="px-2 py-1">Station</th>
										<th className="px-2 py-1">Arr</th>
										<th className="px-2 py-1">Dep</th>
									</tr>
								</thead>
								<tbody>
									{(schedule || []).slice(0, 10).map((s, i) => (
										<tr key={`${s.Station_Code}-${i}`} className="border-t border-white/5">
											<td className="px-2 py-1">{s.Station_Code}</td>
											<td className="px-2 py-1">{s.Station_Name}</td>
											<td className="px-2 py-1">{s.Arrival_time}</td>
											<td className="px-2 py-1">{s.Departure_Time}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
						<div className="flex space-x-2">
							<button onClick={() => simulate('forward')} className="btn btn-primary hover-lift" style={{ flex: 1 }}>Simulate DLI→ANVT</button>
							<button onClick={() => simulate('reverse')} className="btn btn-secondary hover-lift" style={{ flex: 1 }}>Simulate ANVT→DLI</button>
						</div>
					</div>
				)}
			</div>

			{/* Control Actions */}
			<div className="card animate-scale-in">
				<div className="flex items-center justify-between mb-4">
					<h3 className="text-sm font-semibold text-white">System Controls</h3>
					<div className="flex items-center space-x-2">
						{optimizing && (
							<div className="flex items-center space-x-1 text-blue-400">
								<div className="loading-spinner h-3 w-3"></div>
								<span className="text-xs">Optimizing</span>
							</div>
						)}
					</div>
				</div>
				<div className="flex space-x-3">
				<button 
						onClick={runOptimizer} 
						disabled={optimizing}
						className="btn btn-primary hover-lift"
						style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
					>
						<ChartBarIcon style={{ width: '1rem', height: '1rem' }} />
						<span>{optimizing ? 'Optimizing...' : 'Run AI Optimizer'}</span>
					</button>
					<button 
						onClick={() => postControl({ command: 'reset' })}
						className="btn btn-secondary hover-lift"
						style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
					>
						<ArrowPathIcon style={{ width: '1rem', height: '1rem' }} />
					</button>
					<button 
						onClick={() => postControl({ command: 'reseed' })}
						className="btn btn-primary hover-lift"
						style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
						title="Seed 10 Delhi trains"
					>
						<span>Seed Delhi Trains</span>
					</button>
					<button 
						onClick={() => setPlaying(true)}
						className="btn btn-secondary hover-lift"
						style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem' }}
						title="Play"
					>
						<PlayIcon style={{ width: '1rem', height: '1rem' }} />
					</button>
					<button 
						onClick={() => setPlaying(false)}
						className="btn btn-secondary hover-lift"
						style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem' }}
						title="Pause"
					>
						<PauseIcon style={{ width: '1rem', height: '1rem' }} />
					</button>
				</div>
			</div>

			{/* Metrics Cards */}
			<div className="grid grid-cols-1 gap-3">
				<div className="card hover-lift animate-slide-up">
					<div className="flex items-center justify-between mb-2">
						<div className="flex items-center space-x-2">
							<ClockIcon style={{ width: '1rem', height: '1rem' }} className="text-orange-400 animate-pulse" />
							<span className="text-xs font-medium text-gray-300">Average Delay</span>
						</div>
						<ExclamationTriangleIcon style={{ width: '1rem', height: '1rem' }} className="text-orange-400" />
					</div>
					<div className="text-2xl font-bold text-gradient-warning">
						{(metrics.avgDelay || 0).toFixed ? (metrics.avgDelay || 0).toFixed(1) : metrics.avgDelay}s
					</div>
					<div className="text-xs text-gray-400 mt-1">Total delay across all trains</div>
				</div>

				<div className="card hover-lift animate-slide-up" style={{ animationDelay: '0.1s' }}>
					<div className="flex items-center justify-between mb-2">
						<div className="flex items-center space-x-2">
							<ChartBarIcon style={{ width: '1rem', height: '1rem' }} className="text-green-400 animate-pulse" />
							<span className="text-xs font-medium text-gray-300">Throughput</span>
						</div>
						<CheckCircleIcon style={{ width: '1rem', height: '1rem' }} className="text-green-400" />
					</div>
					<div className="text-2xl font-bold text-gradient-success">{metrics.throughput}</div>
					<div className="text-xs text-gray-400 mt-1">Trains per hour</div>
				</div>

				<div className="card hover-lift animate-slide-up" style={{ animationDelay: '0.2s' }}>
					<div className="flex items-center justify-between mb-2">
						<div className="flex items-center space-x-2">
							<PlayIcon style={{ width: '1rem', height: '1rem' }} className="text-blue-400 animate-pulse" />
							<span className="text-xs font-medium text-gray-300">Avg Speed</span>
						</div>
						<CheckCircleIcon style={{ width: '1rem', height: '1rem' }} className="text-blue-400" />
					</div>
					<div className="text-2xl font-bold text-gradient">
						{(metrics.avgSpeed || 0).toFixed ? (metrics.avgSpeed || 0).toFixed(1) : metrics.avgSpeed} m/s
					</div>
					<div className="text-xs text-gray-400 mt-1">Average train speed</div>
				</div>
			</div>

			{/* Train Status Table */}
			<div className="card overflow-hidden animate-fade-in">
				<div className="card-header">
					<h3 className="text-sm font-semibold text-white">Train Status</h3>
				</div>
				<div className="overflow-auto max-h-64">
					<table className="table">
						<thead className="table-header">
							<tr>
								<th>Train</th>
								<th>Status</th>
								<th className="text-right">Speed</th>
								<th className="text-right">Delay</th>
								<th className="text-center">Actions</th>
							</tr>
						</thead>
						<tbody className="table-body">
							{trains.map((tr, index) => (
								<tr key={tr.train_id} className="table-row animate-slide-up" style={{ animationDelay: `${index * 0.1}s` }}>
									<td className="table-cell">
										<div className="flex items-center space-x-2">
											<div className={`w-2 h-2 rounded-full ${
												tr.state === 'running' ? 'bg-green-400 animate-pulse' :
												tr.state === 'stopped' ? 'bg-red-400' :
												tr.state === 'held' ? 'bg-yellow-400' : 'bg-gray-400'
											}`}></div>
											<span className="font-mono text-white">{tr.train_id}</span>
										</div>
									</td>
									<td className="table-cell">
										<span className={`status-indicator ${
											tr.state === 'running' ? 'status-running' :
											tr.state === 'stopped' ? 'status-stopped' :
											tr.state === 'held' ? 'status-held' : 'status-delayed'
										}` }>
											{tr.state || 'unknown'}
										</span>
									</td>
									<td className="table-cell text-right text-white">
										{(tr.speed_mps || 0).toFixed ? (tr.speed_mps || 0).toFixed(1) : (tr.speed_mps || 0)} m/s
									</td>
									<td className="table-cell text-right text-white">
										{(tr.delay_s || 0).toFixed ? (tr.delay_s || 0).toFixed(0) : (tr.delay_s || 0)}s
									</td>
									<td className="table-cell text-center">
										<div className="flex items-center justify-center gap-2">
											<button 
												onClick={() => {
													const mins = prompt('Delay minutes?', '1')
													if (mins != null) postControl({ command: 'delay', train_id: tr.train_id, delay_min: parseInt(mins) || 1 })
												}} 
												className="btn btn-warning hover-lift"
												style={{ fontSize: '0.75rem' }}
											>
												Delay
											</button>
											<button 
												onClick={() => locateTrainNow(tr.train_id)} 
												className="btn btn-secondary hover-lift"
												style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
												title="Locate now"
											>
												<MapPinIcon style={{ width: '0.9rem', height: '0.9rem' }} />
												Locate
											</button>
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</div>

			{/* Performance Chart */}
			<div className="card animate-fade-in">
				<div className="flex items-center space-x-2 mb-4">
					<ChartBarIcon style={{ width: '1rem', height: '1rem' }} className="text-blue-400 animate-float" />
					<h3 className="text-sm font-semibold text-white">Performance Metrics</h3>
				</div>
				<div className="h-48">
					<ResponsiveContainer width="100%" height="100%">
						<LineChart data={history.map((d, i) => ({ index: i, ...d }))} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
							<CartesianGrid stroke="#374151" strokeDasharray="3 3" />
							<XAxis dataKey="index" tick={{ fill: '#9ca3af', fontSize: 10 }} />
							<YAxis tick={{ fill: '#9ca3af', fontSize: 10 }} />
							<Tooltip 
								contentStyle={{ 
									background: 'rgba(0, 0, 0, 0.8)', 
									border: '1px solid rgba(255, 255, 255, 0.1)',
									borderRadius: '8px',
									backdropFilter: 'blur(10px)'
								}} 
								labelStyle={{ color: '#e5e7eb' }} 
							/>
							<Legend wrapperStyle={{ color: '#9ca3af' }} />
							<Line type="monotone" dataKey="avgSpeed" stroke="#22c55e" strokeWidth={2} dot={false} name="Avg Speed" />
							<Line type="monotone" dataKey="throughput" stroke="#3b82f6" strokeWidth={2} dot={false} name="Throughput" />
							<Line type="monotone" dataKey="avgDelay" stroke="#f97316" strokeWidth={2} dot={false} name="Avg Delay" />
						</LineChart>
					</ResponsiveContainer>
				</div>
			</div>

			{/* Error Display */}
			{error && (
				<div className="card bg-red-500/10 border-red-500/20 animate-scale-in">
					<div className="flex items-center space-x-2">
						<XCircleIcon style={{ width: '1rem', height: '1rem' }} className="text-red-400 animate-pulse" />
						<span className="text-sm text-red-400">{error}</span>
					</div>
				</div>
			)}
		</div>
	)
}
