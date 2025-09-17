import { useMemo } from 'react'
import { ClockIcon, MapPinIcon } from '@heroicons/react/24/outline'

export default function Timeline({ trains = [] }) {
	// Enhanced timeline with better visualization
	const rows = useMemo(() => {
		return trains.map((t, i) => ({ 
			id: t.train_id || t.id, 
			y: i,
			progress: Math.max(0, Math.min(1, t.progress || 0)),
			status: t.status || 'unknown',
			speed: t.speed_mps || 0,
			delay: t.delay_min || 0
		}))
	}, [trains])

	const getStatusColor = (status) => {
		switch (status) {
			case 'running': return '#22c55e'
			case 'stopped': return '#ef4444'
			case 'held': return '#f59e0b'
			default: return '#6b7280'
		}
	}

	const getStatusBgColor = (status) => {
		switch (status) {
			case 'running': return 'rgba(34, 197, 94, 0.2)'
			case 'stopped': return 'rgba(239, 68, 68, 0.2)'
			case 'held': return 'rgba(245, 158, 11, 0.2)'
			default: return 'rgba(107, 114, 128, 0.2)'
		}
	}

	return (
		<div className="card overflow-hidden animate-fade-in">
			<div className="card-header">
				<div className="flex items-center justify-between">
					<div className="flex items-center space-x-2">
						<ClockIcon style={{ width: '1rem', height: '1rem' }} className="text-blue-400 animate-float" />
						<span className="text-sm font-medium text-white">Progress Timeline</span>
					</div>
					<span className="text-xs text-gray-400">{trains.length} trains</span>
				</div>
			</div>
			
			<div className="p-4">
				{rows.length === 0 ? (
					<div className="text-center py-8 animate-fade-in">
						<MapPinIcon style={{ width: '2rem', height: '2rem' }} className="text-gray-400 mx-auto mb-2 animate-float" />
						<p className="text-sm text-gray-400">No trains in system</p>
					</div>
				) : (
					<div className="space-y-3">
						{rows.map((row, idx) => (
							<div key={row.id} className="space-y-2 animate-slide-up" style={{ animationDelay: `${idx * 0.1}s` }}>
								{/* Train Info */}
								<div className="flex items-center justify-between">
									<div className="flex items-center space-x-2">
										<div className={`w-2 h-2 rounded-full ${row.status === 'running' ? 'animate-pulse' : ''}`} style={{ backgroundColor: getStatusColor(row.status) }}></div>
										<span className="text-sm font-mono text-white">{row.id}</span>
										<span className={`status-indicator ${
											row.status === 'running' ? 'status-running' :
											row.status === 'stopped' ? 'status-stopped' :
											row.status === 'held' ? 'status-held' : 'status-delayed'
										}`}>
											{row.status}
										</span>
									</div>
									<div className="text-xs text-gray-400">
										{row.speed.toFixed(1)} m/s
									</div>
								</div>
								
								{/* Progress Bar */}
								<div className="relative">
									<div className="progress-bar">
										<div 
											className={`progress-fill ${
												row.status === 'running' ? 'progress-running' :
												row.status === 'stopped' ? 'progress-stopped' :
												row.status === 'held' ? 'progress-held' : ''
											}`}
											style={{ width: `${row.progress * 100}%` }}
										>
											{/* Animated shimmer effect for running trains */}
											{row.status === 'running' && (
												<div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer"></div>
											)}
										</div>
									</div>
									<div className="flex justify-between text-xs text-gray-400 mt-1">
										<span>0%</span>
										<span className="font-medium">{Math.round(row.progress * 100)}%</span>
										<span>100%</span>
									</div>
								</div>
								
								{/* Additional Info */}
								{row.delay > 0 && (
									<div className="flex items-center space-x-1 text-xs text-orange-400 animate-fade-in">
										<ClockIcon style={{ width: '0.75rem', height: '0.75rem' }} className="animate-pulse" />
										<span>+{row.delay}min delay</span>
									</div>
								)}
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	)
}


