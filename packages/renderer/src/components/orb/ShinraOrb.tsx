import { Canvas } from "@react-three/fiber";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { getStation, useStationStore } from "../../stores/station-store.js";
import { OrbMesh } from "./OrbMesh.js";
import { OrbParticles } from "./OrbParticles.js";
import styles from "./ShinraOrb.module.css";

export function ShinraOrb() {
  const activeStationId = useStationStore((store) => store.activeStationId);
  const state = useStationStore((store) => getStation(store, activeStationId).state);

  return (
    <div className={styles.wrapper}>
      <Canvas
        camera={{ position: [0, 0, 4], fov: 45 }}
        gl={{ antialias: true, alpha: true }}
        dpr={[1, 2]}
        performance={{ min: 0.5 }}
      >
        <ambientLight intensity={0.5} />
        <pointLight position={[0, 0, 4]} intensity={1.6} color="#00e5ff" />
        <OrbMesh state={state} />
        <OrbParticles state={state} />
        <EffectComposer>
          <Bloom luminanceThreshold={0.2} intensity={1.5} mipmapBlur />
        </EffectComposer>
      </Canvas>
    </div>
  );
}
