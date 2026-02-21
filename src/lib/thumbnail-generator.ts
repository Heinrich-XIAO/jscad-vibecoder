import { polygonVertices, Vec3 } from "@/lib/jscad-geometry"

/**
 * Generate a thumbnail preview from JSCAD geometry
 * Uses a canvas to render a simplified isometric view
 */

export async function generateThumbnail(
  geometry: unknown[],
  width: number = 200,
  height: number = 200
): Promise<string | null> {
  if (!geometry || geometry.length === 0) return null;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // Clear with transparent background
  ctx.clearRect(0, 0, width, height);

  // Background gradient
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#1a1a2e");
  gradient.addColorStop(1, "#16213e");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // Isometric projection settings
  const cx = width / 2;
  const cy = height / 2;
  const scale = Math.min(width, height) / 100;

  // Rotation angles for isometric view
  const rotX = -30 * (Math.PI / 180);
  const rotY = 45 * (Math.PI / 180);

  // Project 3D point to 2D
  const project = (x: number, y: number, z: number) => {
    // Rotate around Y
    const x1 = x * Math.cos(rotY) - z * Math.sin(rotY);
    const z1 = x * Math.sin(rotY) + z * Math.cos(rotY);

    // Rotate around X
    const y2 = y * Math.cos(rotX) - z1 * Math.sin(rotX);
    const z2 = y * Math.sin(rotX) + z1 * Math.cos(rotX);

    // Perspective projection
    const perspective = 300 / (300 + z2);
    return {
      x: cx + x1 * scale * perspective,
      y: cy - y2 * scale * perspective,
    };
  };

  // Calculate bounding box to center the model
  let minX = Infinity,
    maxX = -Infinity;
  let minY = Infinity,
    maxY = -Infinity;
  let minZ = Infinity,
    maxZ = -Infinity;

  for (const geom of geometry) {
    const g = geom as Record<string, unknown>;
    if (g.polygons && Array.isArray(g.polygons)) {
      for (const polygon of g.polygons as Array<Record<string, unknown>>) {
        const vertices = polygonVertices(polygon);
        if (!vertices.length) continue;
        for (const v of vertices) {
          minX = Math.min(minX, v[0]);
          maxX = Math.max(maxX, v[0]);
          minY = Math.min(minY, v[1]);
          maxY = Math.max(maxY, v[1]);
          minZ = Math.min(minZ, v[2]);
          maxZ = Math.max(maxZ, v[2]);
        }
      }
    }
  }

  // Center the model
  const offsetX = (minX + maxX) / 2;
  const offsetY = (minY + maxY) / 2;
  const offsetZ = (minZ + maxZ) / 2;

  // Auto-scale based on model size
  const size = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  const autoScale = (Math.min(width, height) * 0.4) / size;

  // Draw geometry
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";

  for (const geom of geometry) {
    const g = geom as Record<string, unknown>;

    if (g.polygons && Array.isArray(g.polygons)) {
      const polygonsWithDepth = (g.polygons as Array<Record<string, unknown>>)
        .map((polygon) => {
          const vertices = polygonVertices(polygon);
          if (vertices.length < 3) return null;

          const centroid = vertices.reduce(
            (acc, v) => [acc[0] + v[0], acc[1] + v[1], acc[2] + v[2]],
            [0, 0, 0]
          );
          centroid[0] /= vertices.length;
          centroid[1] /= vertices.length;
          centroid[2] /= vertices.length;

          const projected = project(
            (centroid[0] - offsetX) * autoScale,
            (centroid[1] - offsetY) * autoScale,
            (centroid[2] - offsetZ) * autoScale
          );

          return { vertices, depth: projected.y };
        })
        .filter(
          (entry): entry is { vertices: Vec3[]; depth: number } => Boolean(entry)
        );

      // Sort by depth (back to front)
      polygonsWithDepth.sort((a, b) => b.depth - a.depth);

      // Draw each polygon
      for (const { vertices } of polygonsWithDepth) {
        ctx.beginPath();

        // Calculate face normal for lighting
        const v0 = vertices[0];
        const v1 = vertices[1];
        const v2 = vertices[2];

        const normal = [
          (v1[1] - v0[1]) * (v2[2] - v0[2]) - (v1[2] - v0[2]) * (v2[1] - v0[1]),
          (v1[2] - v0[2]) * (v2[0] - v0[0]) - (v1[0] - v0[0]) * (v2[2] - v0[2]),
          (v1[0] - v0[0]) * (v2[1] - v0[1]) - (v1[1] - v0[1]) * (v2[0] - v0[0]),
        ];

        // Normalize
        const normalLen = Math.sqrt(normal[0] ** 2 + normal[1] ** 2 + normal[2] ** 2);
        if (normalLen > 0) {
          normal[0] /= normalLen;
          normal[1] /= normalLen;
          normal[2] /= normalLen;
        }

        // Light direction (from top-left)
        const lightDir = [-0.5, -0.5, -1];
        const lightLen = Math.sqrt(lightDir[0] ** 2 + lightDir[1] ** 2 + lightDir[2] ** 2);
        lightDir[0] /= lightLen;
        lightDir[1] /= lightLen;
        lightDir[2] /= lightLen;

        // Calculate lighting
        const dot = normal[0] * lightDir[0] + normal[1] * lightDir[1] + normal[2] * lightDir[2];
        const brightness = Math.max(0.3, Math.min(1, 0.7 + dot * 0.3));

        // Color based on lighting
        const r = Math.floor(100 + brightness * 100);
        const g = Math.floor(150 + brightness * 80);
        const b = Math.floor(255);

        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.8)`;
        ctx.strokeStyle = `rgba(${r + 20}, ${g + 20}, ${b}, 0.9)`;

        // Draw polygon
        for (let i = 0; i < vertices.length; i++) {
          const v = vertices[i];
          const p = project(
            (v[0] - offsetX) * autoScale,
            (v[1] - offsetY) * autoScale,
            (v[2] - offsetZ) * autoScale
          );

          if (i === 0) {
            ctx.moveTo(p.x, p.y);
          } else {
            ctx.lineTo(p.x, p.y);
          }
        }

        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  // Convert to data URL
  return canvas.toDataURL("image/png");
}
