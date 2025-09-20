import { 
  Brain, 
  Clock, 
  Shield, 
  TrendingUp, 
  Zap, 
  Map,
  AlertTriangle,
  BarChart3 
} from "lucide-react";
import { Card, CardContent } from "./ui/card";

const features = [
  {
    icon: Brain,
    title: "AI-Powered Optimization",
    description: "Advanced machine learning algorithms analyze traffic patterns and predict optimal routing solutions in real-time."
  },
  {
    icon: Clock,
    title: "Real-Time Monitoring",
    description: "24/7 continuous monitoring of your entire rail network with instant alerts and automated responses to disruptions."
  },
  {
    icon: Shield,
    title: "Enhanced Safety",
    description: "Proactive safety measures with collision avoidance, signal optimization, and emergency response protocols."
  },
  {
    icon: TrendingUp,
    title: "Capacity Optimization",
    description: "Maximize network utilization by dynamically adjusting schedules and routes based on demand patterns."
  },
  {
    icon: Zap,
    title: "Instant Response",
    description: "Automated incident detection and response system reduces delays and minimizes passenger disruption."
  },
  {
    icon: Map,
    title: "Route Planning",
    description: "Intelligent route optimization considers weather, maintenance schedules, and traffic congestion."
  },
  {
    icon: AlertTriangle,
    title: "Predictive Maintenance",
    description: "Anticipate equipment failures and schedule maintenance to prevent costly breakdowns and delays."
  },
  {
    icon: BarChart3,
    title: "Advanced Analytics",
    description: "Comprehensive dashboards and reports provide insights into performance metrics and optimization opportunities."
  }
];

export function FeaturesSection() {
  return (
    <section id="features" className="py-12 bg-white">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl mb-4 text-slate-900">
            Powerful Features for Modern Railways
          </h2>
          <p className="text-lg text-slate-600 max-w-2xl mx-auto">
            Our comprehensive suite of tools helps railway operators optimize traffic flow, 
            reduce delays, and improve overall network efficiency.
          </p>
        </div>
        
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((feature, index) => (
            <Card key={index} className="group hover:shadow-lg transition-all duration-300 border border-slate-200 hover:border-blue-200">
              <CardContent className="p-6">
                <div className="mb-4">
                  <feature.icon className="h-12 w-12 text-blue-600 group-hover:text-blue-700 transition-colors" />
                </div>
                <h3 className="mb-3 text-slate-900">
                  {feature.title}
                </h3>
                <p className="text-slate-600 text-sm leading-relaxed">
                  {feature.description}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}