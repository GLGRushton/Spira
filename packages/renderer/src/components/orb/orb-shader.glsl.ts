export const orbVertexShader = `
  uniform float uTime;
  uniform float uAudioLevel;
  uniform float uIntensity;
  varying vec3 vNormal;
  varying vec3 vPosition;

  void main() {
    vNormal = normalize(normalMatrix * normal);
    vPosition = position;

    float displacement = sin(position.x * 5.0 + uTime) * 0.05 * uIntensity;
    displacement += sin(position.y * 4.0 + uTime * 1.3) * 0.03 * uAudioLevel;

    vec3 displaced = position + normal * displacement;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
  }
`;

export const orbFragmentShader = `
  uniform float uTime;
  uniform vec3 uColor;
  uniform vec3 uGlowColor;
  uniform float uAudioLevel;
  varying vec3 vNormal;
  varying vec3 vPosition;

  void main() {
    float fresnel = pow(1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 2.0);

    float plasma = sin(vPosition.x * 8.0 + uTime * 2.0) *
                   sin(vPosition.y * 8.0 + uTime * 1.5) *
                   sin(vPosition.z * 8.0 + uTime * 1.7);
    plasma = plasma * 0.5 + 0.5;

    vec3 color = mix(uColor, uGlowColor, fresnel + plasma * 0.3);
    float alpha = 0.7 + fresnel * 0.3 + uAudioLevel * 0.1;

    gl_FragColor = vec4(color, alpha);
  }
`;
