"use client";

import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";
import { useTheme } from "@/lib/theme-provider";
import {
  BufferGeometry,
  Float32BufferAttribute,
  Scene,
  Color,
  PerspectiveCamera,
  WebGLRenderer,
  LineBasicMaterial,
  LineSegments,
  AxesHelper,
  Group,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  Vector3,
  ConeGeometry,
  Line,
  DoubleSide,
  Object3D,
  AmbientLight,
  DirectionalLight,
} from "three";
import { polygonVertices } from "@/lib/jscad-geometry";

export interface Viewport3DHandle {
  rotate: (dx: number, dy: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
  captureImage: () => string | null;
}

interface Viewport3DProps {
  geometry: unknown[];
  isGenerating?: boolean;
  className?: string;
}

type Vertex3 = [number, number, number];

const EDGE_NORMAL_DOT_THRESHOLD = 0.999;

function disposeObject3D(object: Object3D) {
  object.traverse((child) => {
    const mesh = child as Mesh;
    if (mesh.geometry) {
      mesh.geometry.dispose();
    }

    const material = mesh.material;
    if (!material) return;
    if (Array.isArray(material)) {
      material.forEach((m) => m.dispose());
      return;
    }
    material.dispose();
  });
}

// Convert JSCAD geometry to Three.js BufferGeometry
function jscadToThreeGeometry(geom: unknown): BufferGeometry | null {
  const g = geom as Record<string, unknown>;
  
  if (!g.polygons || !Array.isArray(g.polygons)) {
    return null;
  }
  
  const polygons = g.polygons as Array<Record<string, unknown>>;
  const vertices: number[] = [];
  const indices: number[] = [];
  let vertexIndex = 0;
  
  for (const polygon of polygons) {
    const polyVertices = polygonVertices(polygon);
    if (polyVertices.length < 3) continue;
    
    // Triangulate polygon using fan triangulation
    const baseIndex = vertexIndex;
    
    for (const v of polyVertices) {
      vertices.push(v[0], v[1], v[2]);
    }
    
    // Create triangles from the polygon fan
    for (let i = 1; i < polyVertices.length - 1; i++) {
      indices.push(baseIndex, baseIndex + i, baseIndex + i + 1);
    }
    
    vertexIndex += polyVertices.length;
  }
  
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  
  return geometry;
}

function jscadToThreeEdgeGeometry(geom: unknown): BufferGeometry | null {
  const g = geom as Record<string, unknown>;

  if (!g.polygons || !Array.isArray(g.polygons)) {
    return null;
  }

  const polygons = g.polygons as Array<Record<string, unknown>>;
  const edgeMap = new Map<string, { start: Vertex3; end: Vertex3; normals: Vertex3[] }>();

  const formatVertexKey = (vertex: Vertex3) =>
    `${vertex[0].toFixed(5)},${vertex[1].toFixed(5)},${vertex[2].toFixed(5)}`;

  const buildEdgeKey = (start: Vertex3, end: Vertex3) => {
    const startKey = formatVertexKey(start);
    const endKey = formatVertexKey(end);
    return startKey < endKey ? `${startKey}|${endKey}` : `${endKey}|${startKey}`;
  };

  const computePolygonNormal = (vertices: Vertex3[]): Vertex3 | null => {
    for (let i = 1; i < vertices.length - 1; i++) {
      const ax = vertices[i][0] - vertices[0][0];
      const ay = vertices[i][1] - vertices[0][1];
      const az = vertices[i][2] - vertices[0][2];
      const bx = vertices[i + 1][0] - vertices[0][0];
      const by = vertices[i + 1][1] - vertices[0][1];
      const bz = vertices[i + 1][2] - vertices[0][2];

      const nx = ay * bz - az * by;
      const ny = az * bx - ax * bz;
      const nz = ax * by - ay * bx;
      const length = Math.hypot(nx, ny, nz);
      if (length > 1e-8) {
        return [nx / length, ny / length, nz / length];
      }
    }

    return null;
  };

  for (const polygon of polygons) {
    const polyVertices = polygonVertices(polygon) as Vertex3[];
    if (polyVertices.length < 2) continue;
    const normal = computePolygonNormal(polyVertices);
    if (!normal) continue;

    for (let i = 0; i < polyVertices.length; i++) {
      const current = polyVertices[i];
      const next = polyVertices[(i + 1) % polyVertices.length];
      const edgeKey = buildEdgeKey(current, next);
      const existing = edgeMap.get(edgeKey);
      if (existing) {
        existing.normals.push(normal);
        continue;
      }
      edgeMap.set(edgeKey, {
        start: [...current] as Vertex3,
        end: [...next] as Vertex3,
        normals: [normal],
      });
    }
  }

  const lineVertices: number[] = [];

  edgeMap.forEach(({ start, end, normals }) => {
    if (normals.length > 1) {
      let keepEdge = false;
      for (let i = 0; i < normals.length && !keepEdge; i++) {
        for (let j = i + 1; j < normals.length; j++) {
          const dot =
            normals[i][0] * normals[j][0] +
            normals[i][1] * normals[j][1] +
            normals[i][2] * normals[j][2];
          if (Math.abs(dot) < EDGE_NORMAL_DOT_THRESHOLD) {
            keepEdge = true;
            break;
          }
        }
      }
      if (!keepEdge) return;
    }

    lineVertices.push(
      start[0], start[1], start[2],
      end[0], end[1], end[2]
    );
  });

  if (lineVertices.length === 0) {
    return null;
  }

  const edgeGeometry = new BufferGeometry();
  edgeGeometry.setAttribute("position", new Float32BufferAttribute(lineVertices, 3));
  return edgeGeometry;
}

export const Viewport3D = forwardRef<Viewport3DHandle, Viewport3DProps>(({ geometry, isGenerating, className = "" }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const cameraRef = useRef<PerspectiveCamera | null>(null);
  const rendererRef = useRef<WebGLRenderer | null>(null);
  const meshGroupRef = useRef<Group | null>(null);
  const gridMaterialRef = useRef<LineBasicMaterial | null>(null);
  const axesHelperRef = useRef<AxesHelper | null>(null);
  const rotationRef = useRef({ x: -30, y: 45 });
  const zoomRef = useRef(50);
  const isDraggingRef = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const renderFrameRef = useRef<number | null>(null);

  const renderScene = useCallback(() => {
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!renderer || !scene || !camera) return;
    renderer.render(scene, camera);
  }, []);

  const requestRender = useCallback(() => {
    if (renderFrameRef.current !== null) return;
    renderFrameRef.current = requestAnimationFrame(() => {
      renderFrameRef.current = null;
      renderScene();
    });
  }, [renderScene]);

  const syncCamera = useCallback(() => {
    const camera = cameraRef.current;
    if (!camera) return;

    const rotation = rotationRef.current;
    const zoom = zoomRef.current;
    const radX = (rotation.y * Math.PI) / 180;
    const radY = (rotation.x * Math.PI) / 180;

    const x = zoom * Math.sin(radX) * Math.cos(radY);
    const y = zoom * Math.sin(radY);
    const z = zoom * Math.cos(radX) * Math.cos(radY);

    camera.position.set(x, y, z);
    camera.lookAt(0, 0, 0);
    requestRender();
  }, [requestRender]);

  useImperativeHandle(ref, () => ({
    rotate: (dx, dy) => {
      rotationRef.current = {
        x: Math.max(-90, Math.min(90, rotationRef.current.x + dx)),
        y: rotationRef.current.y + dy,
      };
      syncCamera();
    },
    zoomIn: () => {
      zoomRef.current = Math.min(300, zoomRef.current * 1.2);
      syncCamera();
    },
    zoomOut: () => {
      zoomRef.current = Math.max(5, zoomRef.current / 1.2);
      syncCamera();
    },
    reset: () => {
      rotationRef.current = { x: -30, y: 45 };
      zoomRef.current = 50;
      syncCamera();
    },
    captureImage: () => {
      const renderer = rendererRef.current;
      const scene = sceneRef.current;
      const camera = cameraRef.current;
      if (!renderer || !scene || !camera) {
        return null;
      }
      renderScene();
      try {
        return renderer.domElement.toDataURL("image/png");
      } catch (error) {
        console.warn("Failed to capture viewport image", error);
        return null;
      }
    },
  }), [renderScene, syncCamera]);

  // Initialize Three.js scene
  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Scene
    const scene = new Scene();
    scene.background = new Color(0x1e1e1e);
    sceneRef.current = scene;

    const camera = new PerspectiveCamera(50, width / height, 0.1, 1000);
    camera.position.set(0, 0, zoomRef.current);
    cameraRef.current = camera;

    const renderer = new WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Custom grid with gaps where axes are (to prevent z-fighting)
    const gridSize = 400;
    const gridDivisions = 20;
    const step = gridSize / gridDivisions;
    const gap = 2; // Small gap around axes
    const gridGeometry = new BufferGeometry();
    const gridVertices: number[] = [];
    
    // Lines parallel to X axis (along Z) - skip lines too close to X axis (Z=0)
    for (let i = 0; i <= gridDivisions; i++) {
      const z = -gridSize/2 + i * step;
      if (Math.abs(z) > gap) {
        gridVertices.push(-gridSize/2, 0, z, gridSize/2, 0, z);
      }
    }
    
    // Lines parallel to Z axis (along X) - skip lines too close to Z axis (X=0)
    for (let i = 0; i <= gridDivisions; i++) {
      const x = -gridSize/2 + i * step;
      if (Math.abs(x) > gap) {
        gridVertices.push(x, 0, -gridSize/2, x, 0, gridSize/2);
      }
    }
    
    gridGeometry.setAttribute('position', new Float32BufferAttribute(gridVertices, 3));
    const gridMaterial = new LineBasicMaterial({ color: 0x2a2a3e });
    gridMaterialRef.current = gridMaterial;
    const gridHelper = new LineSegments(gridGeometry, gridMaterial);
    gridHelper.renderOrder = 1000;
    scene.add(gridHelper);

    const axesHelper = new AxesHelper(60);
    axesHelper.position.y = 0.01; // Slightly above grid
    axesHelper.renderOrder = 1001;
    // Store axes helper for dynamic theme updates
    axesHelperRef.current = axesHelper;
    // AxesHelper.material may be array or single material; disable depthTest where possible
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const axesMatAny: any = (axesHelper as any).material;
    if (axesMatAny) {
      if (Array.isArray(axesMatAny)) {
        axesMatAny.forEach((m: Material) => { try { (m as any).depthTest = false; } catch (_) {} });
      } else {
        try { (axesMatAny as any).depthTest = false; } catch (_) {}
      }
    }
    scene.add(axesHelper);

    // Mesh group to hold all geometry
    const meshGroup = new Group();
    scene.add(meshGroup);
    meshGroupRef.current = meshGroup;

    const ambientLight = new AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 10, 10);
    scene.add(directionalLight);

    // Handle resize
    const handleResize = () => {
      if (!container || !camera || !renderer) return;
      const newWidth = container.clientWidth;
      const newHeight = container.clientHeight;
      camera.aspect = newWidth / newHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(newWidth, newHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      requestRender();
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);
    syncCamera();

    return () => {
      resizeObserver.disconnect();
      if (renderFrameRef.current !== null) {
        cancelAnimationFrame(renderFrameRef.current);
        renderFrameRef.current = null;
      }
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, [requestRender, syncCamera]);

  const { resolvedTheme } = useTheme();

  // Apply theme to scene, renderer and helpers without recreating the whole scene.
  useEffect(() => {
    const isDark = resolvedTheme === "dark";
    const scene = sceneRef.current;
    const renderer = rendererRef.current;
    if (!scene || !renderer) return;

    const bgColor = isDark ? 0x0a0a0a : 0xfafafa;
    scene.background = new Color(bgColor);
    renderer.setClearColor(bgColor);

    // Update grid color
    if (gridMaterialRef.current) {
      gridMaterialRef.current.color.set(isDark ? 0x2a2a3e : 0xd1d5db);
    }

    // Update axes colors: keep distinct RGB colors for X/Y/Z for clarity
    const axes = axesHelperRef.current;
    if (axes) {
      try {
        // AxesHelper in three.js renders 3 lines; materials may be a single material or array
        // We'll create a small custom axes group with distinct RGB colors so axes remain visible and distinctive.

        const customAxes = new Group();
        customAxes.name = "custom_axes_rgb";
        const axisLength = 60;
        const coneRadius = 0.6;
        const coneHeight = 1.4;
        const coneSegments = 12;

        const xMat = new MeshBasicMaterial({ color: 0xff0000 });
        const xGeom = new BufferGeometry().setFromPoints([new Vector3(0, 0.01, 0), new Vector3(axisLength, 0.01, 0)]);
        const xLine = new Line(xGeom, xMat);
        customAxes.add(xLine);
        const xConeGeom = new ConeGeometry(coneRadius, coneHeight, coneSegments);
        const xConeMat = new MeshBasicMaterial({ color: 0xff0000 });
        const xCone = new Mesh(xConeGeom, xConeMat);
        xCone.position.set(axisLength + coneHeight / 2, 0.01, 0);
        xCone.rotateZ(-Math.PI / 2);
        customAxes.add(xCone);

        const yMat = new MeshBasicMaterial({ color: 0x00ff00 });
        const yGeom = new BufferGeometry().setFromPoints([new Vector3(0, 0.01, 0), new Vector3(0, axisLength, 0)]);
        const yLine = new Line(yGeom, yMat);
        customAxes.add(yLine);
        const yConeGeom = new ConeGeometry(coneRadius, coneHeight, coneSegments);
        const yConeMat = new MeshBasicMaterial({ color: 0x00ff00 });
        const yCone = new Mesh(yConeGeom, yConeMat);
        yCone.position.set(0, axisLength + coneHeight / 2, 0.01);
        customAxes.add(yCone);

        const zMat = new MeshBasicMaterial({ color: 0x0000ff });
        const zGeom = new BufferGeometry().setFromPoints([new Vector3(0, 0.01, 0), new Vector3(0, 0.01, axisLength)]);
        const zLine = new Line(zGeom, zMat);
        customAxes.add(zLine);
        const zConeGeom = new ConeGeometry(coneRadius, coneHeight, coneSegments);
        const zConeMat = new MeshBasicMaterial({ color: 0x0000ff });
        const zCone = new Mesh(zConeGeom, zConeMat);
        zCone.position.set(0, 0.01, axisLength + coneHeight / 2);
        zCone.rotateX(Math.PI / 2);
        customAxes.add(zCone);

        customAxes.renderOrder = 1002;

        const attachTarget = ((axes.parent ?? sceneRef.current) as any) as Object3D;
        if (attachTarget) {
          const existingCustom = attachTarget.getObjectByName("custom_axes_rgb");
          if (existingCustom) attachTarget.remove(existingCustom);
          attachTarget.add(customAxes);

          // Hide or remove the original AxesHelper to avoid overlap/duplicate lines
          const origAxes = axesHelperRef.current;
          if (origAxes) {
            try {
              if (origAxes.parent) {
                origAxes.parent.remove(origAxes);
              } else {
                origAxes.visible = false;
              }
            } catch (_) {
              try { origAxes.visible = false; } catch (_) {}
            }
          }
        }
      } catch (err) {
        // fallback: attempt to tint existing axes materials
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const matsAny: any = (axes as any).material;
        if (matsAny) {
            if (Array.isArray(matsAny)) {
            matsAny[0] && matsAny[0].color && matsAny[0].color.set(0xc62828);
            matsAny[1] && matsAny[1].color && matsAny[1].color.set(0x00ff00);
            matsAny[2] && matsAny[2].color && matsAny[2].color.set(0x1565c0);
          } else if (matsAny.color) {
            matsAny.color.set(0x444444);
          }
        }
      }
    }

    // Update existing meshes/lines colors for readability in light mode
    if (meshGroupRef.current) {
      meshGroupRef.current.traverse((child: any) => {
        if (child.isMesh) {
          const mat = child.material;
          const col = isDark ? 0xc0c0c0 : 0x2f2f2f;
          if (Array.isArray(mat)) mat.forEach((m: any) => { if (m.color) m.color.set(col); });
          else if (mat && mat.color) mat.color.set(col);
        }
        if (child.type === "LineSegments" || child.isLine) {
          const lm = child.material;
          const lcol = isDark ? 0x000000 : 0x111827;
          if (lm && lm.color) lm.color.set(lcol);
        }
      });
    }
    requestRender();
  }, [requestRender, resolvedTheme]);

  // Keep the previous frame visible while a new evaluation is in flight.
  useEffect(() => {
    if (!meshGroupRef.current || !geometry) return;

    const group = meshGroupRef.current;

    if (isGenerating) return;

    while (group.children.length > 0) {
      const child = group.children[0];
      disposeObject3D(child);
      group.remove(child);
    }

    if (!geometry.length) {
      requestRender();
      return;
    }

    for (const geom of geometry) {
      const threeGeom = jscadToThreeGeometry(geom);
      if (!threeGeom) continue;
      const edgeGeom = jscadToThreeEdgeGeometry(geom);

      const solidMaterial = new MeshPhongMaterial({
        color: 0xc0c0c0,
        opacity: 0.75,
        transparent: true,
        side: DoubleSide,
      });
      const mesh = new Mesh(threeGeom, solidMaterial);
      group.add(mesh);

      if (edgeGeom) {
        const edgeMaterial = new LineBasicMaterial({
          color: 0x000000,
          depthTest: true,
          depthWrite: false,
          transparent: true,
          opacity: 0.9,
        });
        const edges = new LineSegments(edgeGeom, edgeMaterial);
        group.add(edges);
      }
    }
    requestRender();
  }, [geometry, isGenerating, requestRender]);

  // Mouse interaction
  const handleMouseDown = (e: React.MouseEvent) => {
    isDraggingRef.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    rotationRef.current = {
      x: Math.max(-90, Math.min(90, rotationRef.current.x + dy * 0.5)),
      y: rotationRef.current.y - dx * 0.5,
    };
    lastPos.current = { x: e.clientX, y: e.clientY };
    syncCamera();
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
  };

  const handleWheel = useCallback((event: WheelEvent) => {
    event.preventDefault();
    zoomRef.current = Math.max(5, Math.min(300, zoomRef.current + event.deltaY * 0.01));
    syncCamera();
  }, [syncCamera]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      container.removeEventListener("wheel", handleWheel);
    };
  }, [handleWheel]);

  return (
    <div
      ref={containerRef}
      className={`w-full h-full cursor-grab active:cursor-grabbing ${className}`}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    />
  );
});

Viewport3D.displayName = "Viewport3D";
