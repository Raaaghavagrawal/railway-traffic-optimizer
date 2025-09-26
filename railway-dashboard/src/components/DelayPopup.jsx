import { useState, useEffect } from 'react'
import { 
  ExclamationTriangleIcon, 
  ClockIcon, 
  LightBulbIcon,
  XMarkIcon,
  CheckCircleIcon,
  ArrowPathIcon
} from '@heroicons/react/24/outline'

export default function DelayPopup({ 
  delayPrediction, 
  train, 
  suggestions, 
  onClose, 
  onApplySuggestion 
}) {
  const [isVisible, setIsVisible] = useState(false)
  const [appliedSuggestions, setAppliedSuggestions] = useState(new Set())

  useEffect(() => {
    if (delayPrediction && delayPrediction.isDelayed) {
      setIsVisible(true)
      // Auto-hide after 20 seconds for faster cycling
      const timer = setTimeout(() => {
        setIsVisible(false)
        onClose?.()
      }, 20000)
      return () => clearTimeout(timer)
    }
  }, [delayPrediction?.delay, delayPrediction?.isDelayed, train?.train_id, onClose])

  const handleClose = () => {
    setIsVisible(false)
    onClose?.()
  }

  if (!isVisible || !delayPrediction) {
    return null
  }

  const { delay, confidence, severity } = delayPrediction
  const delayMinutes = Math.round(delay / 60)
  const delaySeconds = delay % 60

  const getSeverityConfig = (severity) => {
    switch (severity) {
      case 'critical':
        return {
          bgColor: 'bg-slate-800',
          borderColor: 'border-red-400',
          textColor: 'text-red-100',
          iconColor: 'text-red-300',
          shadowColor: 'shadow-red-500/50'
        }
      case 'high':
        return {
          bgColor: 'bg-slate-800',
          borderColor: 'border-orange-400',
          textColor: 'text-orange-100',
          iconColor: 'text-orange-300',
          shadowColor: 'shadow-orange-500/50'
        }
      case 'medium':
        return {
          bgColor: 'bg-slate-800',
          borderColor: 'border-yellow-400',
          textColor: 'text-yellow-100',
          iconColor: 'text-yellow-300',
          shadowColor: 'shadow-yellow-500/50'
        }
      default:
        return {
          bgColor: 'bg-slate-800',
          borderColor: 'border-blue-400',
          textColor: 'text-blue-100',
          iconColor: 'text-blue-300',
          shadowColor: 'shadow-blue-500/50'
        }
    }
  }

  const severityConfig = getSeverityConfig(severity)

  const handleApplySuggestion = (suggestion) => {
    setAppliedSuggestions(prev => new Set([...prev, suggestion.type]))
    onApplySuggestion?.(suggestion, train)
    setTimeout(() => {
      setIsVisible(false)
      onClose?.()
    }, 2000) // 2 second delay to show the "Applied" state
  }

  return (
    <div className="fixed inset-0 z-[9997] flex items-center justify-center p-4 overflow-hidden" style={{ 
      top: 0, 
      left: 0, 
      right: 0, 
      bottom: 0,
      position: 'fixed'
    }}>
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={handleClose}
      />
      
      {/* Popup Content - Constrained to viewport */}
      <div className={`relative bg-slate-800 ${severityConfig.borderColor} border-2 rounded-2xl p-4 sm:p-6 max-w-sm w-full max-h-[85vh] overflow-y-auto shadow-2xl ${severityConfig.shadowColor} animate-popup-enter`} style={{
        maxWidth: 'min(400px, 90vw)',
        maxHeight: 'min(600px, 85vh)',
        margin: 'auto'
      }}>
        {/* Close Button */}
        <button
          onClick={handleClose}
          className="absolute top-3 right-3 text-white/70 hover:text-white hover:bg-white/20 rounded-full p-1 transition-all duration-200"
        >
          <XMarkIcon className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="flex items-start space-x-3 mb-4">
          <div className="flex-shrink-0">
            <div className={`w-10 h-10 ${severityConfig.bgColor} rounded-full flex items-center justify-center animate-pulse`}>
              <ExclamationTriangleIcon className={`w-6 h-6 ${severityConfig.iconColor}`} />
            </div>
          </div>
          <div className="flex-1">
            <div className="flex items-center space-x-2 mb-1">
              <div className={`w-2 h-2 ${severityConfig.bgColor} rounded-full animate-pulse`} />
              <span className={`text-sm font-bold ${severityConfig.textColor} uppercase tracking-wide`}>
                {severity.toUpperCase()} DELAY ALERT
              </span>
            </div>
            <h3 className={`text-lg font-bold ${severityConfig.textColor}`}>
              Train {train?.train_id} Delayed
            </h3>
            <div className={`text-xs ${severityConfig.textColor} opacity-75`}>
              Alert #{Math.floor(Math.random() * 100) + 1} • Station: {train?.current_station} • Auto-dismiss in 20s
            </div>
          </div>
        </div>

        {/* Delay Information */}
        <div className="bg-slate-700 rounded-xl p-4 mb-4 border border-white/10">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <ClockIcon className={`w-5 h-5 ${severityConfig.iconColor}`} />
              <span className={`font-semibold ${severityConfig.textColor}`}>
                Delay: {delayMinutes}m {delaySeconds}s
              </span>
            </div>
            <div className={`text-sm ${severityConfig.textColor} bg-white/20 rounded-lg px-2 py-1`}>
              {confidence}% confidence
            </div>
          </div>
          
          {train?.current_station && (
            <div className={`text-sm ${severityConfig.textColor} mt-2`}>
              Current Station: {train.current_station}
            </div>
          )}
        </div>

        {/* AI Suggestions */}
        {suggestions && suggestions.length > 0 && (
          <div className="space-y-2 max-h-40 overflow-y-auto">
            <div className="flex items-center space-x-2 mb-2">
              <LightBulbIcon className={`w-4 h-4 ${severityConfig.iconColor}`} />
              <h4 className={`text-sm font-semibold ${severityConfig.textColor}`}>
                AI Suggestions
              </h4>
            </div>
            
            {suggestions.map((suggestion, index) => (
              <div 
                key={index}
                className="bg-slate-700 rounded-lg p-2 border border-white/20"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h5 className={`text-sm font-medium ${severityConfig.textColor} mb-1 truncate`}>
                      {suggestion.title}
                    </h5>
                    <p className={`text-xs ${severityConfig.textColor} mb-2 line-clamp-2`}>
                      {suggestion.description}
                    </p>
                    <div className="flex items-center space-x-1 text-xs flex-wrap gap-1">
                      <span className={`${severityConfig.textColor} bg-white/20 rounded px-1 py-0.5 text-xs`}>
                        {suggestion.impact}
                      </span>
                      <span className={`${severityConfig.textColor} bg-white/20 rounded px-1 py-0.5 text-xs`}>
                        {suggestion.effort}
                      </span>
                      <span className={`${severityConfig.textColor} bg-red-500/20 rounded px-1 py-0.5 text-xs`}>
                        Risk: {suggestion.collisionRisk || 'Low'}
                      </span>
                      <span className={`${severityConfig.textColor} bg-green-500/20 rounded px-1 py-0.5 text-xs`}>
                        +{suggestion.throughputImprovement || '5%'}
                      </span>
                    </div>
                  </div>
                  
                  <div className="ml-2 flex-shrink-0">
                    {appliedSuggestions.has(suggestion.type) ? (
                      <div className="text-green-300 bg-green-500/20 rounded px-2 py-1 text-xs font-medium flex items-center space-x-1">
                        <CheckCircleIcon className="w-3 h-3" />
                        <span>Applied</span>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleApplySuggestion(suggestion)}
                        className={`${severityConfig.textColor} hover:bg-white/20 rounded px-2 py-1 text-xs font-medium transition-all duration-200`}
                      >
                        Apply
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/20">
          <button
            onClick={handleClose}
            className={`${severityConfig.textColor} hover:bg-white/20 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200`}
          >
            Dismiss
          </button>
          <button
            onClick={() => {
              // Navigate to train details
              console.log('View train details:', train)
            }}
            className="bg-white/20 hover:bg-white/30 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200"
          >
            View Details
          </button>
        </div>
      </div>
    </div>
  )
}
