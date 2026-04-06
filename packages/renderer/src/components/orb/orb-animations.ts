import type { AssistantState } from "@spira/shared";

export interface OrbParams {
  color: [number, number, number];
  glowColor: [number, number, number];
  intensity: number;
  rotationSpeed: number;
  particleCount: number;
  particleSpeed: number;
  scale: number;
}

export const orbStateParams: Record<AssistantState, OrbParams> = {
  idle: {
    color: [0, 0.83, 0.67],
    glowColor: [0, 0.9, 1],
    intensity: 0.3,
    rotationSpeed: 0.3,
    particleCount: 80,
    particleSpeed: 0.3,
    scale: 1,
  },
  thinking: {
    color: [0.49, 0.23, 0.93],
    glowColor: [0.7, 0.4, 1],
    intensity: 0.8,
    rotationSpeed: 1.2,
    particleCount: 200,
    particleSpeed: 1.2,
    scale: 1.1,
  },
  listening: {
    color: [0, 0.9, 1],
    glowColor: [0, 0.83, 0.67],
    intensity: 0.6,
    rotationSpeed: 0.8,
    particleCount: 150,
    particleSpeed: 0.8,
    scale: 1.05,
  },
  transcribing: {
    color: [0, 0.9, 1],
    glowColor: [0.49, 0.23, 0.93],
    intensity: 0.7,
    rotationSpeed: 1,
    particleCount: 160,
    particleSpeed: 1,
    scale: 1.05,
  },
  speaking: {
    color: [0.8, 0.6, 0],
    glowColor: [1, 0.8, 0],
    intensity: 0.9,
    rotationSpeed: 0.6,
    particleCount: 120,
    particleSpeed: 1.5,
    scale: 1.15,
  },
  error: {
    color: [0.94, 0.27, 0.27],
    glowColor: [1, 0.4, 0.4],
    intensity: 0.4,
    rotationSpeed: 0.2,
    particleCount: 60,
    particleSpeed: 0.2,
    scale: 0.95,
  },
};

const lerp = (from: number, to: number, t: number) => from + (to - from) * t;

export function lerpOrbParams(from: OrbParams, to: OrbParams, t: number): OrbParams {
  return {
    color: [
      lerp(from.color[0], to.color[0], t),
      lerp(from.color[1], to.color[1], t),
      lerp(from.color[2], to.color[2], t),
    ],
    glowColor: [
      lerp(from.glowColor[0], to.glowColor[0], t),
      lerp(from.glowColor[1], to.glowColor[1], t),
      lerp(from.glowColor[2], to.glowColor[2], t),
    ],
    intensity: lerp(from.intensity, to.intensity, t),
    rotationSpeed: lerp(from.rotationSpeed, to.rotationSpeed, t),
    particleCount: Math.round(lerp(from.particleCount, to.particleCount, t)),
    particleSpeed: lerp(from.particleSpeed, to.particleSpeed, t),
    scale: lerp(from.scale, to.scale, t),
  };
}

export function lerpOrbParamsMut(out: OrbParams, from: OrbParams, to: OrbParams, t: number): void {
  out.color[0] = lerp(from.color[0], to.color[0], t);
  out.color[1] = lerp(from.color[1], to.color[1], t);
  out.color[2] = lerp(from.color[2], to.color[2], t);
  out.glowColor[0] = lerp(from.glowColor[0], to.glowColor[0], t);
  out.glowColor[1] = lerp(from.glowColor[1], to.glowColor[1], t);
  out.glowColor[2] = lerp(from.glowColor[2], to.glowColor[2], t);
  out.intensity = lerp(from.intensity, to.intensity, t);
  out.rotationSpeed = lerp(from.rotationSpeed, to.rotationSpeed, t);
  out.particleCount = Math.round(lerp(from.particleCount, to.particleCount, t));
  out.particleSpeed = lerp(from.particleSpeed, to.particleSpeed, t);
  out.scale = lerp(from.scale, to.scale, t);
}
