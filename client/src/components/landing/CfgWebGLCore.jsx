import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

const CFG_NODES = [
  { id: "n0", fn: "settleTransaction(tx, ledger)", pos: [0, 2.5, 0], state: "verified", metric: "Entry" },
  { id: "n1", fn: "if (!tx.signature)", pos: [-1.55, 1.45, 0.45], state: "fault", metric: "0 hits" },
  { id: "n2", fn: "verifyHmacDigest(tx)", pos: [0.1, 1.5, -0.35], state: "verified", metric: "412 hits" },
  { id: "n3", fn: "resolveCurrencyPair(tx.ccy)", pos: [1.65, 1.35, 0.3], state: "verified", metric: "412 hits" },
  { id: "n4", fn: "throw AuthSignatureError", pos: [-2.4, 0.25, 0.7], state: "fault", metric: "0 hits" },
  { id: "n5", fn: "if (ledger.locked)", pos: [-0.85, 0.2, 0.55], state: "fault", metric: "0 hits" },
  { id: "n6", fn: "computeNetSettlement(tx)", pos: [0.85, 0.25, -0.25], state: "verified", metric: "398 hits" },
  { id: "n7", fn: "if (fxSpread > limit)", pos: [2.3, 0.15, 0.45], state: "fault", metric: "0 hits" },
  { id: "n8", fn: "enqueueRetryJob(tx.id)", pos: [-1.45, -1.05, 0.4], state: "fault", metric: "0 hits" },
  { id: "n9", fn: "prisma.$transaction(commit)", pos: [0.2, -1.1, 0.15], state: "verified", metric: "398 hits" },
  { id: "n10", fn: "emitAuditSnapshot(receipt)", pos: [1.75, -1.05, -0.3], state: "verified", metric: "398 hits" },
  { id: "n11", fn: "return receipt.hash", pos: [0.15, -2.35, 0], state: "verified", metric: "Exit" },
];

const CFG_EDGES = [
  ["n0", "n1"],
  ["n0", "n2"],
  ["n0", "n3"],
  ["n1", "n4"],
  ["n1", "n5"],
  ["n2", "n5"],
  ["n2", "n6"],
  ["n3", "n6"],
  ["n3", "n7"],
  ["n5", "n8"],
  ["n5", "n9"],
  ["n6", "n9"],
  ["n6", "n10"],
  ["n7", "n10"],
  ["n8", "n11"],
  ["n9", "n11"],
  ["n10", "n11"],
];

function getThemeColors() {
  const isLight = document.documentElement.getAttribute("data-theme") === "light";
  return isLight
    ? {
        verified: new THREE.Color("#0284c7"),
        contrast: new THREE.Color("#0f172a"),
        fault: new THREE.Color("#e11d48"),
        steel: new THREE.Color("#94a3b8"),
        grid: 0xcbd5e1,
        cage: 0x94a3b8,
      }
    : {
        verified: new THREE.Color("#38bdf8"),
        contrast: new THREE.Color("#f1f5f9"),
        fault: new THREE.Color("#f43f5e"),
        steel: new THREE.Color("#334155"),
        grid: 0x1e293b,
        cage: 0x334155,
      };
}

export default function CfgWebGLCore({ scanPulse = 0, repoName = "acme/payment-kernel" }) {
  const mountRef = useRef(null);
  const [activeNode, setActiveNode] = useState(CFG_NODES[5]);
  const [manualScan, setManualScan] = useState(false);
  const scanWaveRef = useRef({ active: false, y: 3.0 });

  const resolvedTotal = scanPulse > 0 || manualScan ? 12 : 7;

  useEffect(() => {
    if (scanPulse > 0) {
      scanWaveRef.current = { active: true, y: 3.1 };
    }
  }, [scanPulse]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 580;
    const height = container.clientHeight || 540;

    let themeCols = getThemeColors();

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.set(0, 0.3, 7.6);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.innerHTML = "";
    container.appendChild(renderer.domElement);

    const world = new THREE.Group();
    scene.add(world);

    scene.add(new THREE.AmbientLight(0xffffff, 0.95));

    const topLight = new THREE.DirectionalLight(0xf1f5f9, 2.0);
    topLight.position.set(3, 6, 5);
    scene.add(topLight);

    const rimLight = new THREE.PointLight(0x38bdf8, 3.2, 18);
    rimLight.position.set(-4, -2, 4);
    scene.add(rimLight);

    const polarGrid = new THREE.PolarGridHelper(3.4, 12, 6, 64, themeCols.grid, themeCols.grid);
    polarGrid.position.y = -2.65;
    polarGrid.material.transparent = true;
    polarGrid.material.opacity = 0.55;
    world.add(polarGrid);

    const cageGeo = new THREE.IcosahedronGeometry(3.25, 1);
    const cageWire = new THREE.WireframeGeometry(cageGeo);
    const cageMat = new THREE.LineBasicMaterial({
      color: themeCols.cage,
      transparent: true,
      opacity: 0.16,
    });
    const cageMesh = new THREE.LineSegments(cageWire, cageMat);
    world.add(cageMesh);

    const scanGeo = new THREE.RingGeometry(0.2, 3.3, 64);
    const scanMat = new THREE.MeshBasicMaterial({
      color: themeCols.verified.clone(),
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0,
    });
    const scanDisc = new THREE.Mesh(scanGeo, scanMat);
    scanDisc.rotation.x = Math.PI / 2;
    world.add(scanDisc);

    const coreGeo = new THREE.OctahedronGeometry(0.18, 1);
    const shellGeo = new THREE.OctahedronGeometry(0.28, 0);
    const nodeMap = {};
    const pickMeshes = [];

    CFG_NODES.forEach((n) => {
      const isFault = n.state === "fault";
      const baseColor = isFault ? themeCols.fault : themeCols.verified;

      const coreMat = new THREE.MeshStandardMaterial({
        color: baseColor.clone(),
        emissive: baseColor.clone(),
        emissiveIntensity: 0.45,
        roughness: 0.25,
        metalness: 0.75,
      });
      const coreMesh = new THREE.Mesh(coreGeo, coreMat);
      coreMesh.position.set(...n.pos);

      const shellMat = new THREE.MeshBasicMaterial({
        color: isFault ? themeCols.fault.clone() : themeCols.contrast.clone(),
        wireframe: true,
        transparent: true,
        opacity: 0.42,
      });
      const shellMesh = new THREE.Mesh(shellGeo, shellMat);
      coreMesh.add(shellMesh);

      coreMesh.userData = {
        ...n,
        currentState: n.state,
        shellMesh,
      };

      world.add(coreMesh);
      nodeMap[n.id] = coreMesh;
      pickMeshes.push(coreMesh);
    });

    const edges = [];
    const pulseGeo = new THREE.BoxGeometry(0.07, 0.07, 0.07);

    CFG_EDGES.forEach(([fromId, toId], idx) => {
      const fromMesh = nodeMap[fromId];
      const toMesh = nodeMap[toId];
      if (!fromMesh || !toMesh) return;

      const p0 = fromMesh.position.clone();
      const p2 = toMesh.position.clone();
      const mid = p0.clone().lerp(p2, 0.5);
      mid.z += idx % 2 === 0 ? 0.25 : -0.25;

      const curve = new THREE.QuadraticBezierCurve3(p0, mid, p2);
      const pts = curve.getPoints(30);
      const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);

      const isFaultEdge =
        fromMesh.userData.state === "fault" || toMesh.userData.state === "fault";

      const lineMat = new THREE.LineBasicMaterial({
        color: isFaultEdge ? themeCols.fault.clone() : themeCols.steel.clone(),
        transparent: true,
        opacity: isFaultEdge ? 0.65 : 0.45,
      });
      const line = new THREE.Line(lineGeo, lineMat);
      world.add(line);

      const pulseMat = new THREE.MeshBasicMaterial({
        color: isFaultEdge ? themeCols.fault.clone() : themeCols.contrast.clone(),
      });
      const pulse = new THREE.Mesh(pulseGeo, pulseMat);
      world.add(pulse);

      edges.push({
        curve,
        lineMat,
        pulse,
        pulseMat,
        fromMesh,
        toMesh,
        speed: 0.25 + (idx % 5) * 0.06,
        phase: (idx * 0.19) % 1,
      });
    });

    const themeObserver = new MutationObserver(() => {
      themeCols = getThemeColors();
      cageMat.color.setHex(themeCols.cage);
      scanMat.color.copy(themeCols.verified);
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    const pointer = new THREE.Vector2(99, 99);
    const targetRot = { x: 0.06, y: -0.18 };
    const raycaster = new THREE.Raycaster();

    const onPointerMove = (e) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      pointer.set(x, y);
      targetRot.y = x * 0.45;
      targetRot.x = -y * 0.25;
    };

    const onPointerLeave = () => {
      pointer.set(99, 99);
      targetRot.x = 0.06;
      targetRot.y = -0.18;
    };

    const dom = renderer.domElement;
    dom.addEventListener("pointermove", onPointerMove, { passive: true });
    dom.addEventListener("pointerleave", onPointerLeave, { passive: true });

    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth || 580;
      const h = container.clientHeight || 540;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    let frameId;
    const clock = new THREE.Clock();

    const animate = () => {
      frameId = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();

      const driftY = Math.sin(t * 0.32) * 0.22;
      world.rotation.y += (targetRot.y + driftY - world.rotation.y) * 0.06;
      world.rotation.x += (targetRot.x - world.rotation.x) * 0.06;

      cageMesh.rotation.y = -t * 0.05;
      cageMesh.rotation.x = t * 0.03;
      polarGrid.rotation.y = t * 0.08;

      if (scanWaveRef.current.active) {
        scanWaveRef.current.y -= 0.05;
        const wy = scanWaveRef.current.y;
        scanDisc.position.y = wy;
        scanMat.opacity = Math.max(0, 0.5 - Math.abs(wy) * 0.13);

        pickMeshes.forEach((m) => {
          if (m.position.y >= wy) {
            m.userData.currentState = "verified";
          }
        });

        if (wy < -3.0) {
          scanWaveRef.current.active = false;
          scanMat.opacity = 0;
        }
      }

      if (pointer.x !== 99) {
        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObjects(pickMeshes, false);
        if (hits.length > 0) {
          const hit = hits[0].object;
          if (hit.userData.currentState === "fault") {
            hit.userData.currentState = "verified";
          }
          setActiveNode((prev) =>
            prev?.id === hit.userData.id
              ? prev
              : {
                  id: hit.userData.id,
                  fn: hit.userData.fn,
                  metric: hit.userData.metric,
                  state: hit.userData.currentState,
                }
          );
        }
      }

      pickMeshes.forEach((mesh, i) => {
        const isFault = mesh.userData.currentState === "fault";
        const col = isFault ? themeCols.fault : themeCols.verified;

        mesh.material.color.lerp(col, 0.08);
        mesh.material.emissive.lerp(col, 0.08);
        mesh.userData.shellMesh.material.color.lerp(
          isFault ? themeCols.fault : themeCols.contrast,
          0.08
        );

        mesh.rotation.y = t * 0.8 + i;
        mesh.userData.shellMesh.rotation.x = -t * 1.1;
      });

      edges.forEach((e) => {
        const resolved =
          e.fromMesh.userData.currentState === "verified" &&
          e.toMesh.userData.currentState === "verified";

        e.lineMat.color.lerp(resolved ? themeCols.verified : themeCols.fault, 0.08);
        e.pulseMat.color.lerp(resolved ? themeCols.contrast : themeCols.fault, 0.12);

        const u = (t * e.speed + e.phase) % 1;
        e.pulse.position.copy(e.curve.getPointAt(u));
        e.pulse.rotation.x = t * 2.5;
        e.pulse.rotation.y = t * 2.5;
      });

      renderer.render(scene, camera);
    };

    animate();

    return () => {
      cancelAnimationFrame(frameId);
      themeObserver.disconnect();
      window.removeEventListener("resize", onResize);
      dom.removeEventListener("pointermove", onPointerMove);
      dom.removeEventListener("pointerleave", onPointerLeave);
      coreGeo.dispose();
      shellGeo.dispose();
      pulseGeo.dispose();
      cageGeo.dispose();
      cageWire.dispose();
      scanGeo.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <div className="relative w-full h-[460px] sm:h-[540px] rounded-xl lp-machined overflow-hidden select-none">
      {/* Top Technical Telemetry Bar */}
      <div className="absolute top-0 inset-x-0 z-10 px-4 py-3 border-b border-[var(--lp-line)] bg-[var(--lp-surface-glass)] backdrop-blur-md flex items-center justify-between text-xs lp-mono">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-2 h-2 rounded-full bg-[var(--lp-signal)] shrink-0" />
          <span className="text-[var(--lp-ink)] font-medium truncate">{repoName}</span>
          <span className="text-[var(--lp-ink-muted)]">/</span>
          <span className="text-[var(--lp-ink-secondary)] hidden sm:inline">AST Control Flow Graph</span>
        </div>

        <div className="hidden sm:flex items-center gap-4 text-[11px] shrink-0">
          <span className="flex items-center gap-1.5 text-[var(--lp-ink)]">
            <span className="w-2 h-2 rounded-full bg-[var(--lp-signal)]" />
            Verified ({resolvedTotal}/12)
          </span>
          <span className="flex items-center gap-1.5 text-[var(--lp-ink-secondary)]">
            <span className="w-2 h-2 rounded-full bg-[var(--lp-fault)]" />
            Untested ({12 - resolvedTotal})
          </span>
        </div>
      </div>

      {/* Three.js WebGL Stage */}
      <div
        ref={mountRef}
        className="w-full h-full cursor-grab active:cursor-grabbing"
        aria-label="Interactive 3D Control Flow Graph Canvas"
      />

      {/* Bottom Node Readout Bar */}
      <div className="absolute bottom-3.5 inset-x-3.5 z-10 px-4 py-3 rounded-lg bg-[var(--lp-surface-glass)] border border-[var(--lp-line-strong)] backdrop-blur-md flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] lp-mono text-[var(--lp-ink-muted)]">
            Focused AST node ({activeNode?.id?.toUpperCase()})
          </div>
          <div className="text-xs sm:text-sm lp-mono text-[var(--lp-ink)] truncate mt-0.5">
            {activeNode?.fn}
          </div>
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
          <span className="text-xs lp-mono text-[var(--lp-signal)] font-semibold">
            {resolvedTotal === 12 ? "98.4% branch coverage" : "58.3% branch coverage"}
          </span>
          <button
            type="button"
            onClick={() => {
              scanWaveRef.current = { active: true, y: 3.1 };
              setManualScan(true);
            }}
            className="px-3 py-1.5 rounded-md lp-btn-secondary text-xs lp-mono cursor-pointer"
          >
            Sweep 3D graph
          </button>
        </div>
      </div>
    </div>
  );
}
