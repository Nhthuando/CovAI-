import { useState } from "react";
import { motion } from "framer-motion";
import { Search, Folder, Lock, User } from "lucide-react";

/* ── Mock repository data ─────────────────────────────────── */
const MOCK_REPOS = [
  {
    id: 1,
    name: "core-api-service",
    language: "TypeScript",
    langColor: "#3178c6",
    updatedAt: "2h ago",
    isPrivate: false,
  },
  {
    id: 2,
    name: "payment-gateway",
    language: "Python",
    langColor: "#f1e05a",
    updatedAt: "1d ago",
    isPrivate: true,
  },
  {
    id: 3,
    name: "frontend-dashboard",
    language: "Vue",
    langColor: "#41b883",
    updatedAt: "3d ago",
    isPrivate: false,
  },
  {
    id: 4,
    name: "ml-pipeline",
    language: "Python",
    langColor: "#3572A5",
    updatedAt: "5d ago",
    isPrivate: false,
  },
  {
    id: 5,
    name: "infra-terraform",
    language: "HCL",
    langColor: "#844FBA",
    updatedAt: "1w ago",
    isPrivate: true,
  },
];

/* ── Single Repo Row ─────────────────────────────────────── */
function RepoItem({ repo, index }) {
  const [hovered, setHovered] = useState(false);
  const Icon = repo.isPrivate ? Lock : Folder;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.06 * index, duration: 0.3, ease: "easeOut" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="flex items-center justify-between rounded-xl"
      style={{
        padding: "14px 16px",
        background: hovered ? "rgba(255,255,255,0.04)" : "transparent",
        border: "1px solid",
        borderColor: hovered
          ? "rgba(255,255,255,0.08)"
          : "rgba(255,255,255,0.04)",
        transition: "all 0.2s ease",
        cursor: "pointer",
      }}
      id={`repo-item-${repo.id}`}
    >
      {/* Left: icon + info */}
      <div className="flex items-center min-w-0" style={{ gap: 14 }}>
        <Icon
          size={18}
          style={{
            color: repo.isPrivate ? "#d29922" : "#6e7681",
            flexShrink: 0,
          }}
        />
        <div className="flex flex-col min-w-0" style={{ gap: 3 }}>
          <div className="flex items-center" style={{ gap: 10 }}>
            <span
              className="truncate"
              style={{
                color: "#e6edf3",
                fontSize: 14,
                fontWeight: 500,
                fontFamily: "var(--font-sans)",
              }}
            >
              {repo.name}
            </span>
            {repo.isPrivate && (
              <span
                className="rounded flex-shrink-0"
                style={{
                  padding: "1px 8px",
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  fontSize: 10,
                  fontWeight: 600,
                  color: "#8b949e",
                  fontFamily: "var(--font-sans)",
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                }}
              >
                Private
              </span>
            )}
          </div>
          <div
            className="flex items-center"
            style={{ gap: 10, fontSize: 12, color: "#484f58" }}
          >
            <span className="flex items-center" style={{ gap: 5 }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: repo.langColor,
                  display: "inline-block",
                }}
              />
              {repo.language}
            </span>
            <span>Updated {repo.updatedAt}</span>
          </div>
        </div>
      </div>

      {/* Right: Import button (always visible) */}
      <motion.button
        whileHover={{ scale: 1.03 }}
        whileTap={{ scale: 0.97 }}
        className="flex items-center rounded-lg flex-shrink-0 cursor-pointer"
        style={{
          padding: "8px 20px",
          background: hovered
            ? "linear-gradient(135deg, #7c3aed, #6d28d9)"
            : "rgba(255,255,255,0.06)",
          border: hovered
            ? "1px solid rgba(124,58,237,0.4)"
            : "1px solid rgba(255,255,255,0.08)",
          color: hovered ? "#fff" : "#8b949e",
          fontSize: 13,
          fontWeight: 500,
          fontFamily: "var(--font-sans)",
          transition: "all 0.2s ease",
          boxShadow: hovered
            ? "0 0 12px rgba(124,58,237,0.2)"
            : "none",
        }}
        id={`repo-import-${repo.id}`}
      >
        Import
      </motion.button>
    </motion.div>
  );
}

/* ── Repo List ───────────────────────────────────────────── */
export default function RepoList() {
  const [searchQuery, setSearchQuery] = useState("");
  const [focused, setFocused] = useState(false);

  const filteredRepos = MOCK_REPOS.filter((r) =>
    r.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col" style={{ gap: 16 }}>
      {/* User account + filter row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center" style={{ gap: 10 }}>
          <div
            className="rounded-full"
            style={{
              width: 28,
              height: 28,
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <User size={14} style={{ color: "#6e7681" }} />
          </div>
          <span
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: "#e6edf3",
              fontFamily: "var(--font-sans)",
            }}
          >
            user-account
          </span>
        </div>

        {/* Search filter */}
        <div
          className="flex items-center rounded-lg"
          style={{
            gap: 8,
            padding: "8px 14px",
            background: focused
              ? "rgba(124,58,237,0.06)"
              : "rgba(255,255,255,0.04)",
            border: "1px solid",
            borderColor: focused
              ? "rgba(124,58,237,0.25)"
              : "rgba(255,255,255,0.08)",
            transition: "all 0.25s ease",
            width: 200,
          }}
        >
          <Search
            size={14}
            style={{
              color: focused ? "#a78bfa" : "#484f58",
              flexShrink: 0,
              transition: "color 0.2s ease",
            }}
          />
          <input
            type="text"
            placeholder="Filter repositories..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            className="w-full bg-transparent outline-none placeholder:text-[#484f58]"
            style={{
              color: "#e6edf3",
              fontFamily: "var(--font-sans)",
              fontSize: 12,
              border: "none",
            }}
            id="repo-search-input"
          />
        </div>
      </div>

      {/* Repo list */}
      <div
        className="flex flex-col overflow-y-auto"
        style={{ gap: 6, maxHeight: 300 }}
      >
        {filteredRepos.length > 0 ? (
          filteredRepos.map((repo, i) => (
            <RepoItem key={repo.id} repo={repo} index={i} />
          ))
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center"
            style={{ gap: 8, padding: "40px 0" }}
          >
            <Search size={24} style={{ color: "#30363d" }} />
            <span style={{ color: "#484f58", fontSize: 13 }}>
              No repositories found
            </span>
          </motion.div>
        )}
      </div>
    </div>
  );
}
