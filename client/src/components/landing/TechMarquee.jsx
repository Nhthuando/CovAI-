const ROW_ONE = [
  { name: "React 19", detail: "Component AST" },
  { name: "Node.js ESM", detail: "Isolated runtime" },
  { name: "TypeScript 5", detail: "Type branch graph" },
  { name: "Vitest", detail: "In-memory runner" },
  { name: "Jest", detail: "Istanbul coverage" },
  { name: "Playwright", detail: "Headless flow trace" },
  { name: "Python Pytest", detail: "Branch profiler" },
  { name: "Docker Engine", detail: "Ephemeral containers" },
];

const ROW_TWO = [
  { name: "GitHub Actions", detail: "Pull request gate" },
  { name: "Babel Parser", detail: "Control flow graph" },
  { name: "JUnit 5", detail: "Bytecode branches" },
  { name: "xUnit .NET", detail: "CLR execution tree" },
  { name: "Gemini 2.5 Pro", detail: "Test synthesis" },
  { name: "Mutation Guard", detail: "Fault injection" },
  { name: "Yjs CRDT", detail: "Multiplayer editor" },
  { name: "BullMQ + Redis", detail: "Worker orchestration" },
];

function TickerItem({ item }) {
  return (
    <div className="group flex items-center gap-3.5 px-5 py-2.5 mx-1.5 rounded-lg bg-[var(--lp-surface)] border border-[var(--lp-line)] hover:border-[var(--lp-line-strong)] transition-colors select-none shrink-0">
      <span className="w-1.5 h-1.5 rounded-full bg-[var(--lp-signal)] opacity-70 group-hover:opacity-100 transition-opacity" />
      <span className="text-xs font-medium text-[var(--lp-ink)] tracking-tight">
        {item.name}
      </span>
      <span className="text-[11px] lp-mono text-[var(--lp-ink-muted)] border-l border-[var(--lp-line)] pl-3">
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
