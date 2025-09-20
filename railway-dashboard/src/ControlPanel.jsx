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
  MapPinIcon,
  Cog6ToothIcon,
  TruckIcon
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
		<div className="space-y-4 lg:space-y-6">
			{/* Train Search */}
			<div className="bg-slate-700/30 rounded-xl p-3 lg:p-4 border border-white/10">
				<div className="flex items-center space-x-3 mb-3 lg:mb-4">
					<div className="p-1.5 bg-blue-500/20 rounded-lg">
						<MagnifyingGlassIcon className="w-3 h-3 lg:w-4 lg:h-4 text-blue-400" />
					</div>
					<h3 className="text-xs lg:text-sm font-display font-semibold text-white">Search Train</h3>
				</div>
				<div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-2 mb-3 lg:mb-4">
					<input 
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Enter train number or name"
						className="flex-1 px-3 py-2 bg-slate-600/50 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all text-sm font-primary"
					/>
					<button 
						onClick={search} 
						className="px-3 lg:px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium transition-colors flex items-center justify-center space-x-2 text-sm font-primary"
					>
						<MagnifyingGlassIcon className="w-3 h-3 lg:w-4 lg:h-4" />
						<span className="hidden sm:inline">Search</span>
					</button>
				</div>
				{results.length > 0 && (
					<div className="space-y-2 max-h-40 overflow-auto">
						{results.map((r, idx) => (
							<div 
								key={`${r.Train_No}-${idx}`} 
								className={`w-full p-3 rounded-lg border transition-all ${
									selected?.Train_No === r.Train_No 
										? 'border-blue-500 bg-blue-500/10' 
										: 'border-white/10 hover:border-white/20 bg-slate-600/30'
								}`}
							>
								<div className="flex items-center justify-between">
									<button 
										onClick={() => { setSelected(r); loadSchedule(r.Train_No) }} 
										className="text-left flex-1"
									>
										<div className="flex items-center gap-3">
											<span role="img" aria-label="train" className="text-lg">🚆</span>
											<div>
												<div className="font-mono text-white font-medium">{r.Train_No}</div>
												<div className="text-sm text-gray-300 truncate font-primary">{r.Train_Name}</div>
											</div>
										</div>
										<div className="text-xs text-gray-400 mt-1 font-primary">
											{r.Source_Station_Name} → {r.Destination_Station_Name} · {r.days}
										</div>
									</button>
									<button 
										onClick={() => simulateByTrainNo(r.Train_No)} 
										className="px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-xs font-medium transition-colors ml-2"
									>
										Simulate
									</button>
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


			{/* Metrics Cards */}
			<div className="grid grid-cols-1 gap-4">
				<div className="bg-slate-700/30 rounded-xl p-4 border border-white/10 hover:border-orange-500/30 transition-all">
					<div className="flex items-center justify-between mb-3">
						<div className="flex items-center space-x-3">
							<div className="p-2 bg-orange-500/20 rounded-lg">
								<ClockIcon className="w-4 h-4 text-orange-400" />
							</div>
							<span className="text-sm font-medium text-gray-300">Average Delay</span>
						</div>
						<ExclamationTriangleIcon className="w-4 h-4 text-orange-400" />
					</div>
					<div className="text-2xl font-bold text-orange-400">
						{(metrics.avgDelay || 0).toFixed ? (metrics.avgDelay || 0).toFixed(1) : metrics.avgDelay}s
					</div>
					<div className="text-xs text-gray-400 mt-1">Total delay across all trains</div>
				</div>

				<div className="bg-slate-700/30 rounded-xl p-4 border border-white/10 hover:border-green-500/30 transition-all">
					<div className="flex items-center justify-between mb-3">
						<div className="flex items-center space-x-3">
							<div className="p-2 bg-green-500/20 rounded-lg">
								<ChartBarIcon className="w-4 h-4 text-green-400" />
							</div>
							<span className="text-sm font-medium text-gray-300">Throughput</span>
						</div>
						<CheckCircleIcon className="w-4 h-4 text-green-400" />
					</div>
					<div className="text-2xl font-bold text-green-400">{metrics.throughput}</div>
					<div className="text-xs text-gray-400 mt-1">Trains per hour</div>
				</div>

				<div className="bg-slate-700/30 rounded-xl p-4 border border-white/10 hover:border-blue-500/30 transition-all">
					<div className="flex items-center justify-between mb-3">
						<div className="flex items-center space-x-3">
							<div className="p-2 bg-blue-500/20 rounded-lg">
								<PlayIcon className="w-4 h-4 text-blue-400" />
							</div>
							<span className="text-sm font-medium text-gray-300">Avg Speed</span>
						</div>
						<CheckCircleIcon className="w-4 h-4 text-blue-400" />
					</div>
					<div className="text-2xl font-bold text-blue-400">
						{(metrics.avgSpeed || 0).toFixed ? (metrics.avgSpeed || 0).toFixed(1) : metrics.avgSpeed} m/s
					</div>
					<div className="text-xs text-gray-400 mt-1">Average train speed</div>
				</div>
			</div>

			{/* Train Status Table */}
			<div className="bg-slate-700/30 rounded-xl border border-white/10 overflow-hidden">
				<div className="bg-slate-600/50 px-4 py-3 border-b border-white/10">
					<div className="flex items-center space-x-3">
						<div className="p-1.5 bg-purple-500/20 rounded-lg">
							<TruckIcon className="w-4 h-4 text-purple-400" />
						</div>
						<h3 className="text-sm font-semibold text-white">Train Status</h3>
					</div>
				</div>
				<div className="overflow-auto max-h-64">
					<table className="w-full">
						<thead className="bg-slate-600/30">
							<tr>
								<th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Train</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Status</th>
								<th className="px-4 py-3 text-right text-xs font-medium text-gray-300 uppercase tracking-wider">Speed</th>
								<th className="px-4 py-3 text-right text-xs font-medium text-gray-300 uppercase tracking-wider">Delay</th>
								<th className="px-4 py-3 text-center text-xs font-medium text-gray-300 uppercase tracking-wider">Actions</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-white/10">
							{trains.map((tr, index) => (
								<tr key={tr.train_id} className="hover:bg-slate-600/20 transition-colors">
									<td className="px-4 py-3">
										<div className="flex items-center space-x-3">
											<div className={`w-3 h-3 rounded-full ${
												tr.state === 'running' ? 'bg-green-400 animate-pulse' :
												tr.state === 'stopped' ? 'bg-red-400' :
												tr.state === 'held' ? 'bg-yellow-400' : 'bg-gray-400'
											}`}></div>
											<span className="font-mono text-white font-medium">{tr.train_id}</span>
										</div>
									</td>
									<td className="px-4 py-3">
										<span className={`px-2 py-1 rounded-full text-xs font-medium ${
											tr.state === 'running' ? 'bg-green-500/20 text-green-300' :
											tr.state === 'stopped' ? 'bg-red-500/20 text-red-300' :
											tr.state === 'held' ? 'bg-yellow-500/20 text-yellow-300' : 'bg-gray-500/20 text-gray-300'
										}`}>
											{tr.state || 'unknown'}
										</span>
									</td>
									<td className="px-4 py-3 text-right text-white font-medium">
										{(tr.speed_mps || 0).toFixed ? (tr.speed_mps || 0).toFixed(1) : (tr.speed_mps || 0)} m/s
									</td>
									<td className="px-4 py-3 text-right text-white font-medium">
										{(tr.delay_s || 0).toFixed ? (tr.delay_s || 0).toFixed(0) : (tr.delay_s || 0)}s
									</td>
									<td className="px-4 py-3 text-center">
										<div className="flex items-center justify-center gap-2">
											<button 
												onClick={() => {
													const mins = prompt('Delay minutes?', '1')
													if (mins != null) postControl({ command: 'delay', train_id: tr.train_id, delay_min: parseInt(mins) || 1 })
												}} 
												className="px-2 py-1 bg-yellow-500 hover:bg-yellow-600 text-white rounded text-xs font-medium transition-colors"
											>
												Delay
											</button>
											<button 
												onClick={() => locateTrainNow(tr.train_id)} 
												className="px-2 py-1 bg-slate-600 hover:bg-slate-700 text-white rounded text-xs font-medium transition-colors flex items-center gap-1"
												title="Locate now"
											>
												<MapPinIcon className="w-3 h-3" />
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
			<div className="bg-slate-700/30 rounded-xl p-4 border border-white/10">
				<div className="flex items-center space-x-3 mb-4">
					<div className="p-1.5 bg-blue-500/20 rounded-lg">
						<ChartBarIcon className="w-4 h-4 text-blue-400" />
					</div>
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
									background: 'rgba(15, 23, 42, 0.95)', 
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
				<div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4">
					<div className="flex items-center space-x-3">
						<XCircleIcon className="w-5 h-5 text-red-400 animate-pulse" />
						<span className="text-sm text-red-400 font-medium">{error}</span>
					</div>
				</div>
			)}
		</div>
	)
}
