"use client";

import { Box, Zap, Bot, Download, Settings, Github } from "lucide-react";

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
  return (
    <section className="px-6 py-20 overflow-hidden">
      <div className="mx-auto max-w-5xl">
        <h2 className="text-2xl font-bold text-center mb-12">Features</h2>
        
        <div className="relative">
          <div className="flex animate-marquee gap-4">
            {[...features, ...features].map((feature, index) => (
              <div
                key={index}
                className="flex-shrink-0 w-[280px] sm:w-[320px]"
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
        </div>
      </div>
    </section>
  );
}
