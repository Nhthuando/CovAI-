import { useEffect, useRef } from "react";
import * as THREE from "three";

const NODE_COUNT = 27;

function computeStageTargets(stageIndex) {
  const targets = [];

  for (let i = 0; i < NODE_COUNT; i++) {
    if (stageIndex === 0) {
      const ix = (i % 3) - 1;
      const iy = (Math.floor(i / 3) % 3) - 1;
      const iz = Math.floor(i / 9) - 1;
      targets.push({
        pos: new THREE.Vector3(ix * 0.95, iy * 0.95, iz * 0.95),
        fault: false,
      });
    } else if (stageIndex === 1) {
      const level = Math.floor(Math.log2(i + 1));
      const indexInLevel = i - (Math.pow(2, level) - 1);
      const maxInLevel = Math.pow(2, level);
      const spread = 2.8;
      const x =
        maxInLevel <= 1
          ? 0
          : ((indexInLevel / (maxInLevel - 1)) - 0.5) * spread * (1 + level * 0.18);
      const y = 1.65 - level * 0.85;
      const z = ((i % 3) - 1) * 0.45;
      targets.push({
        pos: new THREE.Vector3(x, y, z),
        fault: i === 5 || i === 9 || i === 14 || i === 19 || i === 23,
      });
    } else if (stageIndex === 2) {
      const angle = i * 0.52;
      const radius = 1.35 + (i % 2) * 0.35;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const y = ((i / (NODE_COUNT - 1)) - 0.5) * 3.1;
      targets.push({
        pos: new THREE.Vector3(x, y, z),
        fault: false,
      });
    } else {
      const phi = Math.acos(1 - (2 * (i + 0.5)) / NODE_COUNT);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;
      const r = 1.65;
      targets.push({
        pos: new THREE.Vector3(
          r * Math.sin(phi) * Math.cos(theta),
          r * Math.cos(phi),
          r * Math.sin(phi) * Math.sin(theta)
        ),
        fault: false,
      });
    }
  }

  return targets;
}

function getPipelineColors() {
  const isLight = document.documentElement.getAttribute("data-theme") === "light";
  return isLight
    ? {
        signal: new THREE.Color("#0284c7"),
        contrast: new THREE.Color("#0f172a"),
        fault: new THREE.Color("#e11d48"),
        lineHex: 0x94a3b8,
      }
    : {
        signal: new THREE.Color("#38bdf8"),
        contrast: new THREE.Color("#f1f5f9"),
        fault: new THREE.Color("#f43f5e"),
        lineHex: 0x334155,
      };
}

export default function Pipeline3DStage({ activeStage = 0 }) {
  const mountRef = useRef(null);
  const stageRef = useRef(activeStage);

  useEffect(() => {
    stageRef.current = activeStage;
  }, [activeStage]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 460;
    const height = container.clientHeight || 240;

    let cols = getPipelineColors();

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 50);
    camera.position.set(0, 0.4, 5.6);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.innerHTML = "";
    container.appendChild(renderer.domElement);

    const root = new THREE.Group();
    scene.add(root);

    scene.add(new THREE.AmbientLight(0xffffff, 0.95));
    const keyLight = new THREE.DirectionalLight(0xf1f5f9, 2.0);
    keyLight.position.set(4, 5, 4);
    scene.add(keyLight);

    const cobaltLight = new THREE.PointLight(0x38bdf8, 3.0, 14);
    cobaltLight.position.set(-3, -2, 3);
    scene.add(cobaltLight);

    const nodeGeo = new THREE.OctahedronGeometry(0.13, 0);
    const nodes = [];
    const initialTargets = computeStageTargets(0);

    for (let i = 0; i < NODE_COUNT; i++) {
      const mat = new THREE.MeshStandardMaterial({
        color: cols.signal.clone(),
        emissive: cols.signal.clone(),
        emissiveIntensity: 0.35,
        roughness: 0.25,
        metalness: 0.75,
      });
      const mesh = new THREE.Mesh(nodeGeo, mat);
      mesh.position.copy(initialTargets[i].pos);
      root.add(mesh);
      nodes.push(mesh);
    }

    const linePositions = new Float32Array((NODE_COUNT - 1) * 6);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute("position", new THREE.BufferAttribute(linePositions, 3));
    const lineMat = new THREE.LineBasicMaterial({
      color: cols.lineHex,
      transparent: true,
      opacity: 0.55,
    });
    const connectorLines = new THREE.LineSegments(lineGeo, lineMat);
    root.add(connectorLines);

    const observer = new MutationObserver(() => {
      cols = getPipelineColors();
      lineMat.color.setHex(cols.lineHex);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth || 460;
      const h = container.clientHeight || 240;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    let rafId;
    const clock = new THREE.Clock();

    const animate = () => {
      rafId = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();

      const targets = computeStageTargets(stageRef.current);

      root.rotation.y = t * 0.35;
      root.rotation.x = Math.sin(t * 0.4) * 0.14;

      nodes.forEach((mesh, i) => {
        const target = targets[i];
        mesh.position.lerp(target.pos, 0.075);
        mesh.rotation.y = t * 1.4 + i;

        const targetCol = target.fault
          ? cols.fault
          : stageRef.current === 3
            ? cols.contrast
            : cols.signal;

        mesh.material.color.lerp(targetCol, 0.08);
        mesh.material.emissive.lerp(targetCol, 0.08);
      });

      const posAttr = lineGeo.attributes.position;
      for (let i = 0; i < NODE_COUNT - 1; i++) {
        const a = nodes[i].position;
        const b = nodes[i + 1].position;
        posAttr.setXYZ(i * 2, a.x, a.y, a.z);
        posAttr.setXYZ(i * 2 + 1, b.x, b.y, b.z);
      }
      posAttr.needsUpdate = true;

      renderer.render(scene, camera);
    };

    animate();

    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
      window.removeEventListener("resize", onResize);
      nodeGeo.dispose();
      lineGeo.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <div
      ref={mountRef}
      className="w-full h-[210px] sm:h-[240px] rounded-xl bg-[var(--lp-inset)] border border-[var(--lp-line)]"
      aria-label="3D Morphing Pipeline Geometry Canvas"
    />
  );
}
