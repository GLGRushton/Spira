import { useFrame } from "@react-three/fiber";
import type { AssistantState } from "@spira/shared";
import { useMemo, useRef } from "react";
import { type BufferAttribute, type BufferGeometry, Color, MathUtils, type Points, type PointsMaterial } from "three";
import { lerpOrbParams, orbStateParams } from "./orb-animations.js";

interface OrbParticlesProps {
  state: AssistantState;
}

const MAX_PARTICLES = 200;

export function OrbParticles({ state }: OrbParticlesProps) {
  const pointsRef = useRef<Points>(null);
  const geometryRef = useRef<BufferGeometry>(null);
  const positionAttributeRef = useRef<BufferAttribute>(null);
  const materialRef = useRef<PointsMaterial>(null);
  const currentParamsRef = useRef(orbStateParams.idle);
  const colorRef = useRef(new Color(...orbStateParams.idle.glowColor));

  const positions = useMemo(() => new Float32Array(MAX_PARTICLES * 3), []);
  const radii = useMemo(() => Float32Array.from({ length: MAX_PARTICLES }, () => 1.3 + Math.random() * 0.7), []);
  const inclinations = useMemo(() => Float32Array.from({ length: MAX_PARTICLES }, () => Math.random() * Math.PI), []);
  const phases = useMemo(() => Float32Array.from({ length: MAX_PARTICLES }, () => Math.random() * Math.PI * 2), []);
  const speeds = useMemo(() => Float32Array.from({ length: MAX_PARTICLES }, () => 0.45 + Math.random() * 0.7), []);

  useFrame((frameState, delta) => {
    const blend = 1 - Math.exp(-delta * 4);
    const nextParams = lerpOrbParams(currentParamsRef.current, orbStateParams[state], blend);
    currentParamsRef.current = nextParams;

    const time = frameState.clock.elapsedTime;
    const activeCount = Math.max(1, Math.min(MAX_PARTICLES, nextParams.particleCount));

    for (let index = 0; index < activeCount; index += 1) {
      const angle = phases[index] + time * speeds[index] * nextParams.particleSpeed;
      const inclination = inclinations[index] + time * 0.1;
      const radius = radii[index] * nextParams.scale;
      const offset = index * 3;

      positions[offset] = Math.cos(angle) * radius;
      positions[offset + 1] = Math.sin(inclination) * radius * 0.55;
      positions[offset + 2] = Math.sin(angle) * radius;
    }

    if (positionAttributeRef.current) {
      positionAttributeRef.current.needsUpdate = true;
    }

    if (geometryRef.current) {
      geometryRef.current.setDrawRange(0, activeCount);
    }

    colorRef.current.setRGB(nextParams.glowColor[0], nextParams.glowColor[1], nextParams.glowColor[2]);
    if (materialRef.current) {
      materialRef.current.color.copy(colorRef.current);
      materialRef.current.opacity = MathUtils.lerp(
        materialRef.current.opacity,
        0.45 + nextParams.intensity * 0.2,
        blend,
      );
      materialRef.current.size = MathUtils.lerp(materialRef.current.size, 0.03 + nextParams.intensity * 0.02, blend);
    }

    if (pointsRef.current) {
      pointsRef.current.rotation.y += nextParams.rotationSpeed * delta * 0.12;
    }
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry ref={geometryRef}>
        <bufferAttribute ref={positionAttributeRef} attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial ref={materialRef} size={0.04} color="#00e5ff" transparent opacity={0.55} depthWrite={false} />
    </points>
  );
}
