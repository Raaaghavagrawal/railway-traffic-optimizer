import React from "react";
import { Header } from "./components/Header";
import { HeroSection } from "./components/HeroSection";
import { FeaturesSection } from "./components/FeaturesSection";
import { StatsSection } from "./components/StatsSection";
import { CTASection } from "./components/CTASection";
import { Footer } from "./components/Footer";

export default function App({ onOpenSimulation }: { onOpenSimulation: () => void }) {
  return (
    <div className="min-h-screen bg-white">
      <Header onOpenSimulation={onOpenSimulation} />
      <main className="mt-0">
        <HeroSection onOpenSimulation={onOpenSimulation} />
        <FeaturesSection />
        <StatsSection />
        <CTASection />
      </main>
      <Footer />
    </div>
  );
}