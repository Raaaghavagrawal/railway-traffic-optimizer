import { Button } from "./ui/button";
import { ArrowRight, CheckCircle } from "lucide-react";
import { ImageWithFallback } from "./figma/ImageWithFallback";

const benefits = [
  "30-day free trial with full feature access",
  "Dedicated implementation support",
  "Integration with existing systems",
  "24/7 technical support",
  "Custom training for your team"
];

export function CTASection() {
  return (
    <section className="py-12 bg-gradient-to-r from-blue-600 to-blue-800 text-white relative overflow-hidden">
      <div className="absolute inset-0 opacity-10">
        <ImageWithFallback
          src="https://images.unsplash.com/photo-1661323563584-b014835e6fa4?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxyYWlsd2F5JTIwdHJhY2tzJTIwaW5mcmFzdHJ1Y3R1cmV8ZW58MXx8fHwxNzU4MjE2MzAzfDA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral"
          alt="Railway infrastructure"
          className="w-full h-full object-cover"
        />
      </div>
      
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 relative">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl mb-6">
            Ready to Transform Your Railway Operations?
          </h2>
          <p className="text-xl text-blue-100 mb-12 max-w-2xl mx-auto">
            Join hundreds of railway operators who have already improved their efficiency, 
            reduced delays, and enhanced passenger satisfaction with NIYANTRAK ONE.
          </p>
          
          <div className="grid md:grid-cols-2 gap-12 items-center mb-12">
            <div className="space-y-4">
              {benefits.map((benefit, index) => (
                <div key={index} className="flex items-center space-x-3 text-left">
                  <CheckCircle className="h-5 w-5 text-green-400 flex-shrink-0" />
                  <span className="text-blue-100">{benefit}</span>
                </div>
              ))}
            </div>
            
            <div className="space-y-4">
              <p className="text-sm text-blue-200">
                Contact us for more information about our railway optimization solutions.
              </p>
            </div>
          </div>
          
          <div className="flex flex-wrap justify-center items-center gap-8 text-sm text-blue-200">
            <span>Trusted by 200+ railway operators</span>
            <span>•</span>
            <span>ISO 27001 Certified</span>
            <span>•</span>
            <span>99.9% SLA Guarantee</span>
          </div>
        </div>
      </div>
    </section>
  );
}