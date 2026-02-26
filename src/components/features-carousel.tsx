"use client";

import { useState, useRef } from "react";
import { Box, Zap, Bot, Download, Settings, Github, ChevronLeft, ChevronRight } from "lucide-react";

const features = [
  {
    icon: Zap,
    title: "Parametric Design",
    description: "Variables and parameters that update your model instantly",
  },
  {
    icon: Bot,
    title: "AI Generation",
    description: "Natural language to CAD code in seconds",
  },
  {
    icon: Box,
    title: "JSCAD Compatible",
    description: "Full access to JSCAD modeling primitives and operations",
  },
  {
    icon: Settings,
    title: "Animation Support",
    description: "Build moving mechanisms with phase-aware diagnostics",
  },
  {
    icon: Download,
    title: "Export Ready",
    description: "STL, OBJ, and STEP formats for manufacturing",
  },
  {
    icon: Github,
    title: "Open Source",
    description: "Free and open, built with Next.js and JSCAD",
  },
];

export default function FeaturesCarousel() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const itemsPerView = 3;
  const maxIndex = Math.max(0, features.length - itemsPerView);

  const scroll = (direction: "left" | "right") => {
    if (direction === "left") {
      setCurrentIndex((prev) => Math.max(0, prev - 1));
    } else {
      setCurrentIndex((prev) => Math.min(maxIndex, prev + 1));
    }
  };

  return (
    <section className="px-6 py-20">
      <div className="mx-auto max-w-5xl">
        <h2 className="text-2xl font-bold text-center mb-12">Features</h2>
        
        <div className="relative">
          <div
            ref={scrollRef}
            className="flex gap-4 overflow-x-auto scrollbar-hide pb-4 snap-x snap-mandatory"
            style={{ scrollBehavior: "smooth" }}
          >
            {features.map((feature, index) => (
              <div
                key={index}
                className="flex-shrink-0 w-[280px] sm:w-[320px] snap-center"
              >
                <div className="rounded-xl border border-border bg-card p-6 h-full">
                  <feature.icon className="h-6 w-6 text-primary mb-3" />
                  <h3 className="font-semibold mb-2">{feature.title}</h3>
                  <p className="text-sm text-muted-foreground">
                    {feature.description}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={() => scroll("left")}
            disabled={currentIndex === 0}
            className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-4 bg-background border border-border rounded-full p-2 shadow-md disabled:opacity-30 disabled:cursor-not-allowed hover:bg-secondary transition-colors"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          
          <button
            onClick={() => scroll("right")}
            disabled={currentIndex === maxIndex}
            className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-4 bg-background border border-border rounded-full p-2 shadow-md disabled:opacity-30 disabled:cursor-not-allowed hover:bg-secondary transition-colors"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        <div className="flex justify-center gap-2 mt-6">
          {Array.from({ length: maxIndex + 1 }).map((_, index) => (
            <button
              key={index}
              onClick={() => setCurrentIndex(index)}
              className={`w-2 h-2 rounded-full transition-colors ${
                index === currentIndex ? "bg-primary" : "bg-border"
              }`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
