"use client";

import { useRef, useEffect, useCallback, useState, forwardRef, useImperativeHandle } from "react";
import * as THREE from "three";

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
  
  const polygons = g.polygons as Array<{ vertices: number[][] }>;
  const vertices: number[] = [];
  const indices: number[] = [];
  let vertexIndex = 0;
  
  for (const polygon of polygons) {
    if (!polygon.vertices || polygon.vertices.length < 3) continue;
    
    // Triangulate polygon using fan triangulation
    const baseIndex = vertexIndex;
    
    for (const v of polygon.vertices) {
      vertices.push(v[0], v[1], v[2]);
    }
    
    // Create triangles from the polygon fan
    for (let i = 1; i < polygon.vertices.length - 1; i++) {
      indices.push(baseIndex, baseIndex + i, baseIndex + i + 1);
    }
    
    vertexIndex += polygon.vertices.length;
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

    // Grid
    const gridHelper = new THREE.GridHelper(400, 20, 0x2a2a3e, 0x2a2a3e);
    gridHelper.renderOrder = 1000;
    scene.add(gridHelper);

    // Axes - render on top to avoid z-fighting
    const axesHelper = new THREE.AxesHelper(60);
    axesHelper.renderOrder = 1001;
    axesHelper.material.depthTest = false;
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

      // Create solid mesh (grey, slightly transparent)
      const solidMaterial = new THREE.MeshPhongMaterial({
        color: 0x808080,
        opacity: 0.9,
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
