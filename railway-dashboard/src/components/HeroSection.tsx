import { Button } from "./ui/button";
import { ArrowRight, Play, MapPin } from "lucide-react";
import { ImageWithFallback } from "./figma/ImageWithFallback";

export function HeroSection({ onOpenSimulation }: { onOpenSimulation: () => void }) {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-slate-50 to-blue-50 pt-8 pb-16 sm:pt-12 sm:pb-20">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div className="max-w-2xl">
            <h1 className="text-4xl sm:text-5xl lg:text-6xl tracking-tight text-slate-900 mb-6">
              Optimize Railway Traffic with 
              <span className="text-blue-600"> AI-Powered</span> Intelligence
            </h1>
            <p className="text-lg text-slate-600 mb-8 leading-relaxed">
              Reduce delays, increase capacity, and improve safety with our advanced railway traffic optimization system. 
              Real-time analytics and predictive algorithms ensure your rail network operates at peak efficiency.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 mb-8">
              <Button 
                size="lg" 
                className="group bg-blue-600 hover:bg-blue-700 text-white"
                onClick={onOpenSimulation}
              >
                <MapPin className="mr-2 h-4 w-4" />
                Open Map Simulation
                <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Button>
            </div>
            <div className="mt-4 flex items-center space-x-6 text-sm text-slate-500">
              <div className="flex items-center">
                <span className="block w-2 h-2 bg-green-500 rounded-full mr-2"></span>
                No setup required
              </div>
              <div className="flex items-center">
                <span className="block w-2 h-2 bg-green-500 rounded-full mr-2"></span>
                24/7 monitoring
              </div>
              <div className="flex items-center">
                <span className="block w-2 h-2 bg-green-500 rounded-full mr-2"></span>
                Real-time updates
              </div>
            </div>
          </div>
          <div className="lg:pl-8">
            <div className="relative">
              <ImageWithFallback
                src="https://images.unsplash.com/photo-1645874197112-11a90125cf4f?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxtb2Rlcm4lMjB0cmFpbiUyMHJhaWx3YXklMjBzdGF0aW9ufGVufDF8fHx8MTc1ODA5MDQ1M3ww&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral"
                alt="Modern railway station with advanced infrastructure"
                className="rounded-2xl shadow-2xl w-full h-[500px] object-cover"
              />
              <div className="absolute -bottom-4 -left-4 bg-white p-6 rounded-xl shadow-lg border">
                <div className="flex items-center space-x-3">
                  <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                  <span className="text-sm font-medium">Live Traffic Monitoring</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  287 trains tracked • 99.8% uptime
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}