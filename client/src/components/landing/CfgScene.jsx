import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Hero WebGL scene: a Control Flow Graph floating in 3D.
 * One execution path is already covered (emerald); the remaining branches
 * start uncovered (rose) and flip to covered one by one as "generated tests"
 * reach them. The loop restarts every CYCLE seconds.
 *
 * Lazy-loaded by LandingHero so three.js never lands in the main bundle.
 */

const CYCLE = 12; // seconds per coverage loop
const START = 2; // first generated test lands at this time
const STEP = 0.9; // delay between newly covered nodes

// kind: "terminal" (entry/exit) | "decision" (branch) | "stmt"
// order: undefined = covered by existing tests, n = n-th node covered by AI
const NODES = [
  { p: [0, 3.3, 0], kind: "terminal" },
  { p: [0, 2.1, 0], kind: "decision" },
  { p: [-1.6, 1.0, 0.5], kind: "stmt" },
  { p: [1.6, 1.0, -0.4], kind: "decision", order: 1 },
  { p: [-2.4, -0.2, -0.3], kind: "stmt" },
  { p: [-0.9, -0.2, 0.9], kind: "stmt", order: 0 },
  { p: [0.8, -0.2, 0.6], kind: "stmt", order: 2 },
  { p: [2.4, -0.2, -0.8], kind: "decision", order: 3 },
  { p: [1.7, -1.4, 0.2], kind: "stmt", order: 4 },
  { p: [3.1, -1.4, -0.6], kind: "stmt", order: 5 },
  { p: [-1.6, -1.5, 0.3], kind: "stmt" },
  { p: [1.4, -2.5, 0], kind: "stmt", order: 6 },
  { p: [0, -3.5, 0], kind: "terminal" },
];

const EDGES = [
  [0, 1], [1, 2], [1, 3], [2, 4], [2, 5], [3, 6], [3, 7], [7, 8],
  [7, 9], [4, 10], [5, 10], [6, 11], [8, 11], [9, 11], [10, 12], [11, 12],
];

const PASS = new THREE.Color("#34d399");
const FAIL = new THREE.Color("#fb7185");
const EDGE_IDLE = new THREE.Color("#4a4470");

const coverTime = (node) =>
  node.order === undefined ? 0 : START + node.order * STEP;

function Graph({ onCoverage, reduced }) {
  const group = useRef(null);
  const meshes = useRef([]);
  const lastCount = useRef(-1);

  const lines = useMemo(
    () =>
      EDGES.map(([a, b]) => {
        const geometry = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(...NODES[a].p),
          new THREE.Vector3(...NODES[b].p),
        ]);
        const material = new THREE.LineBasicMaterial({
          color: EDGE_IDLE.clone(),
          transparent: true,
          opacity: 0.75,
        });
        return new THREE.Line(geometry, material);
      }),
    [],
  );

  const stars = useMemo(() => {
    const positions = new Float32Array(140 * 3);
    // deterministic pseudo-random so renders stay pure
    let seed = 7;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] = (rand() - 0.5) * 16;
      positions[i + 1] = (rand() - 0.5) * 14;
      positions[i + 2] = (rand() - 0.5) * 8 - 2;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return geometry;
  }, []);

  useEffect(
    () => () => {
      lines.forEach((line) => {
        line.geometry.dispose();
        line.material.dispose();
      });
      stars.dispose();
    },
    [lines, stars],
  );

  useFrame((state) => {
    const elapsed = state.clock.elapsedTime;
    // reduced motion: freeze on the fully-covered frame
    const t = reduced ? CYCLE - 1 : elapsed % CYCLE;
    const coveredFlags = [];
    let covered = 0;

    NODES.forEach((node, i) => {
      const at = coverTime(node);
      const isCovered = t >= at;
      coveredFlags.push(isCovered);
      if (isCovered) covered += 1;

      const mesh = meshes.current[i];
      if (!mesh) return;
      const target = isCovered ? PASS : FAIL;
      mesh.material.color.lerp(target, 0.1);
      mesh.material.emissive.lerp(target, 0.1);
      // pop when a node has just been covered
      const pop = isCovered && node.order !== undefined
        ? Math.max(0, 1 - (t - at) * 1.6)
        : 0;
      const breathe = reduced ? 0 : Math.sin(elapsed * 1.5 + i) * 0.04;
      mesh.scale.setScalar(1 + pop * 0.6 + breathe);
      mesh.material.emissiveIntensity = 0.9 + pop * 1.4;
      if (node.kind !== "stmt" && !reduced) mesh.rotation.y = elapsed * 0.6;
    });

    EDGES.forEach(([a, b], i) => {
      const hit = coveredFlags[a] && coveredFlags[b];
      lines[i].material.color.lerp(hit ? PASS : EDGE_IDLE, 0.1);
    });

    if (group.current) {
      const sway = reduced ? 0.35 : Math.sin(elapsed * 0.25) * 0.55;
      const targetY = sway + state.pointer.x * 0.45;
      const targetX = -state.pointer.y * 0.22;
      group.current.rotation.y += (targetY - group.current.rotation.y) * 0.05;
      group.current.rotation.x += (targetX - group.current.rotation.x) * 0.05;
      if (!reduced) group.current.position.y = Math.sin(elapsed * 0.8) * 0.12;
    }

    if (covered !== lastCount.current) {
      lastCount.current = covered;
      onCoverage?.(Math.round((covered / NODES.length) * 100));
    }
  });

  return (
    <>
      <points geometry={stars}>
        <pointsMaterial
          color="#a89cff"
          size={0.035}
          transparent
          opacity={0.55}
          sizeAttenuation
        />
      </points>
      <group ref={group} scale={0.92}>
        {lines.map((line, i) => (
          <primitive key={i} object={line} />
        ))}
        {NODES.map((node, i) => (
          <mesh
            key={i}
            position={node.p}
            ref={(el) => {
              meshes.current[i] = el;
            }}
          >
            {node.kind === "decision" && <octahedronGeometry args={[0.36, 0]} />}
            {node.kind === "terminal" && <boxGeometry args={[0.44, 0.44, 0.44]} />}
            {node.kind === "stmt" && <sphereGeometry args={[0.25, 28, 28]} />}
            <meshStandardMaterial
              color="#fb7185"
              emissive="#fb7185"
              emissiveIntensity={0.9}
              roughness={0.3}
              metalness={0.25}
              flatShading={node.kind !== "stmt"}
            />
          </mesh>
        ))}
      </group>
    </>
  );
}

export default function CfgScene({ onCoverage, reduced = false }) {
  return (
    <Canvas
      dpr={[1, 1.75]}
      camera={{ position: [0, 0, 11], fov: 38 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      aria-hidden="true"
    >
      <ambientLight intensity={0.35} />
      <pointLight position={[6, 6, 8]} intensity={22} color="#ffffff" />
      <pointLight position={[-6, -4, 6]} intensity={14} color="#a89cff" />
      <Graph onCoverage={onCoverage} reduced={reduced} />
    </Canvas>
  );
}
