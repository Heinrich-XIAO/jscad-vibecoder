/**
 * Geometry analysis utilities using JSCAD measurement functions.
 * Calculates bounding boxes, volumes, surface areas, and printability metrics.
 */

export interface GeometryMeasurements {
  boundingBox: {
    min: number[];
    max: number[];
    dimensions: number[];
    center: number[];
  };
  volume: number;
  surfaceArea: number;
  triangleCount: number;
}

export interface PrintabilityReport {
  isManifold: boolean;
  hasThinWalls: boolean;
  hasOverhangs: boolean;
  minWallThickness: number;
  maxOverhangAngle: number;
  warnings: string[];
  recommendations: string[];
}

/**
 * Calculate measurements for JSCAD geometries
 */
export async function calculateMeasurements(geometries: unknown[]): Promise<GeometryMeasurements | null> {
  if (!geometries || geometries.length === 0) return null;

  try {
    // Import JSCAD measurement functions dynamically
    const jscad = await import("@jscad/modeling");
    const measurements = jscad.measurements;
    
    let totalVolume = 0;
    let totalSurfaceArea = 0;
    let totalTriangles = 0;
  const globalMin = [Infinity, Infinity, Infinity];
  const globalMax = [-Infinity, -Infinity, -Infinity];

    for (const geom of geometries) {
      const g = geom as Record<string, unknown>;
      
      // Calculate volume
      try {
        const vol = measurements.measureVolume(geom);
        if (typeof vol === "number") totalVolume += vol;
      } catch {
        // Geometry might not be measurable
      }

      // Calculate surface area
      try {
        const area = measurements.measureArea(geom);
        if (typeof area === "number") totalSurfaceArea += area;
      } catch {
        // Geometry might not be measurable
      }

      // Calculate bounding box
      try {
        const bbox = measurements.measureBoundingBox(geom);
        if (bbox && Array.isArray(bbox)) {
          const [min, max] = bbox;
          for (let i = 0; i < 3; i++) {
            if (min[i] < globalMin[i]) globalMin[i] = min[i];
            if (max[i] > globalMax[i]) globalMax[i] = max[i];
          }
        }
      } catch {
        // Geometry might not have bounding box
      }

      // Count triangles/polygons
      if (g.polygons && Array.isArray(g.polygons)) {
        totalTriangles += g.polygons.length;
      }
    }

    const dimensions = [
      globalMax[0] - globalMin[0],
      globalMax[1] - globalMin[1],
      globalMax[2] - globalMin[2],
    ];

    const center = [
      (globalMin[0] + globalMax[0]) / 2,
      (globalMin[1] + globalMax[1]) / 2,
      (globalMin[2] + globalMax[2]) / 2,
    ];

    return {
      boundingBox: {
        min: globalMin,
        max: globalMax,
        dimensions,
        center,
      },
      volume: Math.abs(totalVolume),
      surfaceArea: Math.abs(totalSurfaceArea),
      triangleCount: totalTriangles,
    };
  } catch (error) {
    console.error("Error calculating measurements:", error);
    return null;
  }
}

/**
 * Analyze geometry for 3D printability issues
 */
export async function analyzePrintability(geometries: unknown[]): Promise<PrintabilityReport> {
  const warnings: string[] = [];
  const recommendations: string[] = [];

  if (!geometries || geometries.length === 0) {
    return {
      isManifold: false,
      hasThinWalls: false,
      hasOverhangs: false,
      minWallThickness: 0,
      maxOverhangAngle: 0,
      warnings: ["No geometry to analyze"],
      recommendations: [],
    };
  }

  try {
    const jscad = await import("@jscad/modeling");
    const measurements = jscad.measurements;
    
    // Check each geometry
    let isManifold = true;
    let hasThinWalls = false;
    let hasOverhangs = false;
    let minWallThickness = Infinity;
    let maxOverhangAngle = 0;

    for (const geom of geometries) {
      const g = geom as Record<string, unknown>;

      // Check for polygons (manifold check)
      if (g.polygons && Array.isArray(g.polygons)) {
        // Count edges to detect non-manifold geometry
        const edgeCount = new Map<string, number>();
        
        for (const polygon of g.polygons as Array<{ vertices: number[][] }>) {
          if (!polygon.vertices || polygon.vertices.length < 3) {
            isManifold = false;
            warnings.push("Found degenerate polygon (less than 3 vertices)");
            continue;
          }

          // Check polygon edges
          const verts = polygon.vertices;
          for (let i = 0; i < verts.length; i++) {
            const v1 = verts[i];
            const v2 = verts[(i + 1) % verts.length];
            const edgeKey = `${v1.join(",")}-${v2.join(",")}`;
            const reverseKey = `${v2.join(",")}-${v1.join(",")}`;
            
            if (edgeCount.has(reverseKey)) {
              edgeCount.set(reverseKey, (edgeCount.get(reverseKey) || 0) + 1);
            } else {
              edgeCount.set(edgeKey, (edgeCount.get(edgeKey) || 0) + 1);
            }
          }
        }

        // Check for edges used more than twice (non-manifold)
        for (const [, count] of edgeCount) {
          if (count > 2) {
            isManifold = false;
            warnings.push(`Non-manifold edge detected: edge shared by ${count} polygons`);
          } else if (count === 1) {
            warnings.push("Open edge detected (hole in mesh)");
          }
        }
      }

      // Check bounding box for size warnings
      try {
        const bbox = measurements.measureBoundingBox(geom);
        if (bbox && Array.isArray(bbox)) {
          const [min, max] = bbox;
          const dims = [
            max[0] - min[0],
            max[1] - min[1],
            max[2] - min[2],
          ];

          // Check for very thin walls (assuming smallest dimension is wall thickness)
          const minDim = Math.min(...dims);
          if (minDim < 0.8) {
            hasThinWalls = true;
            if (minDim < minWallThickness) minWallThickness = minDim;
          }

          // Check for overhangs based on Z-height changes
          // This is a simplified check - in reality would need surface normals
          const zHeight = dims[2];
          const xWidth = dims[0];
          const yDepth = dims[1];

          if (zHeight > 0 && (xWidth / zHeight > 2 || yDepth / zHeight > 2)) {
            hasOverhangs = true;
            const angle = Math.atan2(Math.max(xWidth, yDepth) / 2, zHeight) * (180 / Math.PI);
            if (angle > maxOverhangAngle) maxOverhangAngle = angle;
          }
        }
      } catch {
        // Could not measure bounding box
      }
    }

    // Generate recommendations
    if (!isManifold) {
      recommendations.push("Fix non-manifold geometry before printing");
      recommendations.push("Use mesh repair tools or boolean operations to close holes");
    }

    if (hasThinWalls && minWallThickness < 0.8) {
      recommendations.push(`Increase wall thickness (currently ${minWallThickness.toFixed(2)}mm, minimum 0.8mm recommended)`);
    }

    if (hasOverhangs && maxOverhangAngle > 45) {
      recommendations.push(`Add supports for overhangs exceeding ${maxOverhangAngle.toFixed(1)}° (45° max without supports)`);
    }

    if (warnings.length === 0) {
      recommendations.push("Model looks good for 3D printing!");
    }

    return {
      isManifold,
      hasThinWalls,
      hasOverhangs,
      minWallThickness: minWallThickness === Infinity ? 0 : minWallThickness,
      maxOverhangAngle,
      warnings,
      recommendations,
    };
  } catch (error) {
    console.error("Error analyzing printability:", error);
    return {
      isManifold: false,
      hasThinWalls: false,
      hasOverhangs: false,
      minWallThickness: 0,
      maxOverhangAngle: 0,
      warnings: ["Could not analyze geometry"],
      recommendations: ["Check geometry validity"],
    };
  }
}

/**
 * Format measurements for display
 */
export function formatMeasurements(measurements: GeometryMeasurements | null): string {
  if (!measurements) return "No measurements available";

  const dims = measurements.boundingBox.dimensions;
  return `Dimensions: ${dims[0].toFixed(2)} × ${dims[1].toFixed(2)} × ${dims[2].toFixed(2)} mm
Volume: ${measurements.volume.toFixed(2)} mm³
Surface Area: ${measurements.surfaceArea.toFixed(2)} mm²
Polygons: ${measurements.triangleCount.toLocaleString()}`;
}
