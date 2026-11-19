import { useEffect, useRef } from "react";
import * as THREE from "three";

function getAuth3DColors() {
  const isLight = document.documentElement.getAttribute("data-theme") === "light";
  return isLight
    ? {
        primary: new THREE.Color("#0284c7"),
        secondary: new THREE.Color("#0f172a"),
        muted: new THREE.Color("#94a3b8"),
        fault: new THREE.Color("#e11d48"),
        ringHex: 0x94a3b8,
        gridHex: 0xcbd5e1,
      }
    : {
        primary: new THREE.Color("#38bdf8"),
        secondary: new THREE.Color("#f1f5f9"),
        muted: new THREE.Color("#334155"),
        fault: new THREE.Color("#f43f5e"),
        ringHex: 0x263044,
        gridHex: 0x182030,
      };
}

export default function AuthVisualCanvas({ mode = "login" }) {
  const mountRef = useRef(null);
  const modeRef = useRef(mode);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 620;
    const height = container.clientHeight || 560;

    let cols = getAuth3DColors();

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.set(0, 0.2, 6.8);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.innerHTML = "";
    container.appendChild(renderer.domElement);

    // Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.95));
    const keyLight = new THREE.DirectionalLight(0xf1f5f9, 2.2);
    keyLight.position.set(4, 6, 5);
    scene.add(keyLight);

    const cobaltLight = new THREE.PointLight(0x38bdf8, 3.8, 16);
    cobaltLight.position.set(-3.5, -2.5, 4);
    scene.add(cobaltLight);

    // Subtle floor reference ring
    const polarFloor = new THREE.PolarGridHelper(3.5, 10, 5, 64, cols.gridHex, cols.gridHex);
    polarFloor.position.y = -2.35;
    polarFloor.material.transparent = true;
    polarFloor.material.opacity = 0.45;
    scene.add(polarFloor);

    // =========================================================
    // MODE 1 GROUP: LOGIN — Precision Orbital Gyroscope & Core
    // =========================================================
    const loginGroup = new THREE.Group();
    scene.add(loginGroup);

    const coreGeo = new THREE.OctahedronGeometry(0.85, 0);
    const coreMat = new THREE.MeshStandardMaterial({
      color: cols.primary.clone(),
      emissive: cols.primary.clone(),
      emissiveIntensity: 0.35,
      roughness: 0.2,
      metalness: 0.85,
      transparent: true,
      opacity: 0.9,
    });
    const loginCore = new THREE.Mesh(coreGeo, coreMat);
    loginGroup.add(loginCore);

    const coreWireGeo = new THREE.IcosahedronGeometry(1.18, 1);
    const coreWireEdges = new THREE.EdgesGeometry(coreWireGeo);
    const coreWireMat = new THREE.LineBasicMaterial({
      color: cols.secondary.clone(),
      transparent: true,
      opacity: 0.38,
    });
    const loginCage = new THREE.LineSegments(coreWireEdges, coreWireMat);
    loginGroup.add(loginCage);

    // 3 Gimbal Rings
    const ring1Geo = new THREE.TorusGeometry(1.75, 0.014, 16, 100);
    const ring2Geo = new THREE.TorusGeometry(2.15, 0.012, 16, 110);
    const ring3Geo = new THREE.TorusGeometry(2.55, 0.01, 16, 120);
    const ringMat1 = new THREE.MeshBasicMaterial({ color: cols.primary.clone(), transparent: true, opacity: 0.65 });
    const ringMat2 = new THREE.MeshBasicMaterial({ color: cols.secondary.clone(), transparent: true, opacity: 0.28 });
    const ringMat3 = new THREE.MeshBasicMaterial({ color: cols.ringHex, transparent: true, opacity: 0.45 });

    const gimbal1 = new THREE.Mesh(ring1Geo, ringMat1);
    const gimbal2 = new THREE.Mesh(ring2Geo, ringMat2);
    const gimbal3 = new THREE.Mesh(ring3Geo, ringMat3);

    gimbal1.rotation.x = Math.PI * 0.32;
    gimbal2.rotation.y = Math.PI * 0.28;
    gimbal3.rotation.x = -Math.PI * 0.4;

    loginGroup.add(gimbal1, gimbal2, gimbal3);

    // Orbiting telemetry satellites on gimbal rings
    const satGeo = new THREE.SphereGeometry(0.08, 16, 16);
    const satMat1 = new THREE.MeshBasicMaterial({ color: cols.primary.clone() });
    const satMat2 = new THREE.MeshBasicMaterial({ color: cols.secondary.clone() });
    const sat1 = new THREE.Mesh(satGeo, satMat1);
    const sat2 = new THREE.Mesh(satGeo, satMat2);
    sat1.position.set(1.75, 0, 0);
    sat2.position.set(-2.15, 0, 0);
    gimbal1.add(sat1);
    gimbal2.add(sat2);

    // =========================================================
    // MODE 2 GROUP: REGISTER — Expanding AST Genesis Network
    // =========================================================
    const registerGroup = new THREE.Group();
    scene.add(registerGroup);

    const seedGeo = new THREE.OctahedronGeometry(0.36, 1);
    const seedMat = new THREE.MeshStandardMaterial({
      color: cols.primary.clone(),
      emissive: cols.primary.clone(),
      emissiveIntensity: 0.5,
      roughness: 0.2,
      metalness: 0.8,
    });
    const seedMesh = new THREE.Mesh(seedGeo, seedMat);
    registerGroup.add(seedMesh);

    const branchCount = 14;
    const branchNodes = [];
    const branchNodeGeo = new THREE.OctahedronGeometry(0.14, 0);
    const pulseGeo = new THREE.SphereGeometry(0.055, 10, 10);
    const branchSplines = [];

    for (let i = 0; i < branchCount; i++) {
      const phi = Math.acos(1 - (2 * (i + 0.5)) / branchCount);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;
      const radius = 1.65 + (i % 3) * 0.42;

      const endPos = new THREE.Vector3(
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.cos(phi) * 0.9,
        radius * Math.sin(phi) * Math.sin(theta)
      );

      const isFault = i === 3 || i === 9;
      const nodeMat = new THREE.MeshStandardMaterial({
        color: isFault ? cols.fault.clone() : cols.secondary.clone(),
        emissive: isFault ? cols.fault.clone() : cols.primary.clone(),
        emissiveIntensity: 0.35,
        roughness: 0.25,
        metalness: 0.75,
      });
      const nodeMesh = new THREE.Mesh(branchNodeGeo, nodeMat);
      nodeMesh.position.copy(endPos);
      nodeMesh.userData = { basePos: endPos.clone(), isFault, idx: i };
      registerGroup.add(nodeMesh);
      branchNodes.push(nodeMesh);

      const mid = endPos.clone().multiplyScalar(0.5);
      mid.y += i % 2 === 0 ? 0.32 : -0.32;
      const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), mid, endPos);
      const pts = curve.getPoints(24);
      const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
      const lineMat = new THREE.LineBasicMaterial({
        color: isFault ? cols.fault.clone() : cols.primary.clone(),
        transparent: true,
        opacity: 0.45,
      });
      const splineLine = new THREE.Line(lineGeo, lineMat);
      registerGroup.add(splineLine);

      const pulseMat = new THREE.MeshBasicMaterial({
        color: isFault ? cols.fault.clone() : cols.primary.clone(),
      });
      const pulse = new THREE.Mesh(pulseGeo, pulseMat);
      registerGroup.add(pulse);

      branchSplines.push({
        curve,
        lineGeo,
        lineMat,
        pulse,
        pulseMat,
        isFault,
        speed: 0.35 + (i % 4) * 0.1,
        offset: (i * 0.14) % 1,
      });
    }

    // Outer reference halo for Register
    const regHaloGeo = new THREE.TorusGeometry(2.55, 0.01, 12, 100);
    const regHaloMat = new THREE.MeshBasicMaterial({
      color: cols.ringHex,
      transparent: true,
      opacity: 0.35,
    });
    const regHalo = new THREE.Mesh(regHaloGeo, regHaloMat);
    regHalo.rotation.x = Math.PI * 0.42;
    registerGroup.add(regHalo);

    // Theme observer
    const themeObs = new MutationObserver(() => {
      cols = getAuth3DColors();
      coreMat.color.copy(cols.primary);
      coreMat.emissive.copy(cols.primary);
      coreWireMat.color.copy(cols.secondary);
      ringMat1.color.copy(cols.primary);
      ringMat2.color.copy(cols.secondary);
      ringMat3.color.setHex(cols.ringHex);
      satMat1.color.copy(cols.primary);
      satMat2.color.copy(cols.secondary);

      seedMat.color.copy(cols.primary);
      seedMat.emissive.copy(cols.primary);
      regHaloMat.color.setHex(cols.ringHex);
      branchNodes.forEach((n) => {
        const f = n.userData.isFault;
        n.material.color.copy(f ? cols.fault : cols.secondary);
        n.material.emissive.copy(f ? cols.fault : cols.primary);
      });
      branchSplines.forEach((s) => {
        s.lineMat.color.copy(s.isFault ? cols.fault : cols.primary);
        s.pulseMat.color.copy(s.isFault ? cols.fault : cols.primary);
      });
    });
    themeObs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    // Pointer Parallax
    const targetRot = { x: 0.05, y: 0 };
    const onPointerMove = (e) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      targetRot.y = x * 0.42;
      targetRot.x = -y * 0.28;
    };
    const onPointerLeave = () => {
      targetRot.x = 0.05;
      targetRot.y = 0;
    };

    const dom = renderer.domElement;
    dom.addEventListener("pointermove", onPointerMove, { passive: true });
    dom.addEventListener("pointerleave", onPointerLeave, { passive: true });

    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth || 620;
      const h = container.clientHeight || 560;
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
      const isRegister = modeRef.current === "register";

      // Smooth cross-scale transition between Login Gyroscope and Register Network
      const loginTargetScale = isRegister ? 0.001 : 1;
      const regTargetScale = isRegister ? 1 : 0.001;

      loginGroup.scale.lerp(
        new THREE.Vector3(loginTargetScale, loginTargetScale, loginTargetScale),
        0.09
      );
      registerGroup.scale.lerp(
        new THREE.Vector3(regTargetScale, regTargetScale, regTargetScale),
        0.09
      );

      loginGroup.visible = loginGroup.scale.x > 0.02;
      registerGroup.visible = registerGroup.scale.x > 0.02;

      // Animate Login Gyroscope
      loginGroup.rotation.y += (targetRot.y + Math.sin(t * 0.3) * 0.15 - loginGroup.rotation.y) * 0.06;
      loginGroup.rotation.x += (targetRot.x - loginGroup.rotation.x) * 0.06;
      loginCore.rotation.y = t * 0.55;
      loginCore.rotation.x = t * 0.3;
      loginCage.rotation.y = -t * 0.25;
      gimbal1.rotation.z = t * 0.45;
      gimbal2.rotation.x = t * 0.35;
      gimbal3.rotation.y = -t * 0.28;

      // Animate Register Genesis Network
      registerGroup.rotation.y += (targetRot.y + t * 0.16 - registerGroup.rotation.y) * 0.06;
      registerGroup.rotation.x += (targetRot.x - registerGroup.rotation.x) * 0.06;
      seedMesh.rotation.y = -t * 0.8;
      seedMesh.scale.setScalar(1 + Math.sin(t * 2.5) * 0.06);
      regHalo.rotation.z = t * 0.22;

      branchNodes.forEach((n) => {
        n.rotation.y = t * 1.1 + n.userData.idx;
      });

      branchSplines.forEach((s) => {
        const u = (t * s.speed + s.offset) % 1;
        s.pulse.position.copy(s.curve.getPointAt(u));
      });

      polarFloor.rotation.y = t * 0.06;

      renderer.render(scene, camera);
    };

    animate();

    return () => {
      cancelAnimationFrame(rafId);
      themeObs.disconnect();
      window.removeEventListener("resize", onResize);
      dom.removeEventListener("pointermove", onPointerMove);
      dom.removeEventListener("pointerleave", onPointerLeave);
      coreGeo.dispose();
      coreWireGeo.dispose();
      coreWireEdges.dispose();
      ring1Geo.dispose();
      ring2Geo.dispose();
      ring3Geo.dispose();
      satGeo.dispose();
      seedGeo.dispose();
      branchNodeGeo.dispose();
      pulseGeo.dispose();
      regHaloGeo.dispose();
      branchSplines.forEach((s) => s.lineGeo.dispose());
      renderer.dispose();
    };
  }, []);

  return (
    <div
      ref={mountRef}
      className="w-full h-full min-h-[420px] cursor-grab active:cursor-grabbing"
      aria-label={
        mode === "register"
          ? "Interactive 3D AST branch network for new workspace"
          : "Interactive 3D orbital workspace core"
      }
    />
  );
}
