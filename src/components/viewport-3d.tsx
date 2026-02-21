"use client";

import { useRef, useEffect, useCallback, useState, forwardRef, useImperativeHandle } from "react";
import { useTheme } from "@/lib/theme-provider";
import * as THREE from "three";
import { polygonVertices } from "@/lib/jscad-geometry";

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

// Convert JSCAD geometry to Three.js BufferGeometry
function jscadToThreeGeometry(geom: unknown): THREE.BufferGeometry | null {
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
  
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  
  return geometry;
}

export const Viewport3D = forwardRef<Viewport3DHandle, Viewport3DProps>(({ geometry, isGenerating, className = "" }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const meshGroupRef = useRef<THREE.Group | null>(null);
  const gridMaterialRef = useRef<THREE.LineBasicMaterial | null>(null);
  const axesHelperRef = useRef<THREE.AxesHelper | null>(null);
  const [rotation, setRotation] = useState({ x: -30, y: 45 });
  const [isDragging, setIsDragging] = useState(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(50);

  useImperativeHandle(ref, () => ({
    rotate: (dx, dy) => {
      setRotation((r) => ({ x: r.x + dx, y: r.y + dy }));
    },
    zoomIn: () => setZoom((z) => Math.min(300, z * 1.2)),
    zoomOut: () => setZoom((z) => Math.max(5, z / 1.2)),
    reset: () => {
      setRotation({ x: -30, y: 45 });
      setZoom(50);
    },
  }));

  // Initialize Three.js scene
  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1e1e1e);
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
    camera.position.set(0, 0, zoom);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Custom grid with gaps where axes are (to prevent z-fighting)
    const gridSize = 400;
    const gridDivisions = 20;
    const step = gridSize / gridDivisions;
    const gap = 2; // Small gap around axes
    const gridGeometry = new THREE.BufferGeometry();
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
    
    gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(gridVertices, 3));
    const gridMaterial = new THREE.LineBasicMaterial({ color: 0x2a2a3e });
    gridMaterialRef.current = gridMaterial;
    const gridHelper = new THREE.LineSegments(gridGeometry, gridMaterial);
    gridHelper.renderOrder = 1000;
    scene.add(gridHelper);

    // Axes - render on top to avoid z-fighting with grid
    const axesHelper = new THREE.AxesHelper(60);
    axesHelper.position.y = 0.01; // Slightly above grid
    axesHelper.renderOrder = 1001;
    // Store axes helper for dynamic theme updates
    axesHelperRef.current = axesHelper;
    // AxesHelper.material may be array or single material; disable depthTest where possible
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const axesMatAny: any = (axesHelper as any).material;
    if (axesMatAny) {
      if (Array.isArray(axesMatAny)) {
        axesMatAny.forEach((m: THREE.Material) => { try { (m as any).depthTest = false; } catch (_) {} });
      } else {
        try { (axesMatAny as any).depthTest = false; } catch (_) {}
      }
    }
    scene.add(axesHelper);

    // Mesh group to hold all geometry
    const meshGroup = new THREE.Group();
    scene.add(meshGroup);
    meshGroupRef.current = meshGroup;

    // Animation loop
    const animate = () => {
      requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();

    // Handle resize
    const handleResize = () => {
      if (!container || !camera || !renderer) return;
      const newWidth = container.clientWidth;
      const newHeight = container.clientHeight;
      camera.aspect = newWidth / newHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(newWidth, newHeight);
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, []);

  const { resolvedTheme } = useTheme();

  // Apply theme to scene, renderer and helpers without recreating the whole scene.
  useEffect(() => {
    const isDark = resolvedTheme === "dark";
    const scene = sceneRef.current;
    const renderer = rendererRef.current;
    if (!scene || !renderer) return;

    const bgColor = isDark ? 0x0a0a0a : 0xfafafa;
    scene.background = new THREE.Color(bgColor);
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

        const customAxes = new THREE.Group();
        customAxes.name = "custom_axes_rgb";
        const axisLength = 60;

        // X axis - pure red (255,0,0)
const xMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
const xGeom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.01, 0), new THREE.Vector3(axisLength, 0.01, 0)]);
const xLine = new THREE.Line(xGeom, xMat);
customAxes.add(xLine);
        // X axis arrowhead (cone pointing +X)
        const coneRadius = 0.6;
        const coneHeight = 1.4;
        const coneSegments = 12;
        const xConeGeom = new THREE.ConeGeometry(coneRadius, coneHeight, coneSegments);
        const xConeMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        const xCone = new THREE.Mesh(xConeGeom, xConeMat);
        xCone.position.set(axisLength + coneHeight / 2, 0.01, 0);
        xCone.rotateZ(-Math.PI / 2);
        customAxes.add(xCone);

        // Y axis - pure green (0,255,0)
const yMat = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
const yGeom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.01, 0), new THREE.Vector3(0, axisLength, 0)]);
const yLine = new THREE.Line(yGeom, yMat);
customAxes.add(yLine);
        // Y axis arrowhead (cone pointing +Y)
        const yConeGeom = new THREE.ConeGeometry(coneRadius, coneHeight, coneSegments);
        const yConeMat = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
        const yCone = new THREE.Mesh(yConeGeom, yConeMat);
        yCone.position.set(0, axisLength + coneHeight / 2, 0.01);
        customAxes.add(yCone);

        // Z axis - pure blue (0,0,255)
const zMat = new THREE.MeshBasicMaterial({ color: 0x0000ff });
const zGeom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.01, 0), new THREE.Vector3(0, 0.01, axisLength)]);
const zLine = new THREE.Line(zGeom, zMat);
customAxes.add(zLine);
        // Z axis arrowhead (cone pointing +Z)
        const zConeGeom = new THREE.ConeGeometry(coneRadius, coneHeight, coneSegments);
        const zConeMat = new THREE.MeshBasicMaterial({ color: 0x0000ff });
        const zCone = new THREE.Mesh(zConeGeom, zConeMat);
        zCone.position.set(0, 0.01, axisLength + coneHeight / 2);
        zCone.rotateX(Math.PI / 2);
        customAxes.add(zCone);

        customAxes.renderOrder = 1002;

        // Attach to axes parent if available, otherwise attach to scene root
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const attachTarget = ((axes.parent ?? sceneRef.current) as any) as THREE.Object3D;
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
  }, [resolvedTheme]);

  // Update camera position based on rotation and zoom
  useEffect(() => {
    if (!cameraRef.current) return;
    
    const radX = (rotation.y * Math.PI) / 180;
    const radY = (rotation.x * Math.PI) / 180;
    
    const x = zoom * Math.sin(radX) * Math.cos(radY);
    const y = zoom * Math.sin(radY);
    const z = zoom * Math.cos(radX) * Math.cos(radY);
    
    cameraRef.current.position.set(x, y, z);
    cameraRef.current.lookAt(0, 0, 0);
  }, [rotation, zoom]);

  // Update geometry
  useEffect(() => {
    if (!meshGroupRef.current || !geometry) return;

    const group = meshGroupRef.current;
    
    // Clear existing meshes
    while (group.children.length > 0) {
      const child = group.children[0];
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        } else {
          child.material.dispose();
        }
      }
      group.remove(child);
    }

    if (isGenerating || !geometry.length) return;

    for (const geom of geometry) {
      const threeGeom = jscadToThreeGeometry(geom);
      if (!threeGeom) continue;

      // Create solid mesh (light grey, slightly transparent)
      const solidMaterial = new THREE.MeshPhongMaterial({
        color: 0xc0c0c0,
        opacity: 0.75,
        transparent: true,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(threeGeom, solidMaterial);
      
      // Create edges - only show edges where there's a significant angle change
      const edges = new THREE.EdgesGeometry(threeGeom, 15); // threshold angle of 15 degrees
      const lineMaterial = new THREE.LineBasicMaterial({ 
        color: 0x000000,
        depthTest: true,
        depthWrite: true,
      });
      const lines = new THREE.LineSegments(edges, lineMaterial);
      
      // Add both to a parent object
      const obj = new THREE.Group();
      obj.add(mesh);
      obj.add(lines);
      
      group.add(obj);
    }

    // Add lighting
    if (sceneRef.current) {
      // Remove old lights
      const oldLights = sceneRef.current.children.filter(c => c instanceof THREE.Light);
      oldLights.forEach(l => sceneRef.current!.remove(l));
      
      // Add new lights
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
      sceneRef.current.add(ambientLight);
      
      const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
      directionalLight.position.set(10, 10, 10);
      sceneRef.current.add(directionalLight);
    }
  }, [geometry, isGenerating]);

  // Mouse interaction
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    lastPos.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    setRotation((r) => ({
      x: Math.max(-90, Math.min(90, r.x + dy * 0.5)),
      y: r.y - dx * 0.5,
    }));
    lastPos.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseUp = () => setIsDragging(false);

  const handleWheel = useCallback((event: WheelEvent) => {
    event.preventDefault();
    setZoom((z) => Math.max(5, Math.min(300, z + event.deltaY * 0.01)));
  }, []);

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
