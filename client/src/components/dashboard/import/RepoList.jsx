import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Search, Folder, Lock, User, Loader2 } from "lucide-react";
import { getGithubRepositoriesApi, createProjectApi, importGithubRepoApi, getProjectsApi } from "../../../services/project.service";
import { useToast } from "../ToastContext";

/* ── Helper ─────────────────────────────────── */
function getLangColor(lang) {
  const colors = {
    TypeScript: "#3178c6",
    JavaScript: "#f1e05a",
    Python: "#3572A5",
    Vue: "#41b883",
    HTML: "#e34c26",
    CSS: "#563d7c",
  };
  return colors[lang] || "#8b949e";
}

/* ── Single Repo Row ─────────────────────────────────────── */
function RepoItem({ repo, index, onClose, onSuccess, showToast }) {
  const [hovered, setHovered] = useState(false);
  const [importing, setImporting] = useState(false);
  const Icon = repo.isPrivate ? Lock : Folder;

  const handleImport = async () => {
    if (importing) return;

    if (repo.language && repo.language !== "JavaScript" && repo.language !== "TypeScript") {
      showToast({
        type: "warning",
        title: "Language not supported",
        message: "This project currently only supports JavaScript/Jest. Please wait for future updates.",
      });
      return;
    }

    setImporting(true);
    try {
      let projectId;

      try {
        const projRes = await createProjectApi({ name: repo.name });
        projectId = projRes.data.id;
      } catch (createErr) {
        // Handle 409 — project already exists, find it and reuse
        if (createErr.message?.includes("already exists") || createErr.message?.includes("Duplicate")) {
          const { projects } = await getProjectsApi();
          const existing = projects?.find((p) => p.name === repo.name);
          if (existing) {
            projectId = existing.id;
            showToast({
              type: "info",
              title: "Using existing project",
              message: `Project "${repo.name}" already exists. Importing repository into it.`,
            });
          } else {
            throw new Error("Project already exists but could not be found.");
          }
        } else {
          throw createErr;
        }
      }

      await importGithubRepoApi(projectId, repo.owner, repo.name);

      showToast({
        type: "success",
        title: "Import successful",
        message: `Repository "${repo.name}" has been imported successfully.`,
      });

      if (onSuccess) onSuccess();
      else if (onClose) onClose();
    } catch (err) {
      showToast({
        type: "error",
        title: "Import failed",
        message: err.message || "An unexpected error occurred during import.",
      });
    } finally {
      setImporting(false);
    }
  };

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
        whileHover={!importing ? { scale: 1.03 } : {}}
        whileTap={!importing ? { scale: 0.97 } : {}}
        onClick={handleImport}
        disabled={importing}
        className="flex items-center rounded-lg flex-shrink-0 cursor-pointer"
        style={{
          padding: "8px 20px",
          gap: 6,
          background: importing ? "rgba(124,58,237,0.5)" : (hovered
            ? "linear-gradient(135deg, #7c3aed, #6d28d9)"
            : "rgba(255,255,255,0.06)"),
          border: hovered && !importing
            ? "1px solid rgba(124,58,237,0.4)"
            : "1px solid rgba(255,255,255,0.08)",
          color: hovered || importing ? "#fff" : "#8b949e",
          fontSize: 13,
          fontWeight: 500,
          fontFamily: "var(--font-sans)",
          transition: "all 0.2s ease",
          boxShadow: hovered && !importing
            ? "0 0 12px rgba(124,58,237,0.2)"
            : "none",
          opacity: importing ? 0.8 : 1,
          cursor: importing ? "not-allowed" : "pointer"
        }}
        id={`repo-import-${repo.id}`}
      >
        {importing ? <Loader2 size={14} className="animate-spin" /> : null}
        {importing ? "Importing..." : "Import"}
      </motion.button>
    </motion.div>
  );
}

/* ── Repo List ───────────────────────────────────────────── */
export default function RepoList({ onClose, onSuccess }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [repos, setRepos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const { showToast } = useToast();

  useEffect(() => {
    getGithubRepositoriesApi()
      .then(data => {
        const mapped = Array.isArray(data) ? data.map(r => ({
          id: r.id,
          name: r.name,
          language: r.language || "Unknown",
          langColor: getLangColor(r.language),
          updatedAt: new Date(r.updated_at || new Date()).toLocaleDateString(),
          isPrivate: r.private,
          owner: r.owner?.login
        })) : [];
        setRepos(mapped);
      })
      .catch(err => {
        setErrorMsg(err.message);
      })
      .finally(() => setLoading(false));
  }, []);

  const filteredRepos = repos.filter((r) =>
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
        {loading ? (
          <div className="flex justify-center p-8">
            <Loader2 className="animate-spin text-gray-400" size={24} />
          </div>
        ) : errorMsg ? (
          <div className="flex flex-col items-center justify-center p-8 text-red-400 text-sm">
            {errorMsg}
          </div>
        ) : filteredRepos.length > 0 ? (
          filteredRepos.map((repo, i) => (
            <RepoItem key={repo.id} repo={repo} index={i} onClose={onClose} onSuccess={onSuccess} showToast={showToast} />
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
