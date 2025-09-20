import { ImageWithFallback } from "./figma/ImageWithFallback";

const stats = [
  {
    value: "35%",
    label: "Average Delay Reduction",
    description: "Significant improvement in on-time performance"
  },
  {
    value: "99.8%",
    label: "System Uptime",
    description: "Reliable 24/7 monitoring and optimization"
  },
  {
    value: "28%",
    label: "Capacity Increase",
    description: "More trains, same infrastructure"
  },
  {
    value: "45%",
    label: "Faster Issue Resolution",
    description: "Automated detection and response"
  }
];

export function StatsSection() {
  return (
    <section className="py-12 bg-slate-50">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <div className="relative">
              <ImageWithFallback
                src="https://images.unsplash.com/photo-1593225602101-a6220830c8d3?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx0cmFpbiUyMGNvbnRyb2wlMjByb29tJTIwdGVjaG5vbG9neXxlbnwxfHx8fDE3NTgyMTYzMDN8MA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral"
                alt="Railway control room with advanced monitoring systems"
                className="rounded-2xl shadow-xl w-full h-[400px] object-cover"
              />
              <div className="absolute top-4 right-4 bg-white/90 backdrop-blur-sm p-3 rounded-lg">
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                  <span className="text-xs font-medium">System Active</span>
                </div>
              </div>
            </div>
          </div>
          
          <div>
            <h2 className="text-3xl sm:text-4xl mb-6 text-slate-900">
              Proven Results Across Railway Networks
            </h2>
            <p className="text-lg text-slate-600 mb-12 leading-relaxed">
              Our railway traffic optimization system has delivered measurable improvements 
              for operators worldwide, reducing costs and improving passenger satisfaction.
            </p>
            
            <div className="grid sm:grid-cols-2 gap-8">
              {stats.map((stat, index) => (
                <div key={index} className="text-center sm:text-left">
                  <div className="text-4xl text-blue-600 mb-2">
                    {stat.value}
                  </div>
                  <div className="text-slate-900 mb-1">
                    {stat.label}
                  </div>
                  <p className="text-sm text-slate-600">
                    {stat.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}