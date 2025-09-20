import { Button } from "./ui/button";
import { Menu, Train } from "lucide-react";

export function Header({ onOpenSimulation }: { onOpenSimulation: () => void }) {
  return (
    <header className="border-b bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/60 sticky top-0 z-50">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center space-x-2">
            <Train className="h-8 w-8 text-primary" />
            <span className="font-semibold text-xl">Niyantrak One</span>
          </div>
          
          <div className="flex items-center space-x-4">
            <nav className="hidden md:flex items-center space-x-8">
              <a href="#features" className="text-muted-foreground hover:text-foreground transition-colors">
                Features
              </a>
              <button 
                onClick={onOpenSimulation}
                className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                Solutions
              </button>
              <a href="#about" className="text-muted-foreground hover:text-foreground transition-colors">
                About
              </a>
              <a href="#contact" className="text-muted-foreground hover:text-foreground transition-colors">
                Contact
              </a>
            </nav>
            <Button variant="ghost" size="icon" className="md:hidden">
              <Menu className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}