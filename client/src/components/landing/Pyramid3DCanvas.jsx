import { useEffect, useRef } from "react";
import * as THREE from "three";

export default function Pyramid3DCanvas({ activeTier = "unit" }) {
  const containerRef = useRef(null);
  const activeTierRef = useRef(activeTier);

  useEffect(() => {
    activeTierRef.current = activeTier;
  }, [activeTier]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || 380;
    const height = container.clientHeight || 260;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 50);
    camera.position.set(0, 0.7, 5.4);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.innerHTML = "";
    container.appendChild(renderer.domElement);

    const group = new THREE.Group();
    scene.add(group);

    scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const dirLight = new THREE.DirectionalLight(0xf1f5f9, 2.4);
    dirLight.position.set(3, 5, 4);
    scene.add(dirLight);

    const pointLight = new THREE.PointLight(0x38bdf8, 3.2, 12);
    pointLight.position.set(-2, 1, 3);
    scene.add(pointLight);

    // 3 Pyramid Tiers (4-sided frustums using CylinderGeometry with 4 radial segments)
    const tiersConfig = [
      { id: "system", rTop: 0.08, rBottom: 0.72, h: 0.58, baseY: 1.02 },
      { id: "integration", rTop: 0.82, rBottom: 1.38, h: 0.58, baseY: 0.18 },
      { id: "unit", rTop: 1.48, rBottom: 2.05, h: 0.58, baseY: -0.66 },
    ];

    const tierMeshes = [];
    const colorActive = new THREE.Color("#38bdf8");
    const colorIdle = new THREE.Color("#1e293b");
    const wireActive = new THREE.Color("#f1f5f9");
    const wireIdle = new THREE.Color("#475569");

    tiersConfig.forEach((cfg) => {
      const geo = new THREE.CylinderGeometry(cfg.rTop, cfg.rBottom, cfg.h, 4, 1);
      const mat = new THREE.MeshStandardMaterial({
        color: colorIdle.clone(),
        emissive: colorIdle.clone(),
        emissiveIntensity: 0.35,
        roughness: 0.25,
        metalness: 0.75,
        transparent: true,
        opacity: 0.82,
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = cfg.baseY;
      mesh.rotation.y = Math.PI / 4;

      const edgesGeo = new THREE.EdgesGeometry(geo);
      const lineMat = new THREE.LineBasicMaterial({
        color: wireIdle.clone(),
        transparent: true,
        opacity: 0.75,
      });
      const wireframe = new THREE.LineSegments(edgesGeo, lineMat);
      mesh.add(wireframe);

      mesh.userData = {
        ...cfg,
        wireframe,
        lineMat,
        geo,
        edgesGeo,
      };

      group.add(mesh);
      tierMeshes.push(mesh);
    });

    // Vertical Core Axis Spine
    const spineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, -1.5, 0),
      new THREE.Vector3(0, 1.75, 0),
    ]);
    const spineMat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.35,
    });
    const spine = new THREE.Line(spineGeo, spineMat);
    group.add(spine);

    // Base Orbit Ring
    const ringGeo = new THREE.RingGeometry(1.9, 1.93, 64);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x334155,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.5,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -1.15;
    group.add(ring);

    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth || 380;
      const h = container.clientHeight || 260;
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

      group.rotation.y = t * 0.38;

      tierMeshes.forEach((m) => {
        const isSelected = m.userData.id === activeTierRef.current;
        const targetColor = isSelected ? colorActive : colorIdle;
        const targetWire = isSelected ? wireActive : wireIdle;
        const targetScale = isSelected ? 1.07 : 0.96;
        const liftOffset = isSelected ? Math.sin(t * 3) * 0.04 + 0.08 : 0;

        m.material.color.lerp(targetColor, 0.08);
        m.material.emissive.lerp(targetColor, 0.08);
        m.material.emissiveIntensity = isSelected ? 0.6 : 0.15;
        m.userData.lineMat.color.lerp(targetWire, 0.1);

        m.scale.lerp(new THREE.Vector3(targetScale, 1, targetScale), 0.08);
        m.position.y += (m.userData.baseY + liftOffset - m.position.y) * 0.1;
      });

      renderer.render(scene, camera);
    };

    animate();

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onResize);
      tierMeshes.forEach((m) => {
        m.userData.geo.dispose();
        m.userData.edgesGeo.dispose();
      });
      spineGeo.dispose();
      ringGeo.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="w-full h-[230px] sm:h-[260px]"
      aria-label="3D Three-Tier Test Architecture Sculpture"
    />
  );
}
