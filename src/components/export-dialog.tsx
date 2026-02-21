"use client";

import { useState } from "react";
import {
  Download,
  FileBox,
  Loader2,
  X,
} from "lucide-react";
import { ThumbnailPreview } from "./thumbnail-preview";
import { polygonVertices } from "@/lib/jscad-geometry";

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  geometry: unknown[];
  projectName: string;
}

// Simple OBJ serializer for JSCAD geometries
function serializeOBJ(geometries: unknown[]): string {
  const vertices: number[][] = [];
  const faces: number[][] = [];
  let vertexOffset = 1;

  for (const geom of geometries) {
    const g = geom as Record<string, unknown>;
    
    if (g.polygons && Array.isArray(g.polygons)) {
      for (const polygon of g.polygons as Array<Record<string, unknown>>) {
        const polygonVerts = polygonVertices(polygon);
        if (polygonVerts.length < 3) continue;

        const faceIndices: number[] = [];
        for (const vertex of polygonVerts) {
          vertices.push([vertex[0], vertex[1], vertex[2]]);
          faceIndices.push(vertexOffset++);
        }
        faces.push(faceIndices);
      }
    }
  }

  let obj = "# OpenMech OBJ Export\n";
  obj += "# Vertices\n";
  
  for (const v of vertices) {
    obj += `v ${v[0].toFixed(6)} ${v[1].toFixed(6)} ${v[2].toFixed(6)}\n`;
  }

  obj += "\n# Faces\n";
  for (const f of faces) {
    obj += `f ${f.join(" ")}\n`;
  }

  return obj;
}

export function ExportDialog({
  isOpen,
  onClose,
  geometry,
  projectName,
}: ExportDialogProps) {
  const [format, setFormat] = useState<"stl" | "obj">("stl");
  const [isExporting, setIsExporting] = useState(false);

  if (!isOpen) return null;

  const handleExport = async () => {
    setIsExporting(true);
    try {
      if (!geometry || geometry.length === 0) {
        throw new Error("No geometry to export");
      }

      let blob: Blob;
      const filename = `${projectName.toLowerCase().replace(/\s+/g, "-")}.${format}`;

      if (format === "stl") {
        // Dynamically import JSCAD STL serializer
        const { serialize } = await import("@jscad/stl-serializer");
        const result = serialize({ binary: true }, ...geometry);
        blob = new Blob([result.data as BlobPart], { type: "application/octet-stream" });
      } else {
        // OBJ export
        const objContent = serializeOBJ(geometry);
        blob = new Blob([objContent], { type: "text/plain" });
      }

      // Download
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      onClose();
    } catch (error) {
      alert(
        `Export failed: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card border border-border rounded-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <FileBox className="w-5 h-5 text-indigo-500" />
            <h2 className="text-lg font-semibold text-foreground">Export Model</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-secondary rounded-md transition-colors"
          >
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        {/* Preview */}
        <div className="mb-6">
          <label className="text-sm font-medium text-muted-foreground mb-2 block">
            Preview
          </label>
          <ThumbnailPreview 
            geometry={geometry} 
            className="w-full h-48 border border-border rounded-lg"
          />
        </div>

        {/* Format selection */}
        <div className="mb-6">
          <label className="text-sm font-medium text-muted-foreground mb-2 block">
            Format
          </label>
          <div className="grid grid-cols-2 gap-2">
            {(["stl", "obj"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFormat(f)}
                className={`px-4 py-3 rounded-lg border text-sm font-medium transition-colors ${
                  format === f
                    ? "bg-primary/10 border-primary text-primary"
                    : "bg-secondary border-border text-muted-foreground hover:border-muted-foreground"
                }`}
              >
                .{f.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Export button */}
        <button
          onClick={handleExport}
          disabled={isExporting}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isExporting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Exporting...
            </>
          ) : (
            <>
              <Download className="w-4 h-4" />
              Export as .{format.toUpperCase()}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
