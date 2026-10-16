"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

type TankRectangularScene3DProps = {
  fillPercent: number;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  sensorDistanceCm: number;
  fuelHeightCm: number;
  showMeasurementBadges?: boolean;
};

type TankHorizontalCylinderScene3DProps = {
  fillPercent: number;
  lengthCm: number | null;
  diameterCm: number | null;
  sensorDistanceCm: number;
  fuelHeightCm: number;
  showMeasurementBadges?: boolean;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

type WebGlContext = WebGLRenderingContext | WebGL2RenderingContext;

function createSafeWebGlRenderer(canvas: HTMLCanvasElement) {
  const contextAttributes: WebGLContextAttributes = {
    alpha: true,
    antialias: true,
    depth: true,
    failIfMajorPerformanceCaveat: false,
    powerPreference: "high-performance",
    preserveDrawingBuffer: false,
    stencil: false,
  };

  let context: WebGlContext | null = null;

  try {
    context = (canvas.getContext("webgl2", contextAttributes) ??
      canvas.getContext("webgl", contextAttributes) ??
      canvas.getContext(
        "experimental-webgl",
        contextAttributes,
      )) as WebGlContext | null;
  } catch {
    return null;
  }

  if (!context) {
    return null;
  }

  try {
    return new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      canvas,
      context: context as WebGLRenderingContext,
    });
  } catch {
    return null;
  }
}

function TankFallbackVisual({
  fillPercent,
  shape,
}: {
  fillPercent: number;
  shape: "rectangular" | "cylinder";
}) {
  const safeFillPercent = clamp(fillPercent, 0, 100);
  const fillStyle = { height: `${safeFillPercent}%` };
  const surfaceStyle = { bottom: `${safeFillPercent}%` };

  return (
    <div
      className="absolute inset-0 overflow-hidden bg-slate-50"
      aria-label={`Fallback tank visual with ${safeFillPercent}% fill`}
    >
      <div className="absolute inset-x-6 top-6 bottom-7 flex items-center justify-center">
        <div
          className={
            shape === "rectangular"
              ? "relative h-[74%] w-[82%] overflow-hidden rounded-[1.7rem] border border-slate-300 bg-white/80 shadow-[0_18px_45px_rgba(15,23,42,0.12)]"
              : "relative h-[68%] w-[86%] overflow-hidden rounded-full border border-slate-300 bg-white/80 shadow-[0_18px_45px_rgba(15,23,42,0.12)]"
          }
        >
          <div
            className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-cyan-700 via-sky-500 to-cyan-300 transition-[height] duration-700 ease-out"
            style={fillStyle}
          />
          <div
            className="absolute inset-x-0 h-px bg-cyan-200/80"
            style={surfaceStyle}
          />
          <div className="absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-white/95 via-white/45 to-transparent" />
          {shape === "cylinder" ? (
            <>
              <div className="absolute inset-y-0 left-0 w-[18%] rounded-full border-r border-slate-300/70 bg-white/20" />
              <div className="absolute inset-y-0 right-0 w-[18%] rounded-full border-l border-slate-300/70 bg-white/20" />
            </>
          ) : null}
        </div>

        <div className="absolute left-1/2 top-8 -translate-x-1/2">
          <span className="block size-6 rounded-full border-4 border-red-100 bg-red-600 shadow-[0_0_0_7px_rgba(239,68,68,0.12)]" />
          <span className="mx-auto block h-20 w-px border-l border-dashed border-red-500" />
        </div>
      </div>
    </div>
  );
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();

      if (Array.isArray(child.material)) {
        child.material.forEach((material) => material.dispose());
      } else {
        child.material.dispose();
      }
    }

    if (child instanceof THREE.LineSegments) {
      child.geometry.dispose();

      if (Array.isArray(child.material)) {
        child.material.forEach((material) => material.dispose());
      } else {
        child.material.dispose();
      }
    }

    if (child instanceof THREE.Line) {
      child.geometry.dispose();

      if (Array.isArray(child.material)) {
        child.material.forEach((material) => material.dispose());
      } else {
        child.material.dispose();
      }
    }
  });
}

function createHorizontalCylinderLiquidGeometry({
  radius,
  length,
  fuelHeight,
}: {
  radius: number;
  length: number;
  fuelHeight: number;
}) {
  const safeFuelHeight = clamp(fuelHeight, 0, radius * 2);
  const surfaceY = -radius + safeFuelHeight;
  const positions: number[] = [];
  const indices: number[] = [];
  const segments = 96;

  const addVertex = (x: number, y: number, z: number) => {
    positions.push(x, y, z);
    return positions.length / 3 - 1;
  };

  const sectionPoints: Array<{ y: number; z: number }> = [];

  if (safeFuelHeight <= 0.001) {
    sectionPoints.push(
      { y: -radius, z: -0.001 },
      { y: -radius, z: 0.001 },
      { y: -radius + 0.001, z: 0.001 },
      { y: -radius + 0.001, z: -0.001 },
    );
  } else if (safeFuelHeight >= radius * 2 - 0.001) {
    for (let index = 0; index < segments; index += 1) {
      const theta = (Math.PI * 2 * index) / segments;
      sectionPoints.push({
        y: Math.sin(theta) * radius * 0.96,
        z: Math.cos(theta) * radius * 0.96,
      });
    }
  } else {
    const innerRadius = radius * 0.96;
    const safeSurfaceY = clamp(surfaceY, -innerRadius, innerRadius);
    const thetaRight = Math.asin(safeSurfaceY / innerRadius);
    const thetaLeft = Math.PI - thetaRight;
    const start = thetaLeft;
    const end = Math.PI * 2 + thetaRight;

    sectionPoints.push({
      y: safeSurfaceY,
      z: innerRadius * Math.cos(thetaLeft),
    });

    for (let index = 0; index <= segments; index += 1) {
      const theta = start + ((end - start) * index) / segments;
      sectionPoints.push({
        y: innerRadius * Math.sin(theta),
        z: innerRadius * Math.cos(theta),
      });
    }

    sectionPoints.push({
      y: safeSurfaceY,
      z: innerRadius * Math.cos(thetaRight),
    });
  }

  const leftCenter = addVertex(-length / 2, 0, 0);
  const rightCenter = addVertex(length / 2, 0, 0);
  const leftStartIndex = positions.length / 3;
  sectionPoints.forEach((point) => addVertex(-length / 2, point.y, point.z));
  const rightStartIndex = positions.length / 3;
  sectionPoints.forEach((point) => addVertex(length / 2, point.y, point.z));

  for (let index = 0; index < sectionPoints.length; index += 1) {
    const nextIndex = (index + 1) % sectionPoints.length;
    const leftA = leftStartIndex + index;
    const leftB = leftStartIndex + nextIndex;
    const rightA = rightStartIndex + index;
    const rightB = rightStartIndex + nextIndex;

    indices.push(leftA, rightA, rightB);
    indices.push(leftA, rightB, leftB);
    indices.push(leftCenter, leftB, leftA);
    indices.push(rightCenter, rightA, rightB);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return {
    geometry,
    surfaceY,
  };
}

function createCircleLineGeometry(radius: number, segments = 96) {
  const points: THREE.Vector3[] = [];

  for (let index = 0; index <= segments; index += 1) {
    const theta = (Math.PI * 2 * index) / segments;
    points.push(
      new THREE.Vector3(0, Math.sin(theta) * radius, Math.cos(theta) * radius),
    );
  }

  return new THREE.BufferGeometry().setFromPoints(points);
}

function createHorizontalLineGeometry({
  x,
  y,
  width,
}: {
  x: number;
  y: number;
  width: number;
}) {
  return new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(x, y, -width / 2),
    new THREE.Vector3(x, y, width / 2),
  ]);
}

export function TankRectangularScene3D({
  fillPercent,
  lengthCm,
  widthCm,
  heightCm,
  sensorDistanceCm,
  fuelHeightCm,
  showMeasurementBadges = true,
}: TankRectangularScene3DProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [renderMode, setRenderMode] = useState<"webgl" | "fallback">("webgl");

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;

    if (!canvas || !container) {
      return;
    }

    const renderer = createSafeWebGlRenderer(canvas);

    if (!renderer) {
      setRenderMode("fallback");
      return;
    }

    setRenderMode("webgl");
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf8fafc);

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(4.8, 3.2, 5.8);
    camera.lookAt(0, 0.45, 0);

    const root = new THREE.Group();
    scene.add(root);

    const ambientLight = new THREE.HemisphereLight(0xffffff, 0xdbeafe, 2.3);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
    keyLight.position.set(4, 6, 5);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x67e8f9, 1.1);
    fillLight.position.set(-5, 2, -3);
    scene.add(fillLight);

    const safeLength = Math.max(lengthCm ?? 150, 1);
    const safeWidth = Math.max(widthCm ?? 60, 1);
    const safeHeight = Math.max(heightCm ?? 60, 1);
    const maxDimension = Math.max(safeLength, safeWidth, safeHeight);
    const scale = 4.4 / maxDimension;
    const tankLength = safeLength * scale;
    const tankWidth = safeWidth * scale;
    const tankHeight = safeHeight * scale;
    const safeFillPercent = clamp(fillPercent, 0, 100);
    const liquidHeight = Math.max(tankHeight * (safeFillPercent / 100), 0.02);
    const liquidTopY = -tankHeight / 2 + liquidHeight;
    const sensorGap = 0.42;
    const sensorY = tankHeight / 2 + sensorGap;
    const sensorLineHeight = Math.max(sensorY - liquidTopY, 0.04);

    const tankMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.26,
      roughness: 0.18,
      metalness: 0,
      transmission: 0.35,
      thickness: 0.18,
      side: THREE.DoubleSide,
    });
    const tankGeometry = new THREE.BoxGeometry(tankLength, tankHeight, tankWidth);
    const tankMesh = new THREE.Mesh(tankGeometry, tankMaterial);
    tankMesh.position.y = 0;
    root.add(tankMesh);

    const edgeGeometry = new THREE.EdgesGeometry(tankGeometry);
    const edges = new THREE.LineSegments(
      edgeGeometry,
      new THREE.LineBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.82 }),
    );
    root.add(edges);

    const liquidMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x0ea5e9,
      transparent: true,
      opacity: 0.82,
      roughness: 0.08,
      metalness: 0,
      transmission: 0.08,
      side: THREE.DoubleSide,
    });
    const liquidGeometry = new THREE.BoxGeometry(
      tankLength * 0.96,
      liquidHeight,
      tankWidth * 0.96,
    );
    const liquid = new THREE.Mesh(liquidGeometry, liquidMaterial);
    liquid.position.y = -tankHeight / 2 + liquidHeight / 2;
    root.add(liquid);

    const surface = new THREE.Mesh(
      new THREE.BoxGeometry(tankLength * 0.96, 0.015, tankWidth * 0.96),
      new THREE.MeshBasicMaterial({
        color: 0x7dd3fc,
        transparent: true,
        opacity: 0.9,
      }),
    );
    surface.position.y = liquidTopY + 0.01;
    root.add(surface);

    const sensor = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.16, 0.18, 32),
      new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.35 }),
    );
    sensor.position.set(0, sensorY, 0);
    sensor.rotation.x = Math.PI / 2;
    root.add(sensor);

    const sensorLine = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.018, sensorLineHeight, 16),
      new THREE.MeshBasicMaterial({ color: 0xef4444 }),
    );
    sensorLine.position.set(0, liquidTopY + sensorLineHeight / 2, 0);
    root.add(sensorLine);

    const topMeasure = new THREE.Mesh(
      new THREE.RingGeometry(0.2, 0.225, 32),
      new THREE.MeshBasicMaterial({ color: 0xef4444, side: THREE.DoubleSide }),
    );
    topMeasure.position.set(0, liquidTopY + 0.025, 0);
    topMeasure.rotation.x = -Math.PI / 2;
    root.add(topMeasure);

    const grid = new THREE.GridHelper(6, 12, 0xcbd5e1, 0xe2e8f0);
    grid.position.y = -tankHeight / 2 - 0.03;
    root.add(grid);

    let pointerDown = false;
    let lastX = 0;
    let targetRotationY = -0.45;
    let currentRotationY = -0.45;
    root.rotation.x = -0.12;

    const onPointerDown = (event: PointerEvent) => {
      pointerDown = true;
      lastX = event.clientX;
      canvas.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!pointerDown) {
        return;
      }

      targetRotationY += (event.clientX - lastX) * 0.008;
      lastX = event.clientX;
    };
    const onPointerUp = (event: PointerEvent) => {
      pointerDown = false;
      canvas.releasePointerCapture(event.pointerId);
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const width = Math.max(rect.width, 1);
      const height = Math.max(rect.height, 1);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();

    let frameId = 0;
    const animate = () => {
      currentRotationY += (targetRotationY - currentRotationY) * 0.08;
      root.rotation.y = currentRotationY;
      sensor.rotation.z += 0.006;
      renderer.render(scene, camera);
      frameId = window.requestAnimationFrame(animate);
    };
    animate();

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      disposeObject(root);
      grid.geometry.dispose();
      if (Array.isArray(grid.material)) {
        grid.material.forEach((material) => material.dispose());
      } else {
        grid.material.dispose();
      }
      renderer.dispose();
    };
  }, [
    fillPercent,
    lengthCm,
    widthCm,
    heightCm,
    sensorDistanceCm,
    fuelHeightCm,
  ]);

  return (
    <div ref={containerRef} className="absolute inset-0">
      {renderMode === "fallback" ? (
        <TankFallbackVisual
          fillPercent={fillPercent}
          shape="rectangular"
        />
      ) : (
        <canvas
          ref={canvasRef}
          className="h-full w-full cursor-grab touch-none active:cursor-grabbing"
          aria-label={`3D visual of a rectangular tank with ${fillPercent}% fill`}
        />
      )}
      {showMeasurementBadges ? (
        <>
          <div className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-white/85 px-3 py-1 text-xs font-semibold text-zinc-600 ring-1 ring-zinc-200">
            H {fuelHeightCm} cm
          </div>
          <div className="pointer-events-none absolute bottom-3 right-3 rounded-full bg-white/85 px-3 py-1 text-xs font-semibold text-zinc-600 ring-1 ring-zinc-200">
            Empty space {sensorDistanceCm} cm
          </div>
        </>
      ) : null}
    </div>
  );
}

export function TankHorizontalCylinderScene3D({
  fillPercent,
  lengthCm,
  diameterCm,
  sensorDistanceCm,
  fuelHeightCm,
  showMeasurementBadges = true,
}: TankHorizontalCylinderScene3DProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [renderMode, setRenderMode] = useState<"webgl" | "fallback">("webgl");
  const displayFillPercent = clamp(fillPercent, 0, 100);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;

    if (!canvas || !container) {
      return;
    }

    const renderer = createSafeWebGlRenderer(canvas);

    if (!renderer) {
      setRenderMode("fallback");
      return;
    }

    setRenderMode("webgl");
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf8fafc);

    const camera = new THREE.PerspectiveCamera(31, 1, 0.1, 100);
    camera.position.set(5.2, 1.85, 7.2);
    camera.lookAt(0, 0.05, 0);

    const root = new THREE.Group();
    scene.add(root);

    scene.add(new THREE.HemisphereLight(0xffffff, 0xdbeafe, 2.4));

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
    keyLight.position.set(4, 6, 5);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x67e8f9, 1.1);
    fillLight.position.set(-5, 2, -3);
    scene.add(fillLight);

    const safeLength = Math.max(lengthCm ?? 283, 1);
    const safeDiameter = Math.max(diameterCm ?? 150, 1);
    const maxDimension = Math.max(safeLength, safeDiameter);
    const scale = 4.5 / maxDimension;
    const tankLength = safeLength * scale;
    const tankRadius = (safeDiameter * scale) / 2;
    const scaledFuelHeight = clamp(fuelHeightCm * scale, 0, tankRadius * 2);
    const tankGeometry = new THREE.CylinderGeometry(
      tankRadius,
      tankRadius,
      tankLength,
      128,
      1,
      true,
    );
    tankGeometry.rotateZ(Math.PI / 2);

    const tankMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.18,
      roughness: 0.12,
      metalness: 0,
      transmission: 0.46,
      thickness: 0.18,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const tankMesh = new THREE.Mesh(tankGeometry, tankMaterial);
    tankMesh.renderOrder = 1;
    root.add(tankMesh);

    const ringMaterial = new THREE.LineBasicMaterial({
      color: 0x64748b,
      transparent: true,
      opacity: 0.82,
    });
    const leftRing = new THREE.Line(
      createCircleLineGeometry(tankRadius),
      ringMaterial,
    );
    leftRing.position.x = -tankLength / 2;
    root.add(leftRing);

    const rightRing = new THREE.Line(
      createCircleLineGeometry(tankRadius),
      ringMaterial.clone(),
    );
    rightRing.position.x = tankLength / 2;
    root.add(rightRing);

    const lengthGuideMaterial = new THREE.LineBasicMaterial({
      color: 0x94a3b8,
      transparent: true,
      opacity: 0.38,
    });
    [
      [tankRadius, 0],
      [-tankRadius, 0],
      [0, tankRadius],
      [0, -tankRadius],
    ].forEach(([y, z]) => {
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(-tankLength / 2, y, z),
          new THREE.Vector3(tankLength / 2, y, z),
        ]),
        lengthGuideMaterial.clone(),
      );
      root.add(line);
    });

    const endCapMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.12,
      roughness: 0.1,
      transmission: 0.52,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const endCapGeometry = new THREE.CircleGeometry(tankRadius * 0.99, 128);
    const leftCap = new THREE.Mesh(endCapGeometry, endCapMaterial);
    leftCap.position.x = -tankLength / 2;
    leftCap.rotation.y = Math.PI / 2;
    root.add(leftCap);

    const rightCap = new THREE.Mesh(
      endCapGeometry.clone(),
      endCapMaterial.clone(),
    );
    rightCap.position.x = tankLength / 2;
    rightCap.rotation.y = Math.PI / 2;
    root.add(rightCap);

    const { geometry: liquidGeometry, surfaceY } =
      createHorizontalCylinderLiquidGeometry({
        radius: tankRadius,
        length: tankLength,
        fuelHeight: scaledFuelHeight,
      });
    const liquid = new THREE.Mesh(
      liquidGeometry,
      new THREE.MeshPhysicalMaterial({
        color: 0x0ea5e9,
        transparent: true,
        opacity: 0.9,
        roughness: 0.08,
        metalness: 0,
        transmission: 0.08,
        side: THREE.DoubleSide,
      }),
    );
    liquid.renderOrder = 2;
    root.add(liquid);

    const chordWidth = Math.sqrt(Math.max(0, tankRadius ** 2 - surfaceY ** 2)) * 2;
    const surfaceWidth = Math.max(
      chordWidth * 0.9,
      0.04,
    );
    const surface = new THREE.Mesh(
      new THREE.BoxGeometry(tankLength * 0.88, 0.018, surfaceWidth),
      new THREE.MeshPhysicalMaterial({
        color: 0x7dd3fc,
        transparent: true,
        opacity: 0.48,
        roughness: 0.08,
        transmission: 0.12,
        depthWrite: false,
      }),
    );
    surface.position.y = surfaceY + 0.012;
    surface.renderOrder = 4;
    root.add(surface);

    const surfaceLineMaterial = new THREE.LineBasicMaterial({
      color: 0x0284c7,
      transparent: true,
      opacity: 0.85,
    });
    const leftSurfaceLine = new THREE.Line(
      createHorizontalLineGeometry({
        x: -tankLength / 2 - 0.003,
        y: surfaceY,
        width: chordWidth,
      }),
      surfaceLineMaterial,
    );
    root.add(leftSurfaceLine);

    const rightSurfaceLine = new THREE.Line(
      createHorizontalLineGeometry({
        x: tankLength / 2 + 0.003,
        y: surfaceY,
        width: chordWidth,
      }),
      surfaceLineMaterial.clone(),
    );
    root.add(rightSurfaceLine);

    const sensorGap = 0.34;
    const sensorY = tankRadius + sensorGap;
    const sensorLineHeight = Math.max(sensorY - surfaceY, 0.04);
    const sensor = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.13, 0.16, 32),
      new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.35 }),
    );
    sensor.position.set(0, sensorY, 0);
    sensor.rotation.x = Math.PI / 2;
    root.add(sensor);

    const sensorLine = new THREE.Mesh(
      new THREE.CylinderGeometry(0.014, 0.014, sensorLineHeight, 16),
      new THREE.MeshBasicMaterial({ color: 0xef4444 }),
    );
    sensorLine.position.set(0, surfaceY + sensorLineHeight / 2, 0);
    root.add(sensorLine);

    const surfaceMarker = new THREE.Mesh(
      new THREE.RingGeometry(0.15, 0.175, 32),
      new THREE.MeshBasicMaterial({ color: 0xef4444, side: THREE.DoubleSide }),
    );
    surfaceMarker.position.set(0, surfaceY + 0.025, 0);
    surfaceMarker.rotation.x = -Math.PI / 2;
    root.add(surfaceMarker);

    const grid = new THREE.GridHelper(5.4, 10, 0xcbd5e1, 0xe2e8f0);
    grid.position.y = -tankRadius - 0.08;
    root.add(grid);

    let pointerDown = false;
    let lastX = 0;
    let targetRotationY = -0.34;
    let currentRotationY = -0.34;
    root.rotation.x = -0.04;

    const onPointerDown = (event: PointerEvent) => {
      pointerDown = true;
      lastX = event.clientX;
      canvas.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!pointerDown) {
        return;
      }

      targetRotationY += (event.clientX - lastX) * 0.008;
      lastX = event.clientX;
    };
    const onPointerUp = (event: PointerEvent) => {
      pointerDown = false;
      canvas.releasePointerCapture(event.pointerId);
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const width = Math.max(rect.width, 1);
      const height = Math.max(rect.height, 1);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();

    let frameId = 0;
    const animate = () => {
      currentRotationY += (targetRotationY - currentRotationY) * 0.08;
      root.rotation.y = currentRotationY;
      sensor.rotation.z += 0.006;
      renderer.render(scene, camera);
      frameId = window.requestAnimationFrame(animate);
    };
    animate();

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      disposeObject(root);
      grid.geometry.dispose();
      if (Array.isArray(grid.material)) {
        grid.material.forEach((material) => material.dispose());
      } else {
        grid.material.dispose();
      }
      renderer.dispose();
    };
  }, [
    fillPercent,
    lengthCm,
    diameterCm,
    sensorDistanceCm,
    fuelHeightCm,
  ]);

  return (
    <div ref={containerRef} className="absolute inset-0">
      {renderMode === "fallback" ? (
        <TankFallbackVisual
          fillPercent={displayFillPercent}
          shape="cylinder"
        />
      ) : (
        <canvas
          ref={canvasRef}
          className="h-full w-full cursor-grab touch-none active:cursor-grabbing"
          aria-label={`3D visual of a horizontal cylinder tank with ${displayFillPercent}% fill`}
        />
      )}
      {showMeasurementBadges ? (
        <>
          <div className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-white/85 px-3 py-1 text-xs font-semibold text-zinc-600 ring-1 ring-zinc-200">
            H {fuelHeightCm} cm
          </div>
          <div className="pointer-events-none absolute bottom-3 right-3 rounded-full bg-white/85 px-3 py-1 text-xs font-semibold text-zinc-600 ring-1 ring-zinc-200">
            Level {displayFillPercent}%
          </div>
        </>
      ) : null}
    </div>
  );
}
