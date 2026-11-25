import {
  Code2,
  Server,
  Braces,
  Terminal,
  ShieldCheck,
  Monitor,
  GitBranch,
  Container,
  GitPullRequest,
  Cpu,
  Layers,
  Workflow,
  Users,
  Database,
} from "lucide-react";

const ROW_ONE = [
  { name: "React 19", detail: "AST", icon: Code2 },
  { name: "Node.js ESM", detail: "Runtime", icon: Server },
  { name: "TypeScript 5", detail: "Typed CFG", icon: Braces },
  { name: "Vitest", detail: "Runner", icon: Terminal },
  { name: "Jest", detail: "Istanbul", icon: ShieldCheck },
  { name: "Playwright", detail: "E2E trace", icon: Monitor },
  { name: "Babel AST", detail: "Flow graph", icon: GitBranch },
  { name: "Docker", detail: "Sandbox", icon: Container },
];

const ROW_TWO = [
  { name: "GitHub Actions", detail: "PR Gate", icon: GitPullRequest },
  { name: "Gemini 2.5 Pro", detail: "Synthesis", icon: Cpu },
  { name: "Mutation Guard", detail: "Fault check", icon: ShieldCheck },
  { name: "Yjs CRDT", detail: "Multiplayer", icon: Users },
  { name: "PostgreSQL", detail: "Contracts", icon: Database },
  { name: "BullMQ + Redis", detail: "Queue", icon: Workflow },
  { name: "JUnit 5", detail: "Bytecode", icon: Layers },
  { name: "xUnit .NET", detail: "CLR tree", icon: Layers },
];

function TickerItem({ item }) {
  const Icon = item.icon;
  return (
    <div className="group flex items-center gap-2.5 px-4 py-2 mx-1.5 rounded-lg bg-[var(--lp-surface)] border border-[var(--lp-line)] hover:border-[var(--lp-line-strong)] transition-colors select-none shrink-0">
      <Icon className="w-3.5 h-3.5 text-[var(--lp-signal)] opacity-80 group-hover:opacity-100 transition-opacity shrink-0" />
      <span className="text-xs font-medium text-[var(--lp-ink)] tracking-tight">
        {item.name}
      </span>
      <span className="text-[11px] lp-mono text-[var(--lp-ink-muted)] border-l border-[var(--lp-line)] pl-2.5">
        {item.detail}
      </span>
    </div>
  );
}

export default function TechMarquee() {
  const track1 = [...ROW_ONE, ...ROW_ONE];
  const track2 = [...ROW_TWO, ...ROW_TWO];

  return (
    <section
      aria-label="Supported languages and test runners"
      className="relative py-8 border-y border-[var(--lp-line)] bg-[var(--lp-bg)] overflow-hidden"
    >
      <div
        className="pointer-events-none absolute inset-y-0 left-0 w-24 sm:w-40 z-10"
        style={{
          background: "linear-gradient(to right, var(--lp-bg), transparent)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-y-0 right-0 w-24 sm:w-40 z-10"
        style={{
          background: "linear-gradient(to left, var(--lp-bg), transparent)",
        }}
      />

      <div className="lp-ticker-wrap space-y-2.5">
        <div className="lp-ticker-left">
          {track1.map((item, idx) => (
            <TickerItem key={`t1-${idx}`} item={item} />
          ))}
        </div>
        <div className="lp-ticker-right">
          {track2.map((item, idx) => (
            <TickerItem key={`t2-${idx}`} item={item} />
          ))}
        </div>
      </div>
    </section>
  );
}
