import { useState, useEffect, useMemo } from 'react'
import { 
  LineChart, Line, AreaChart, Area, BarChart, Bar, 
  CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, 
  Legend, PieChart, Pie, Cell, RadarChart, PolarGrid, 
  PolarAngleAxis, PolarRadiusAxis, Radar
} from 'recharts'
import { 
  ChartBarIcon, 
  ClockIcon, 
  TruckIcon, 
  ExclamationTriangleIcon,
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon
} from '@heroicons/react/24/outline'

const COLORS = ['#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6']

export default function PerformanceMetrics({ telemetry, alerts, stations, performanceMetrics, delayPredictions }) {
  const [metrics, setMetrics] = useState({
    averageDelay: 0,
    throughput: 0,
    averageSpeed: 0,
    onTimePerformance: 0,
    criticalAlerts: 0,
    stationBottlenecks: []
  })

  const [timeRange, setTimeRange] = useState('1h')
  const [selectedMetric, setSelectedMetric] = useState('delays')
  const [lastUpdate, setLastUpdate] = useState(Date.now())

  // Update metrics when performance metrics change
  useEffect(() => {
    if (performanceMetrics) {
      setMetrics(prev => ({
        ...prev,
        averageDelay: performanceMetrics.averageDelay,
        throughput: performanceMetrics.throughput,
        averageSpeed: performanceMetrics.averageSpeed,
        onTimePerformance: performanceMetrics.onTimePerformance,
        criticalAlerts: performanceMetrics.criticalAlerts
      }))
      setLastUpdate(performanceMetrics.lastUpdate)
    }
  }, [performanceMetrics?.lastUpdate, performanceMetrics?.averageDelay, performanceMetrics?.averageSpeed, performanceMetrics?.throughput])

  // Calculate real-time metrics
  useEffect(() => {
    if (!telemetry.length) return

    const now = Date.now()
    const oneHourAgo = now - (60 * 60 * 1000)
    
    // Filter recent data
    const recentTelemetry = telemetry.filter(t => 
      t.timestamp && (t.timestamp > oneHourAgo)
    )

    // Calculate average delay
    const totalDelay = recentTelemetry.reduce((sum, t) => sum + (t.delay_s || 0), 0)
    const averageDelay = recentTelemetry.length > 0 ? totalDelay / recentTelemetry.length : 0

    // Calculate throughput (trains per hour)
    const throughput = recentTelemetry.length

    // Calculate average speed
    const totalSpeed = recentTelemetry.reduce((sum, t) => sum + (t.speed_mps || 0), 0)
    const averageSpeed = recentTelemetry.length > 0 ? totalSpeed / recentTelemetry.length : 0

    // Calculate on-time performance (trains with delay < 5 minutes)
    const onTimeTrains = recentTelemetry.filter(t => (t.delay_s || 0) < 300).length
    const onTimePerformance = recentTelemetry.length > 0 ? 
      (onTimeTrains / recentTelemetry.length) * 100 : 0

    // Count critical alerts
    const criticalAlerts = alerts.filter(a => a.severity === 'critical').length

    // Identify station bottlenecks
    const stationBottlenecks = calculateStationBottlenecks(recentTelemetry, stations)

    setMetrics({
      averageDelay: Math.round(averageDelay),
      throughput,
      averageSpeed: Math.round(averageSpeed * 3.6), // Convert to km/h
      onTimePerformance: Math.round(onTimePerformance),
      criticalAlerts,
      stationBottlenecks
    })
  }, [telemetry, alerts, stations])

  const calculateStationBottlenecks = (telemetry, stations) => {
    const stationDelays = {}
    
    // Process real telemetry data
    telemetry.forEach(train => {
      const station = train.current_station || 'Unknown'
      if (!stationDelays[station]) {
        stationDelays[station] = { totalDelay: 0, count: 0, trains: [] }
      }
      stationDelays[station].totalDelay += train.delay_s || 0
      stationDelays[station].count += 1
      stationDelays[station].trains.push(train.train_id)
    })

    // Add sample data if no real data
    if (Object.keys(stationDelays).length === 0) {
      const sampleStations = ['NDLS', 'CSMT', 'HWH', 'MAS', 'SBC']
      sampleStations.forEach((station, index) => {
        stationDelays[station] = {
          totalDelay: 300 + (index * 100) + Math.random() * 200,
          count: 3 + Math.floor(Math.random() * 4),
          trains: [`TR${index + 1}`, `TR${index + 6}`]
        }
      })
    }

    return Object.entries(stationDelays)
      .map(([station, data]) => ({
        station,
        averageDelay: Math.round(data.totalDelay / data.count),
        trainCount: data.count,
        severity: data.totalDelay / data.count > 600 ? 'high' : 
                 data.totalDelay / data.count > 300 ? 'medium' : 'low'
      }))
      .sort((a, b) => b.averageDelay - a.averageDelay)
      .slice(0, 5)
  }

  // Generate time series data for charts
  const timeSeriesData = useMemo(() => {
    const data = []
    const now = Date.now()
    const intervals = timeRange === '1h' ? 12 : timeRange === '6h' ? 24 : 48
    const intervalMs = timeRange === '1h' ? 5 * 60 * 1000 : timeRange === '6h' ? 15 * 60 * 1000 : 30 * 60 * 1000

    // Always generate static sample data for consistent visualization
    for (let i = intervals; i >= 0; i--) {
      const timestamp = now - (i * intervalMs)
      
      // Generate consistent static data with some variation
      const baseDelay = 150 + Math.sin(i * 0.3) * 80 + Math.cos(i * 0.2) * 40
      const baseSpeed = 50 + Math.cos(i * 0.25) * 20 + Math.sin(i * 0.15) * 10
      const baseThroughput = 10 + Math.sin(i * 0.35) * 4 + Math.cos(i * 0.4) * 2
      
      // Apply performance metrics changes if available
      const delayMultiplier = performanceMetrics?.lastUpdate ? 
        Math.max(0.6, 1 - (performanceMetrics.averageDelay / 150)) : 1
      const speedMultiplier = performanceMetrics?.lastUpdate ? 
        Math.min(1.4, 1 + (performanceMetrics.averageSpeed / 80)) : 1
      const throughputMultiplier = performanceMetrics?.lastUpdate ? 
        Math.min(1.5, 1 + (performanceMetrics.throughput / 40)) : 1

      const avgDelay = Math.max(20, baseDelay * delayMultiplier)
      const avgSpeed = Math.max(25, baseSpeed * speedMultiplier)
      const throughput = Math.max(2, baseThroughput * throughputMultiplier)
      const onTime = Math.max(1, throughput * (0.5 + (avgDelay < 80 ? 0.4 : avgDelay < 120 ? 0.2 : 0.1)))

      data.push({
        time: new Date(timestamp).toLocaleTimeString('en-US', { 
          hour: '2-digit', 
          minute: '2-digit' 
        }),
        timestamp,
        delays: Math.round(avgDelay),
        speed: Math.round(avgSpeed * 3.6), // Convert to km/h
        throughput: Math.round(throughput),
        onTime: Math.round(onTime)
      })
    }

    return data
  }, [timeRange, performanceMetrics?.lastUpdate, performanceMetrics?.averageDelay, performanceMetrics?.averageSpeed, performanceMetrics?.throughput])

  // Performance radar data - updates based on performance metrics
  const radarData = useMemo(() => {
    const baseValues = {
      onTime: 75,
      speedEfficiency: 60,
      throughput: 50,
      delayReduction: 70,
      safetyScore: 80
    }

    // Apply performance metrics changes if available
    if (performanceMetrics?.lastUpdate) {
      return [
        { 
          metric: 'On-Time Performance', 
          value: Math.min(Math.max(baseValues.onTime + (performanceMetrics.onTimePerformance - 75), 40), 100), 
          fullMark: 100 
        },
        { 
          metric: 'Speed Efficiency', 
          value: Math.min(Math.max(baseValues.speedEfficiency + (performanceMetrics.averageSpeed - 50) * 0.5, 30), 100), 
          fullMark: 100 
        },
        { 
          metric: 'Throughput', 
          value: Math.min(Math.max(baseValues.throughput + (performanceMetrics.throughput - 8) * 2, 20), 100), 
          fullMark: 100 
        },
        { 
          metric: 'Delay Reduction', 
          value: Math.min(Math.max(baseValues.delayReduction - (performanceMetrics.averageDelay - 120) * 0.1, 30), 100), 
          fullMark: 100 
        },
        { 
          metric: 'Safety Score', 
          value: Math.min(Math.max(baseValues.safetyScore - (performanceMetrics.criticalAlerts || 0) * 5, 40), 100), 
          fullMark: 100 
        }
      ]
    }

    // Return base values when no performance metrics updates
    return [
      { metric: 'On-Time Performance', value: baseValues.onTime, fullMark: 100 },
      { metric: 'Speed Efficiency', value: baseValues.speedEfficiency, fullMark: 100 },
      { metric: 'Throughput', value: baseValues.throughput, fullMark: 100 },
      { metric: 'Delay Reduction', value: baseValues.delayReduction, fullMark: 100 },
      { metric: 'Safety Score', value: baseValues.safetyScore, fullMark: 100 }
    ]
  }, [performanceMetrics?.lastUpdate, performanceMetrics?.onTimePerformance, performanceMetrics?.averageSpeed, performanceMetrics?.throughput, performanceMetrics?.averageDelay, performanceMetrics?.criticalAlerts])

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'high': return 'text-red-500 bg-red-100'
      case 'medium': return 'text-yellow-500 bg-yellow-100'
      case 'low': return 'text-green-500 bg-green-100'
      default: return 'text-gray-500 bg-gray-100'
    }
  }

  return (
    <div className="space-y-6 pb-8">
      {/* Key Metrics Cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gradient-to-br from-blue-500/90 to-blue-600/90 rounded-2xl p-4 text-white relative border border-blue-400/30 shadow-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-blue-100 text-sm font-medium mb-1">Avg Delay</p>
              <p className="text-3xl font-bold font-display">{Math.round(metrics.averageDelay / 60)}m</p>
              {performanceMetrics?.lastUpdate > lastUpdate - 5000 && (
                <p className="text-xs text-green-300 animate-pulse font-medium">Updated!</p>
              )}
            </div>
            <div className="p-3 bg-blue-400/20 rounded-xl">
              <ClockIcon className="w-8 h-8 text-blue-200" />
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-green-500/90 to-green-600/90 rounded-2xl p-4 text-white relative border border-green-400/30 shadow-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-green-100 text-sm font-medium mb-1">Throughput</p>
              <p className="text-3xl font-bold font-display">{metrics.throughput}/h</p>
              {performanceMetrics?.lastUpdate > lastUpdate - 5000 && (
                <p className="text-xs text-green-300 animate-pulse font-medium">+{Math.round(performanceMetrics.throughput - metrics.throughput)}%</p>
              )}
            </div>
            <div className="p-3 bg-green-400/20 rounded-xl">
              <TruckIcon className="w-8 h-8 text-green-200" />
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-purple-500/90 to-purple-600/90 rounded-2xl p-4 text-white relative border border-purple-400/30 shadow-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-purple-100 text-sm font-medium mb-1">Avg Speed</p>
              <p className="text-3xl font-bold font-display">{metrics.averageSpeed} km/h</p>
              {performanceMetrics?.lastUpdate > lastUpdate - 5000 && (
                <p className="text-xs text-green-300 animate-pulse font-medium">+{Math.round(performanceMetrics.averageSpeed - metrics.averageSpeed)} km/h</p>
              )}
            </div>
            <div className="p-3 bg-purple-400/20 rounded-xl">
              <ArrowTrendingUpIcon className="w-8 h-8 text-purple-200" />
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-orange-500/90 to-orange-600/90 rounded-2xl p-4 text-white relative border border-orange-400/30 shadow-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-orange-100 text-sm font-medium mb-1">On-Time</p>
              <p className="text-3xl font-bold font-display">{metrics.onTimePerformance}%</p>
              {performanceMetrics?.lastUpdate > lastUpdate - 5000 && (
                <p className="text-xs text-green-300 animate-pulse font-medium">Improved!</p>
              )}
            </div>
            <div className="p-3 bg-orange-400/20 rounded-xl">
              <ChartBarIcon className="w-8 h-8 text-orange-200" />
            </div>
          </div>
        </div>
      </div>

      {/* Time Range Selector */}
      <div className="flex space-x-2 bg-slate-700/50 rounded-xl p-1">
        {['1h', '6h', '12h'].map((range) => (
          <button
            key={range}
            onClick={() => setTimeRange(range)}
            className={`px-4 py-2 rounded-lg font-medium transition-all ${
              timeRange === range
                ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg'
                : 'text-slate-300 hover:bg-slate-600/50 hover:text-white'
            }`}
          >
            {range}
          </button>
        ))}
      </div>

      {/* Performance Charts */}
      <div className="grid grid-cols-1 gap-4">
        {/* Delays Over Time */}
        <div className="bg-gradient-to-br from-slate-800/90 to-slate-900/90 rounded-2xl p-6 shadow-xl border border-slate-700/50">
          <div className="flex items-center space-x-3 mb-4">
            <div className="p-2 bg-red-500/20 rounded-lg">
              <ClockIcon className="w-5 h-5 text-red-400" />
            </div>
            <h3 className="text-lg font-bold text-white font-display">Delays Over Time</h3>
            {performanceMetrics?.lastUpdate > lastUpdate - 10000 && (
              <div className="ml-auto flex items-center space-x-2">
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                <span className="text-xs text-green-400 font-medium">Updated</span>
              </div>
            )}
          </div>
          <ResponsiveContainer width="100%" height={300} key={`delays-${performanceMetrics?.lastUpdate || 'initial'}`}>
            <AreaChart data={timeSeriesData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="time" stroke="#9ca3af" fontSize={12} />
              <YAxis stroke="#9ca3af" fontSize={12} />
              <Tooltip 
                formatter={(value) => [`${Math.round(value / 60)}m`, 'Delay']}
                labelStyle={{ color: '#f9fafb' }}
                contentStyle={{ 
                  backgroundColor: '#1f2937', 
                  border: '1px solid #374151', 
                  borderRadius: '8px',
                  color: '#f9fafb'
                }}
              />
              <Area 
                type="monotone" 
                dataKey="delays" 
                stroke="#EF4444" 
                fill="#EF4444" 
                fillOpacity={0.3}
                strokeWidth={3}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Speed vs Throughput */}
        <div className="bg-gradient-to-br from-slate-800/90 to-slate-900/90 rounded-2xl p-6 shadow-xl border border-slate-700/50">
          <div className="flex items-center space-x-3 mb-4">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <ArrowTrendingUpIcon className="w-5 h-5 text-blue-400" />
            </div>
            <h3 className="text-lg font-bold text-white font-display">Speed vs Throughput</h3>
            {performanceMetrics?.lastUpdate > lastUpdate - 10000 && (
              <div className="ml-auto flex items-center space-x-2">
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                <span className="text-xs text-green-400 font-medium">Updated</span>
              </div>
            )}
          </div>
          <ResponsiveContainer width="100%" height={300} key={`speed-throughput-${performanceMetrics?.lastUpdate || 'initial'}`}>
            <LineChart data={timeSeriesData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="time" stroke="#9ca3af" fontSize={12} />
              <YAxis yAxisId="left" stroke="#9ca3af" fontSize={12} />
              <YAxis yAxisId="right" orientation="right" stroke="#9ca3af" fontSize={12} />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#1f2937', 
                  border: '1px solid #374151', 
                  borderRadius: '8px',
                  color: '#f9fafb'
                }}
              />
              <Legend />
              <Line 
                yAxisId="left"
                type="monotone" 
                dataKey="speed" 
                stroke="#3B82F6" 
                strokeWidth={3}
                name="Speed (km/h)"
              />
              <Line 
                yAxisId="right"
                type="monotone" 
                dataKey="throughput" 
                stroke="#10B981" 
                strokeWidth={3}
                name="Throughput"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Performance Radar */}
      <div className="bg-gradient-to-br from-slate-800/90 to-slate-900/90 rounded-2xl p-6 shadow-xl border border-slate-700/50">
        <div className="flex items-center space-x-3 mb-4">
          <div className="p-2 bg-purple-500/20 rounded-lg">
            <ChartBarIcon className="w-5 h-5 text-purple-400" />
          </div>
          <h3 className="text-lg font-bold text-white font-display">Performance Overview</h3>
          {performanceMetrics?.lastUpdate > lastUpdate - 10000 && (
            <div className="ml-auto flex items-center space-x-2">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
              <span className="text-xs text-green-400 font-medium">Updated</span>
            </div>
          )}
        </div>
        <ResponsiveContainer width="100%" height={300} key={`radar-${performanceMetrics?.lastUpdate || 'initial'}`}>
          <RadarChart data={radarData}>
            <PolarGrid stroke="#374151" />
            <PolarAngleAxis dataKey="metric" stroke="#9ca3af" fontSize={12} />
            <PolarRadiusAxis angle={90} domain={[0, 100]} stroke="#9ca3af" fontSize={12} />
            <Radar
              name="Performance"
              dataKey="value"
              stroke="#8B5CF6"
              fill="#8B5CF6"
              fillOpacity={0.3}
              strokeWidth={3}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      {/* Station Bottlenecks */}
      <div className="bg-gradient-to-br from-slate-800/90 to-slate-900/90 rounded-2xl p-6 shadow-xl border border-slate-700/50">
        <div className="flex items-center space-x-3 mb-4">
          <div className="p-2 bg-orange-500/20 rounded-lg">
            <ExclamationTriangleIcon className="w-5 h-5 text-orange-400" />
          </div>
          <h3 className="text-lg font-bold text-white font-display">Station Performance</h3>
        </div>
        <div className="space-y-3">
          {metrics.stationBottlenecks.map((bottleneck, index) => (
            <div key={index} className="flex items-center justify-between p-4 bg-slate-700/50 rounded-xl border border-slate-600/30">
              <div className="flex items-center space-x-3">
                <div className={`w-3 h-3 rounded-full ${
                  bottleneck.severity === 'high' ? 'bg-red-500' :
                  bottleneck.severity === 'medium' ? 'bg-yellow-500' : 'bg-green-500'
                }`} />
                <div>
                  <p className="font-medium text-white">{bottleneck.station}</p>
                  <p className="text-sm text-slate-400">{bottleneck.trainCount} trains</p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-bold text-white text-lg">{Math.round(bottleneck.averageDelay / 60)}m</p>
                <p className="text-sm text-slate-400">avg delay</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
