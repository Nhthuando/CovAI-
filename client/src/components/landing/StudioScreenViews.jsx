import {
  FileCode2,
  FolderOpen,
  GitBranch,
  CheckCircle2,
  Play,
  Network,
  BarChart3,
  ListOrdered,
  Terminal,
  ShieldCheck,
  ArrowRight,
  Database,
  Server,
  Globe,
  Cpu,
} from "lucide-react";

const EXPLORER_TREE = [
  { name: "server", depth: 0, folder: true, open: true },
  { name: "src", depth: 1, folder: true, open: true },
  { name: "controllers", depth: 2, folder: true, open: false },
  { name: "services", depth: 2, folder: true, open: true },
  { name: "settlement.service.ts", depth: 3, active: true, badge: "98%" },
  { name: "webhook.service.ts", depth: 3, badge: "96%" },
  { name: "tests", depth: 1, folder: true, open: true },
  { name: "settlement.spec.ts", depth: 2, test: true },
  { name: "checkout.e2e.spec.ts", depth: 2, test: true },
];

const CODE_GUTTER_LINES = [
  { n: 1, code: "export async function settleInvoice(tx, ledger) {", cov: "hit" },
  { n: 2, code: "  if (!tx || tx.amount <= 0) {", cov: "hit" },
  { n: 3, code: "    throw new RangeError('ERR_INVALID_AMOUNT');", cov: "fault" },
  { n: 4, code: "  }", cov: "hit" },
  { n: 5, code: "  const rate = tx.ccy === 'USD' ? 1 : ledger.fxRate;", cov: "hit" },
  { n: 6, code: "  if (!rate || rate <= 0) {", cov: "fault" },
  { n: 7, code: "    throw new Error('ERR_STALE_FX_ORACLE');", cov: "fault" },
  { n: 8, code: "  }", cov: "hit" },
  { n: 9, code: "  return ledger.commit({ net: tx.amount * rate });", cov: "hit" },
  { n: 10, code: "}", cov: "hit" },
];

export function EditorExplorerSidebar({ activeScreen }) {
  return (
    <div className="hidden md:flex flex-col w-52 shrink-0 border-r border-white/[0.07] bg-[#090a0d] text-[11px] select-none">
      <div className="px-3 py-2 border-b border-white/[0.06] flex items-center justify-between text-zinc-400 lp-mono text-[10px]">
        <span>Explorer</span>
        <span className="text-sky-400/90">main</span>
      </div>
      <div className="p-2 space-y-0.5 flex-1 overflow-hidden">
        {EXPLORER_TREE.map((item) => {
          const isCurrent =
            (activeScreen === "editor" && item.active) ||
            (activeScreen === "unit" && item.test && item.name.includes("settlement"));
          return (
            <div
              key={item.name}
              style={{ paddingLeft: `${item.depth * 10 + 6}px` }}
              className={`flex items-center justify-between gap-1.5 pr-2 py-1 rounded text-[11px] lp-mono ${
                isCurrent
                  ? "bg-white/[0.08] text-zinc-100"
                  : "text-zinc-400"
              }`}
            >
              <span className="inline-flex items-center gap-1.5 min-w-0 truncate">
                {item.folder ? (
                  <FolderOpen className="w-3 h-3 text-zinc-500 shrink-0" />
                ) : (
                  <FileCode2
                    className={`w-3 h-3 shrink-0 ${
                      item.test ? "text-sky-400" : "text-zinc-400"
                    }`}
                  />
                )}
                <span className="truncate">{item.name}</span>
              </span>
              {item.badge && (
                <span className="text-[9px] text-sky-400/90 shrink-0">{item.badge}</span>
              )}
            </div>
          );
        })}
      </div>
      <div className="px-3 py-2 border-t border-white/[0.06] flex items-center justify-between text-[10px] lp-mono text-zinc-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Yjs Synced
        </span>
        <span>AST v4</span>
      </div>
    </div>
  );
}

export function ScreenEditorView({ healed }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 h-full min-h-[340px]">
      {/* Code Editor with Coverage Gutters */}
      <div className="lg:col-span-7 border-b lg:border-b-0 lg:border-r border-white/[0.07] bg-[#07080b] p-3.5 flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-white/[0.06] text-[11px] lp-mono">
            <span className="text-zinc-200 inline-flex items-center gap-2">
              <FileCode2 className="w-3.5 h-3.5 text-sky-400" />
              settlement.service.ts
            </span>
            <span className={healed ? "text-sky-400" : "text-rose-400"}>
              {healed ? "10/10 lines covered" : "3 uncovered predicates"}
            </span>
          </div>

          <div className="space-y-0.5 lp-mono text-[11px] leading-[1.65]">
            {CODE_GUTTER_LINES.map((line) => {
              const resolved = healed || line.cov === "hit";
              return (
                <div
                  key={line.n}
                  className={`flex items-center px-2 rounded-sm transition-colors duration-300 ${
                    resolved
                      ? line.cov === "fault"
                        ? "bg-sky-500/10 border-l-2 border-sky-400"
                        : "border-l-2 border-emerald-500/50"
                      : "bg-rose-500/10 border-l-2 border-rose-500"
                  }`}
                >
                  <span className="w-5 text-right pr-2.5 text-zinc-600 select-none text-[10px]">
                    {line.n}
                  </span>
                  <span className="w-3 text-[10px] select-none shrink-0">
                    {resolved ? (
                      <span className="text-emerald-400/80">✓</span>
                    ) : (
                      <span className="text-rose-400">×</span>
                    )}
                  </span>
                  <pre className="m-0 text-zinc-200 whitespace-pre overflow-x-auto">
                    {line.code}
                  </pre>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-3 pt-2.5 border-t border-white/[0.06] flex items-center justify-between text-[10px] lp-mono text-zinc-400">
          <span className="inline-flex items-center gap-1.5">
            <GitBranch className="w-3 h-3 text-sky-400" />
            Cyclomatic M = 6
          </span>
          <span>Vitest + Babel AST</span>
        </div>
      </div>

      {/* Right AST CFG Mini Inspector */}
      <div className="lg:col-span-5 bg-[#0b0c10] p-3.5 flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between pb-2.5 mb-3 border-b border-white/[0.06] text-[11px] lp-mono">
            <span className="text-zinc-300">AST Control Flow Tree</span>
            <span className="px-1.5 py-0.5 rounded bg-white/[0.06] text-zinc-300 text-[10px]">
              Live CFG
            </span>
          </div>

          <svg viewBox="0 0 260 175" className="w-full h-40">
            <path d="M130 22 C130 52, 68 52, 68 82" fill="none" stroke="#38bdf8" strokeWidth="1.5" className="lp-flow-edge" />
            <path d="M130 22 C130 52, 192 52, 192 82" fill="none" stroke={healed ? "#38bdf8" : "#f43f5e"} strokeWidth="1.5" className="lp-flow-edge" />
            <path d="M68 82 C68 115, 44 120, 44 146" fill="none" stroke="#38bdf8" strokeWidth="1.5" />
            <path d="M68 82 C68 115, 102 120, 102 146" fill="none" stroke={healed ? "#38bdf8" : "#f43f5e"} strokeWidth="1.5" />
            <path d="M192 82 C192 115, 160 120, 160 146" fill="none" stroke={healed ? "#38bdf8" : "#f43f5e"} strokeWidth="1.5" />
            <path d="M192 82 C192 115, 218 120, 218 146" fill="none" stroke="#38bdf8" strokeWidth="1.5" />

            {[
              { x: 130, y: 20, label: "settleInvoice", ok: true },
              { x: 68, y: 82, label: "amount <= 0", ok: true },
              { x: 192, y: 82, label: "rate <= 0", ok: healed },
              { x: 44, y: 146, label: "Throw", ok: true },
              { x: 102, y: 146, label: "Oracle", ok: healed },
              { x: 160, y: 146, label: "Retry", ok: healed },
              { x: 218, y: 146, label: "Commit", ok: true },
            ].map((node, i) => (
              <g key={i} transform={`translate(${node.x}, ${node.y})`}>
                <rect
                  x="-28"
                  y="-10"
                  width="56"
                  height="20"
                  rx="4"
                  fill="#111218"
                  stroke={node.ok ? "#38bdf8" : "#f43f5e"}
                  strokeWidth="1.2"
                />
                <text
                  x="0"
                  y="3.5"
                  textAnchor="middle"
                  fill={node.ok ? "#e4e4e7" : "#fda4af"}
                  fontSize="8.5"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {node.label}
                </text>
              </g>
            ))}
          </svg>
        </div>

        <div className="p-2.5 rounded-md bg-white/[0.03] border border-white/[0.06] lp-mono text-[10px] space-y-1">
          <div className="flex items-center justify-between text-zinc-400">
            <span>Generated assertion</span>
            <span className="text-sky-400">settlement.spec.ts:14</span>
          </div>
          <div className="text-zinc-200 truncate">
            expect(settleInvoice(badTx)).rejects.toThrow(&apos;ERR_STALE_FX_ORACLE&apos;);
          </div>
        </div>
      </div>
    </div>
  );
}

export function ScreenUnitMatrixView() {
  const rows = [
    { file: "server/src/services/settlement.service.ts", stmts: "98%", branch: "94%", funcs: "100%", lines: "98.4%", status: "Pass", tests: 14 },
    { file: "server/src/controllers/payment.controller.ts", stmts: "92%", branch: "89%", funcs: "95%", lines: "91.8%", status: "Pass", tests: 11 },
    { file: "server/src/services/webhook.service.ts", stmts: "86%", branch: "80%", funcs: "90%", lines: "87.2%", status: "Pass", tests: 9 },
    { file: "server/src/middlewares/authSession.ts", stmts: "74%", branch: "65%", funcs: "80%", lines: "72.5%", status: "Partial", tests: 6 },
  ];

  return (
    <div className="p-4 bg-[#08090c] flex flex-col justify-between min-h-[340px] space-y-3">
      {/* 4 KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {[
          { label: "Unit code coverage", val: "92.4%", sub: "S 91% · B 87% · F 94%" },
          { label: "Source files", val: "18/20", sub: "194 functions" },
          { label: "Test cases", val: "120/122", sub: "98% passing" },
          { label: "Execution health", val: "Ready", sub: "Docker 1.4s" },
        ].map((kpi) => (
          <div
            key={kpi.label}
            className="p-2.5 rounded-md bg-[#111216] border border-white/[0.08]"
          >
            <div className="text-[10px] text-zinc-400">{kpi.label}</div>
            <div className="text-base font-bold lp-mono text-zinc-100 mt-0.5 tabular-nums">
              {kpi.val}
            </div>
            <div className="text-[9.5px] lp-mono text-zinc-500 mt-0.5">{kpi.sub}</div>
          </div>
        ))}
      </div>

      {/* Matrix Table */}
      <div className="rounded-md border border-white/[0.08] bg-[#0e0f13] overflow-hidden flex-1">
        <div className="px-3 py-2 border-b border-white/[0.07] flex items-center justify-between text-[10px] lp-mono text-zinc-400">
          <span>Source File</span>
          <div className="flex items-center gap-4">
            <span className="hidden sm:inline">Stmts · Branch · Funcs · Lines</span>
            <span>Status</span>
            <span>Tests</span>
          </div>
        </div>
        <div className="divide-y divide-white/[0.05]">
          {rows.map((r) => (
            <div
              key={r.file}
              className="px-3 py-2.5 flex items-center justify-between gap-2 text-[11px] hover:bg-white/[0.02]"
            >
              <span className="lp-mono text-zinc-200 truncate">{r.file}</span>
              <div className="flex items-center gap-4 shrink-0 lp-mono text-[10px] tabular-nums">
                <span className="hidden sm:inline text-zinc-400">
                  {r.stmts} · {r.branch} · {r.funcs} · <strong className="text-zinc-100">{r.lines}</strong>
                </span>
                <span className="inline-flex items-center gap-1 text-zinc-300">
                  <span className={`w-1.5 h-1.5 rounded-full ${r.status === "Pass" ? "bg-emerald-400" : "bg-amber-400"}`} />
                  {r.status}
                </span>
                <span className="text-zinc-400 w-10 text-right">{r.tests}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ScreenIntegrationFlowView() {
  const nodes = [
    { label: "Test Client", sub: "POST /checkout", icon: Globe, ok: true },
    { label: "Express Router", sub: "verifyHmac", icon: Server, ok: true },
    { label: "Payment Ctrl", sub: "settleInvoice", icon: Cpu, ok: true },
    { label: "Prisma DB", sub: "tx.commit()", icon: Database, ok: true },
    { label: "HTTP 200", sub: "Assertion Pass", icon: CheckCircle2, ok: true },
  ];

  return (
    <div className="p-4 bg-[#08090c] flex flex-col justify-between min-h-[340px] space-y-3">
      <div className="flex items-center justify-between text-[11px] lp-mono pb-2 border-b border-white/[0.07]">
        <span className="inline-flex items-center gap-2 text-zinc-200">
          <Network className="w-3.5 h-3.5 text-sky-400" />
          POST /api/payments/checkout-session
        </span>
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-white/[0.06] text-zinc-300 text-[10px]">
          <Play className="w-2.5 h-2.5 fill-current text-sky-400" />
          Step 5 / 5 · 18ms
        </span>
      </div>

      {/* Interactive Request Lifecycle Pipeline */}
      <div className="rounded-lg border border-white/[0.08] bg-[#06070a] p-4 flex-1 flex flex-col justify-center">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {nodes.map((n, i) => {
            const Icon = n.icon;
            return (
              <div key={n.label} className="flex items-center gap-2 flex-1 min-w-[100px]">
                <div className="flex-1 p-2.5 rounded-md border border-white/[0.12] bg-[#111216] space-y-1">
                  <div className="flex items-center justify-between">
                    <Icon className="w-3.5 h-3.5 text-sky-400" />
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  </div>
                  <div className="text-[11px] font-medium text-zinc-100 truncate">{n.label}</div>
                  <div className="text-[9.5px] lp-mono text-zinc-500 truncate">{n.sub}</div>
                </div>
                {i < nodes.length - 1 && (
                  <ArrowRight className="w-3.5 h-3.5 text-sky-400/70 shrink-0 hidden sm:block animate-pulse" />
                )}
              </div>
            );
          })}
        </div>

        {/* Scrubber Bar */}
        <div className="mt-5 pt-3 border-t border-white/[0.06] flex items-center gap-3">
          <span className="text-[10px] lp-mono text-zinc-400">Trace</span>
          <div className="flex-1 h-1.5 rounded-full bg-white/[0.08] overflow-hidden relative">
            <div className="h-full w-4/5 rounded-full bg-sky-400" />
          </div>
          <span className="text-[10px] lp-mono text-sky-400">HTTP 200 Verified</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-[10px] lp-mono">
        <div className="p-2 rounded bg-[#111216] border border-white/[0.07] text-zinc-300">
          2xx Happy Path: <strong className="text-zinc-100">13/13</strong>
        </div>
        <div className="p-2 rounded bg-[#111216] border border-white/[0.07] text-zinc-300">
          4xx Auth &amp; Schema: <strong className="text-zinc-100">26/26</strong>
        </div>
        <div className="p-2 rounded bg-[#111216] border border-white/[0.07] text-zinc-300">
          5xx Resiliency: <strong className="text-zinc-100">13/13</strong>
        </div>
      </div>
    </div>
  );
}

export function ScreenReportQueueView() {
  const jobs = [
    { name: "Unit Test Coverage", id: "#cmwuul0s", domain: "Unit", dur: "1m 42s", status: "Completed" },
    { name: "Integration API Matrix", id: "#cmwuu616", domain: "Integration", dur: "54s", status: "Completed" },
    { name: "Playwright E2E Flow", id: "#cmwutzw7", domain: "System", dur: "2m 11s", status: "Completed" },
  ];

  return (
    <div className="p-4 bg-[#08090c] flex flex-col justify-between min-h-[340px] space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
        {/* Quality Score Panel */}
        <div className="sm:col-span-5 p-3.5 rounded-md bg-[#111216] border border-white/[0.08] flex flex-col justify-between">
          <div className="flex items-center justify-between text-[11px] text-zinc-400">
            <span className="inline-flex items-center gap-1.5">
              <BarChart3 className="w-3.5 h-3.5 text-sky-400" />
              Quality Score
            </span>
            <span className="px-1.5 py-0.5 rounded bg-white/[0.08] text-zinc-100 lp-mono text-[10px]">
              Grade A
            </span>
          </div>
          <div className="my-3 flex items-baseline gap-1.5 lp-mono">
            <span className="text-3xl font-bold text-zinc-100">94</span>
            <span className="text-xs text-zinc-500">/ 100</span>
          </div>
          <div className="space-y-1.5 text-[10px] lp-mono">
            <div className="flex justify-between text-zinc-400">
              <span>Unit Branches</span>
              <span className="text-zinc-200">96.4%</span>
            </div>
            <div className="h-1 rounded-full bg-white/[0.08] overflow-hidden">
              <div className="h-full w-[96%] bg-zinc-100" />
            </div>
          </div>
        </div>

        {/* Job Queue Panel */}
        <div className="sm:col-span-7 rounded-md bg-[#111216] border border-white/[0.08] overflow-hidden flex flex-col">
          <div className="px-3 py-2 border-b border-white/[0.07] flex items-center justify-between text-[11px]">
            <span className="inline-flex items-center gap-1.5 font-medium text-zinc-200">
              <ListOrdered className="w-3.5 h-3.5 text-zinc-400" />
              Project Job Queue
            </span>
            <span className="text-[10px] lp-mono text-zinc-500">3 completed</span>
          </div>
          <div className="divide-y divide-white/[0.05] flex-1">
            {jobs.map((job) => (
              <div key={job.id} className="px-3 py-2.5 flex items-center justify-between gap-2 text-[11px]">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-zinc-200 truncate">{job.name}</span>
                    <span className="px-1.5 py-0.2 rounded border border-white/[0.1] bg-white/[0.04] text-[9px] text-zinc-400">
                      {job.domain}
                    </span>
                  </div>
                  <div className="text-[10px] lp-mono text-zinc-500">{job.id}</div>
                </div>
                <div className="flex items-center gap-2.5 shrink-0 lp-mono text-[10px]">
                  <span className="text-zinc-500">{job.dur}</span>
                  <span className="inline-flex items-center gap-1 text-zinc-300">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    {job.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Verification Gate Footer */}
      <div className="p-2.5 rounded-md bg-[#111216] border border-white/[0.08] flex items-center justify-between text-[11px] lp-mono">
        <span className="inline-flex items-center gap-2 text-zinc-300">
          <ShieldCheck className="w-3.5 h-3.5 text-sky-400" />
          Exportable PDF &amp; JSON Executive Report ready
        </span>
        <span className="inline-flex items-center gap-1 text-zinc-400">
          <Terminal className="w-3 h-3" />
          0 blockers
        </span>
      </div>
    </div>
  );
}
