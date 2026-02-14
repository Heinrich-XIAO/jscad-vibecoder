"use client";

import { useRef, useEffect, useCallback, useState, forwardRef, useImperativeHandle } from "react";

export interface Viewport3DHandle {
  rotate: (dx: number, dy: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
}

interface Viewport3DProps {
  geometry: unknown[];
  isGenerating?: boolean;
  className?: string;
}

// Helper function to render geometry polygons as wireframe
function renderGeometry(
  ctx: CanvasRenderingContext2D,
  geom: unknown,
  project: (x: number, y: number, z: number) => { x: number; y: number }
) {
  // Try to extract polygons from JSCAD geometry
  const g = geom as Record<string, unknown>;

  // geom3 format: has polygons array
  if (g.polygons && Array.isArray(g.polygons)) {
    for (const polygon of g.polygons as Array<{ vertices: number[][] }>) {
      if (!polygon.vertices || polygon.vertices.length < 2) continue;

      ctx.beginPath();
      const first = project(
        polygon.vertices[0][0],
        polygon.vertices[0][1],
        polygon.vertices[0][2]
      );
      ctx.moveTo(first.x, first.y);

      for (let i = 1; i < polygon.vertices.length; i++) {
        const p = project(
          polygon.vertices[i][0],
          polygon.vertices[i][1],
          polygon.vertices[i][2]
        );
        ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }

  // geom2 format: has sides array
  if (g.sides && Array.isArray(g.sides)) {
    for (const side of g.sides as number[][][]) {
      if (side.length >= 2) {
        ctx.beginPath();
        const start = project(side[0][0], side[0][1], 0);
        const end = project(side[1][0], side[1][1], 0);
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
      }
    }
  }

  // If no recognized format, render a placeholder cube
  if (!g.polygons && !g.sides) {
    const size = 20;
    const vertices = [
      [-size, -size, -size],
      [size, -size, -size],
      [size, size, -size],
      [-size, size, -size],
      [-size, -size, size],
      [size, -size, size],
      [size, size, size],
      [-size, size, size],
    ];
    const edges = [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7],
    ];

    ctx.strokeStyle = "#818cf850";
    for (const [a, b] of edges) {
      const pa = project(vertices[a][0], vertices[a][1], vertices[a][2]);
      const pb = project(vertices[b][0], vertices[b][1], vertices[b][2]);
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }
  }
}

/**
 * 3D viewport that renders JSCAD geometries using a canvas.
 * Uses a simple wireframe renderer as a fallback since @jscad/regl-renderer
 * has complex setup requirements.
 */
export const Viewport3D = forwardRef<Viewport3DHandle, Viewport3DProps>(({ geometry, isGenerating, className = "" }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rotation, setRotation] = useState({ x: -30, y: 45 });
  const [isDragging, setIsDragging] = useState(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);

  useImperativeHandle(ref, () => ({
    rotate: (dx, dy) => {
      setRotation((r) => ({ x: r.x + dx, y: r.y + dy }));
    },
    zoomIn: () => setZoom((z) => Math.min(5, z * 1.2)),
    zoomOut: () => setZoom((z) => Math.max(0.1, z / 1.2)),
    reset: () => {
      setRotation({ x: -30, y: 45 });
      setZoom(1);
    },
  }));

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, w, h);

    // Grid
    const gridSize = 20 * zoom;
    const gridCount = 20;
    ctx.strokeStyle = "#2a2a3e";
    ctx.lineWidth = 0.5;

    const cx = w / 2;
    const cy = h / 2;

    for (let i = -gridCount; i <= gridCount; i++) {
      const offset = i * gridSize;
      ctx.beginPath();
      ctx.moveTo(cx + offset, 0);
      ctx.lineTo(cx + offset, h);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, cy + offset);
      ctx.lineTo(w, cy + offset);
      ctx.stroke();
    }

    // Axes
    const axisLen = 60 * zoom;
    const radX = (rotation.y * Math.PI) / 180;
    const radY = (rotation.x * Math.PI) / 180;

    // Simple 3D to 2D projection
    const project = (x: number, y: number, z: number) => {
      const cosX = Math.cos(radX);
      const sinX = Math.sin(radX);
      const cosY = Math.cos(radY);
      const sinY = Math.sin(radY);

      const rx = x * cosX - y * sinX;
      const ry = x * sinX * sinY + y * cosX * sinY + z * cosY;
      const rz = x * sinX * cosY + y * cosX * cosY - z * sinY;

      const scale = 200 / (200 + rz);
      return {
        x: cx + rx * scale * zoom,
        y: cy - ry * scale * zoom,
      };
    };

    // Draw X axis (red)
    const xEnd = project(axisLen, 0, 0);
    ctx.beginPath();
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 2;
    ctx.moveTo(cx, cy);
    ctx.lineTo(xEnd.x, xEnd.y);
    ctx.stroke();
    ctx.fillStyle = "#ef4444";
    ctx.font = "12px monospace";
    ctx.fillText("X", xEnd.x + 5, xEnd.y);

    // Draw Y axis (green)
    const yEnd = project(0, axisLen, 0);
    ctx.beginPath();
    ctx.strokeStyle = "#22c55e";
    ctx.moveTo(cx, cy);
    ctx.lineTo(yEnd.x, yEnd.y);
    ctx.stroke();
    ctx.fillStyle = "#22c55e";
    ctx.fillText("Y", yEnd.x + 5, yEnd.y);

    // Draw Z axis (blue)
    const zEnd = project(0, 0, axisLen);
    ctx.beginPath();
    ctx.strokeStyle = "#3b82f6";
    ctx.moveTo(cx, cy);
    ctx.lineTo(zEnd.x, zEnd.y);
    ctx.stroke();
    ctx.fillStyle = "#3b82f6";
    ctx.fillText("Z", zEnd.x + 5, zEnd.y);

    // Render geometries as wireframes
    if (geometry && geometry.length > 0 && !isGenerating) {
      ctx.strokeStyle = "#818cf8";
      ctx.lineWidth = 1;

      for (const geom of geometry) {
        renderGeometry(ctx, geom, project);
      }
    }

    // Status text
    ctx.fillStyle = "#6b7280";
    ctx.font = "11px monospace";
    const statusText = isGenerating 
      ? "Generating..." 
      : `${geometry?.length || 0} ${(geometry?.length || 0) === 1 ? "geometry" : "geometries"} | Drag to rotate | Scroll to zoom`;
    ctx.fillText(statusText, 10, h - 10);
  }, [geometry, isGenerating, rotation, zoom]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
      }
      // We need to store the CSS dimensions
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      render();
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    return () => observer.disconnect();
  }, [render]);

  useEffect(() => {
    render();
  }, [render]);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    lastPos.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    setRotation((r) => ({
      x: r.x + dy * 0.5,
      y: r.y + dx * 0.5,
    }));
    lastPos.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseUp = () => setIsDragging(false);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((z) => Math.max(0.1, Math.min(5, z - e.deltaY * 0.001)));
  };

  return (
    <canvas
      ref={canvasRef}
      className={`w-full h-full cursor-grab active:cursor-grabbing ${className}`}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
    />
  );
});

Viewport3D.displayName = "Viewport3D";
