import { useFrame } from "@react-three/fiber";
import type { AssistantState } from "@spira/shared";
import { useMemo, useRef } from "react";
import { AdditiveBlending, Color, MathUtils, type Mesh, type MeshBasicMaterial, type ShaderMaterial } from "three";
import { useAudioStore } from "../../stores/audio-store.js";
import { lerpOrbParamsMut, orbStateParams } from "./orb-animations.js";
import { orbFragmentShader, orbVertexShader } from "./orb-shader.glsl.js";

interface OrbMeshProps {
  state: AssistantState;
}

export function OrbMesh({ state }: OrbMeshProps) {
  const shellRef = useRef<Mesh>(null);
  const glowRef = useRef<Mesh>(null);
  const materialRef = useRef<ShaderMaterial>(null);
  const currentParamsRef = useRef({
    color: [...orbStateParams.idle.color] as [number, number, number],
    glowColor: [...orbStateParams.idle.glowColor] as [number, number, number],
    intensity: orbStateParams.idle.intensity,
    rotationSpeed: orbStateParams.idle.rotationSpeed,
    particleCount: orbStateParams.idle.particleCount,
    particleSpeed: orbStateParams.idle.particleSpeed,
    scale: orbStateParams.idle.scale,
  });
  const colorRef = useRef(new Color());
  const glowColorRef = useRef(new Color());
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uAudioLevel: { value: 0 },
      uIntensity: { value: orbStateParams.idle.intensity },
      uColor: { value: new Color(...orbStateParams.idle.color) },
      uGlowColor: { value: new Color(...orbStateParams.idle.glowColor) },
    }),
    [],
  );

  useFrame((frameState, delta) => {
    const blend = 1 - Math.exp(-delta * 5);
    lerpOrbParamsMut(currentParamsRef.current, currentParamsRef.current, orbStateParams[state], blend);
    const nextParams = currentParamsRef.current;

    const { audioLevel, ttsAmplitude } = useAudioStore.getState();
    const combinedAudio = Math.max(audioLevel, ttsAmplitude);
    uniforms.uTime.value = frameState.clock.elapsedTime;
    uniforms.uIntensity.value = nextParams.intensity;
    uniforms.uAudioLevel.value = MathUtils.lerp(uniforms.uAudioLevel.value, combinedAudio, blend * 1.4);

    colorRef.current.setRGB(nextParams.color[0], nextParams.color[1], nextParams.color[2]);
    glowColorRef.current.setRGB(nextParams.glowColor[0], nextParams.glowColor[1], nextParams.glowColor[2]);
    uniforms.uColor.value.copy(colorRef.current);
    uniforms.uGlowColor.value.copy(glowColorRef.current);

    if (shellRef.current) {
      shellRef.current.rotation.y += nextParams.rotationSpeed * delta;
      shellRef.current.rotation.x += nextParams.rotationSpeed * delta * 0.45;
      const shellScale = MathUtils.lerp(shellRef.current.scale.x, nextParams.scale, blend);
      shellRef.current.scale.setScalar(shellScale);
    }

    if (glowRef.current) {
      const glowScale = MathUtils.lerp(glowRef.current.scale.x, nextParams.scale * 1.18, blend);
      glowRef.current.scale.setScalar(glowScale);
      glowRef.current.rotation.y -= nextParams.rotationSpeed * delta * 0.25;
      const glowMaterial = glowRef.current.material as MeshBasicMaterial;
      glowMaterial.color.copy(glowColorRef.current);
    }
  });

  return (
    <group>
      <mesh ref={glowRef}>
        <icosahedronGeometry args={[1.12, 3]} />
        <meshBasicMaterial color="#00e5ff" transparent opacity={0.16} blending={AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh ref={shellRef}>
        <icosahedronGeometry args={[1, 4]} />
        <shaderMaterial
          ref={materialRef}
          transparent
          depthWrite={false}
          blending={AdditiveBlending}
          vertexShader={orbVertexShader}
          fragmentShader={orbFragmentShader}
          uniforms={uniforms}
        />
      </mesh>
    </group>
  );
}
