import { CheckCircle2, Terminal } from "lucide-react";

const CODE_LINES = [
  {
    num: 1,
    tokens: [
      { t: "kw", v: "import" },
      { t: "punct", v: " { " },
      { t: "id", v: "checkout" },
      { t: "punct", v: " } " },
      { t: "kw", v: "from" },
      { t: "punct", v: " " },
      { t: "str", v: "'./services/checkout'" },
      { t: "punct", v: ";" },
    ],
  },
  { num: 2, tokens: [] },
  {
    num: 3,
    tokens: [
      { t: "fn", v: "describe" },
      { t: "punct", v: "(" },
      { t: "str", v: "'checkout() edge cases'" },
      { t: "punct", v: ", () => {" },
    ],
  },
  {
    num: 4,
    tokens: [
      { t: "indent", v: "  " },
      { t: "fn", v: "it" },
      { t: "punct", v: "(" },
      { t: "str", v: "'should throw on insufficient balance'" },
      { t: "punct", v: ", () => {" },
    ],
  },
  {
    num: 5,
    tokens: [
      { t: "indent", v: "    " },
      { t: "kw", v: "const" },
      { t: "punct", v: " " },
      { t: "id", v: "cart" },
      { t: "punct", v: " = { " },
      { t: "id", v: "items" },
      { t: "punct", v: ": [{ " },
      { t: "id", v: "price" },
      { t: "punct", v: ": " },
      { t: "num", v: "100" },
      { t: "punct", v: " }] };" },
    ],
  },
  {
    num: 6,
    tokens: [
      { t: "indent", v: "    " },
      { t: "kw", v: "const" },
      { t: "punct", v: " " },
      { t: "id", v: "user" },
      { t: "punct", v: " = { " },
      { t: "id", v: "balance" },
      { t: "punct", v: ": " },
      { t: "num", v: "20" },
      { t: "punct", v: " };" },
    ],
  },
  {
    num: 7,
    highlight: true,
    tokens: [
      { t: "indent", v: "    " },
      { t: "fn", v: "expect" },
      { t: "punct", v: "(() => " },
      { t: "fn", v: "checkout" },
      { t: "punct", v: "(" },
      { t: "id", v: "cart" },
      { t: "punct", v: ", " },
      { t: "id", v: "user" },
      { t: "punct", v: "))" },
    ],
  },
  {
    num: 8,
    highlight: true,
    tokens: [
      { t: "indent", v: "      ." },
      { t: "fn", v: "toThrow" },
      { t: "punct", v: "(" },
      { t: "str", v: "'Insufficient funds'" },
      { t: "punct", v: ");" },
    ],
  },
  {
    num: 9,
    tokens: [
      { t: "indent", v: "  " },
      { t: "punct", v: "});" },
    ],
  },
  { num: 10, tokens: [] },
  {
    num: 11,
    tokens: [
      { t: "indent", v: "  " },
      { t: "fn", v: "it" },
      { t: "punct", v: "(" },
      { t: "str", v: "'should reject empty cart items'" },
      { t: "punct", v: ", () => {" },
    ],
  },
  {
    num: 12,
    tokens: [
      { t: "indent", v: "    " },
      { t: "fn", v: "expect" },
      { t: "punct", v: "(() => " },
      { t: "fn", v: "checkout" },
      { t: "punct", v: "({ " },
      { t: "id", v: "items" },
      { t: "punct", v: ": [] }, { " },
      { t: "id", v: "balance" },
      { t: "punct", v: ": " },
      { t: "num", v: "50" },
      { t: "punct", v: " }))" },
    ],
  },
  {
    num: 13,
    tokens: [
      { t: "indent", v: "      ." },
      { t: "fn", v: "toThrow" },
      { t: "punct", v: "(" },
      { t: "str", v: "'Cart is empty'" },
      { t: "punct", v: ");" },
    ],
  },
  {
    num: 14,
    tokens: [
      { t: "indent", v: "  " },
      { t: "punct", v: "});" },
    ],
  },
  {
    num: 15,
    tokens: [{ t: "punct", v: "});" }],
  },
];

export default function CodePreview() {
  const getTokenClass = (type) => {
    switch (type) {
      case "kw":
        return "text-[#a78bfa] dark:text-[#c084fc] font-semibold";
      case "fn":
        return "text-[#2563eb] dark:text-[#60a5fa]";
      case "str":
        return "text-[#16a34a] dark:text-[#4ade80]";
      case "num":
        return "text-[#d97706] dark:text-[#fb923c]";
      case "id":
        return "text-[var(--color-text)]";
      case "punct":
        return "text-[var(--color-text-muted)]";
      default:
        return "text-[var(--color-text)]";
    }
  };

  return (
    <div className="w-full rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden shadow-sm font-mono text-xs">
      {/* Title Bar */}
      <div className="h-9 px-4 bg-[var(--color-surface-secondary)] border-b border-[var(--color-border)] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 mr-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[var(--color-danger)]/80 inline-block" />
            <span className="w-2.5 h-2.5 rounded-full bg-[var(--color-warning)]/80 inline-block" />
            <span className="w-2.5 h-2.5 rounded-full bg-[var(--color-success)]/80 inline-block" />
          </div>
          <span className="text-[var(--color-text-secondary)] text-[11px] font-medium">
            tests / checkout.test.js
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-success)] font-medium">
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>Jest 29.0 Pass</span>
        </div>
      </div>

      {/* Editor Body */}
      <div className="p-3 bg-[var(--color-bg)] leading-relaxed select-text overflow-x-auto">
        {CODE_LINES.map((line) => (
          <div
            key={line.num}
            className={`flex items-center py-0.5 px-1 rounded-[var(--radius-sm)] transition-colors ${
              line.highlight
                ? "bg-[var(--color-primary)]/10 border-l-2 border-[var(--color-primary)]"
                : "border-l-2 border-transparent"
            }`}
          >
            {/* Line Gutter Marker */}
            <span className="w-4 text-center text-[10px] text-[var(--color-success)] select-none shrink-0 font-bold">
              {line.highlight ? "✓" : ""}
            </span>

            {/* Line Number */}
            <span className="w-6 text-right pr-3 select-none text-[var(--color-text-muted)] text-[11px] shrink-0 font-normal">
              {line.num}
            </span>

            {/* Tokens */}
            <span className="whitespace-pre">
              {line.tokens.map((tok, i) => (
                <span key={i} className={getTokenClass(tok.t)}>
                  {tok.v}
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>

      {/* Status Bar */}
      <div className="px-3.5 py-2 bg-[var(--color-surface-secondary)] border-t border-[var(--color-border)] flex items-center justify-between text-[11px]">
        <div className="flex items-center gap-2 text-[var(--color-text-secondary)]">
          <Terminal className="w-3.5 h-3.5 text-[var(--color-primary)]" />
          <span>Covered branch: Line 14 (throw new Error)</span>
        </div>
        <div className="flex items-center gap-3 font-mono">
          <span className="text-[var(--color-success)] font-semibold">
            100% Branch
          </span>
          <span className="text-[var(--color-text-muted)]">14ms</span>
        </div>
      </div>
    </div>
  );
}
