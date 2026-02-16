"use client";

import { useState, useEffect } from "react";
import { Ruler, Triangle, AlertTriangle, CheckCircle, Info } from "lucide-react";
import { calculateMeasurements, analyzePrintability, type GeometryMeasurements, type PrintabilityReport } from "@/lib/geometry-analyzer";

interface GeometryInfoProps {
  geometry: unknown[];
  className?: string;
}

export function GeometryInfo({ geometry, className = "" }: GeometryInfoProps) {
  const [measurements, setMeasurements] = useState<GeometryMeasurements | null>(null);
  const [printability, setPrintability] = useState<PrintabilityReport | null>(null);
  const [activeTab, setActiveTab] = useState<"measurements" | "printability">("measurements");

  useEffect(() => {
    const analyze = async () => {
      if (geometry && geometry.length > 0) {
        const m = await calculateMeasurements(geometry);
        const p = await analyzePrintability(geometry);
        setMeasurements(m);
        setPrintability(p);
      } else {
        setMeasurements(null);
        setPrintability(null);
      }
    };
    analyze();
  }, [geometry]);

  if (!geometry || geometry.length === 0) {
    return (
      <div className={`p-4 bg-card rounded-lg border border-border ${className}`}>
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Info className="w-4 h-4" />
          <span>No geometry loaded</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-card rounded-lg border border-border ${className}`}>
      {/* Tabs */}
      <div className="flex border-b border-border">
        <button
          onClick={() => setActiveTab("measurements")}
          className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
            activeTab === "measurements"
              ? "text-primary border-b-2 border-primary"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Ruler className="w-4 h-4" />
          Measurements
        </button>
        <button
          onClick={() => setActiveTab("printability")}
          className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
            activeTab === "printability"
              ? "text-primary border-b-2 border-primary"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Triangle className="w-4 h-4" />
          Printability
          {printability && printability.warnings.length > 0 && (
            <span className="w-2 h-2 bg-amber-500 rounded-full" />
          )}
        </button>
      </div>

      {/* Content */}
      <div className="p-4">
        {activeTab === "measurements" && measurements && (
          <MeasurementsView measurements={measurements} />
        )}
        {activeTab === "printability" && printability && (
          <PrintabilityView report={printability} />
        )}
      </div>
    </div>
  );
}

function MeasurementsView({ measurements }: { measurements: GeometryMeasurements }) {
  const dims = measurements.boundingBox.dimensions;
  const center = measurements.boundingBox.center;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium text-secondary-foreground">Dimensions</h3>
      <div className="grid grid-cols-3 gap-3">
        <MeasurementBox label="Width" value={dims[0]} unit="mm" color="text-red-500" />
        <MeasurementBox label="Depth" value={dims[1]} unit="mm" color="text-green-500" />
        <MeasurementBox label="Height" value={dims[2]} unit="mm" color="text-blue-500" />
      </div>

      <div className="grid grid-cols-2 gap-3 pt-2">
        <div className="bg-muted rounded p-3">
          <div className="text-xs text-muted-foreground mb-1">Volume</div>
          <div className="text-lg font-mono text-foreground">
            {measurements.volume.toFixed(2)} <span className="text-sm text-muted-foreground">mm³</span>
          </div>
        </div>
        <div className="bg-muted rounded p-3">
          <div className="text-xs text-muted-foreground mb-1">Surface Area</div>
          <div className="text-lg font-mono text-foreground">
            {measurements.surfaceArea.toFixed(2)} <span className="text-sm text-muted-foreground">mm²</span>
          </div>
        </div>
      </div>

      <div className="bg-muted rounded p-3">
        <div className="text-xs text-muted-foreground mb-2">Center Position</div>
        <div className="font-mono text-sm text-secondary-foreground">
          X: {center[0].toFixed(2)}, Y: {center[1].toFixed(2)}, Z: {center[2].toFixed(2)} mm
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground pt-2">
        <span>Polygons: {measurements.triangleCount.toLocaleString()}</span>
        <span>Bounding Box: {measurements.boundingBox.min.map(v => v.toFixed(1)).join(", ")} → {measurements.boundingBox.max.map(v => v.toFixed(1)).join(", ")}</span>
      </div>
    </div>
  );
}

function MeasurementBox({ label, value, unit, color }: { label: string; value: number; unit: string; color: string }) {
  return (
    <div className="bg-muted rounded p-3 text-center">
      <div className={`text-lg font-mono ${color}`}>{value.toFixed(2)}</div>
      <div className="text-xs text-muted-foreground">{unit}</div>
      <div className="text-xs text-muted-foreground/60 mt-1">{label}</div>
    </div>
  );
}

function PrintabilityView({ report }: { report: PrintabilityReport }) {
  const hasIssues = report.warnings.length > 0;

  return (
    <div className="space-y-4">
      {/* Status Header */}
      <div className={`flex items-center gap-3 p-3 rounded-lg ${hasIssues ? "bg-amber-500/10 dark:bg-amber-950/30 border border-amber-500/30 dark:border-amber-900/30" : "bg-emerald-500/10 dark:bg-emerald-950/30 border border-emerald-500/30 dark:border-emerald-900/30"}`}>
        {hasIssues ? (
          <AlertTriangle className="w-5 h-5 text-amber-500" />
        ) : (
          <CheckCircle className="w-5 h-5 text-emerald-500" />
        )}
        <div>
          <div className={`font-medium ${hasIssues ? "text-amber-700 dark:text-amber-200" : "text-emerald-700 dark:text-emerald-200"}`}>
            {hasIssues ? "Printability Issues Found" : "Ready to Print"}
          </div>
          <div className="text-xs text-muted-foreground">
            {hasIssues ? `${report.warnings.length} warning${report.warnings.length !== 1 ? "s" : ""}` : "No issues detected"}
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3">
        <StatusIndicator 
          label="Manifold" 
          status={report.isManifold} 
          tooltip="Closed, watertight mesh without holes"
        />
        <StatusIndicator 
          label="Thin Walls" 
          status={!report.hasThinWalls} 
          tooltip={report.hasThinWalls ? `Minimum wall thickness: ${report.minWallThickness.toFixed(2)}mm` : "All walls meet minimum 0.8mm thickness"}
        />
        <StatusIndicator 
          label="Overhangs" 
          status={!report.hasOverhangs} 
          tooltip={report.hasOverhangs ? `Maximum overhang angle: ${report.maxOverhangAngle.toFixed(1)}°` : "No steep overhangs detected"}
        />
        <div className="bg-muted rounded p-2">
          <div className="text-xs text-muted-foreground">Min Wall</div>
          <div className={`text-sm font-mono ${report.minWallThickness < 0.8 ? "text-amber-500" : "text-emerald-500"}`}>
            {report.minWallThickness.toFixed(2)} mm
          </div>
        </div>
      </div>

      {/* Warnings */}
      {report.warnings.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-secondary-foreground flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            Warnings
          </h4>
          <ul className="space-y-1">
            {report.warnings.map((warning, i) => (
              <li key={i} className="text-xs text-amber-700 dark:text-amber-200/80 bg-amber-500/10 dark:bg-amber-950/20 p-2 rounded">
                {warning}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Recommendations */}
      {report.recommendations.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-secondary-foreground">Recommendations</h4>
          <ul className="space-y-1">
            {report.recommendations.map((rec, i) => (
              <li key={i} className="text-xs text-muted-foreground flex items-start gap-2">
                <span className="text-emerald-500 mt-0.5">•</span>
                {rec}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function StatusIndicator({ label, status, tooltip }: { label: string; status: boolean; tooltip: string }) {
  return (
    <div className="bg-muted rounded p-2" title={tooltip}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-sm font-medium ${status ? "text-emerald-500" : "text-amber-500"}`}>
        {status ? "✓ Pass" : "⚠ Warning"}
      </div>
    </div>
  );
}
