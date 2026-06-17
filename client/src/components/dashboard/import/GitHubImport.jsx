import { useState } from "react";
import { motion } from "framer-motion";
import { Link, ArrowRight, Loader2 } from "lucide-react";
import RepoList from "./RepoList";
import { createProjectApi, importGithubUrlApi } from "../../../services/project.service";

export default function GitHubImport({ onClose }) {
  const [urlValue, setUrlValue] = useState("");
  const [urlFocused, setUrlFocused] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const isValidUrl =
    urlValue.startsWith("https://github.com/") && urlValue.length > 25;

  const handleImportUrl = async () => {
    if (!isValidUrl || uploading) return;
    setUploading(true);
    setErrorMsg("");
    try {
      const match = urlValue.match(/github\.com\/([^/]+)\/([^/]+)/);
      if (!match) throw new Error("URL GitHub không hợp lệ");
      const repoName = match[2].replace(".git", "");
      
      const projRes = await createProjectApi({ name: repoName, repoUrl: urlValue });
      const projectId = projRes.data.id;

      await importGithubUrlApi(projectId, urlValue);
      alert("Import dự án thành công!");
      if (onClose) onClose();
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col h-full" style={{ gap: 28 }}>
      {/* ── Import via URL ─────────────────────────────────── */}
      <div className="flex flex-col" style={{ gap: 14 }}>
        {/* Section label */}
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "#8b949e",
            fontFamily: "var(--font-sans)",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          Import via GitHub URL
        </span>

        {/* URL Input Row */}
        <div className="flex items-center" style={{ gap: 12 }}>
          <div
            className="flex items-center flex-1 rounded-xl"
            style={{
              gap: 12,
              padding: "14px 16px",
              background: urlFocused
                ? "rgba(124,58,237,0.06)"
                : "rgba(255,255,255,0.04)",
              border: "1px solid",
              borderColor: urlFocused
                ? "rgba(124,58,237,0.3)"
                : "rgba(255,255,255,0.08)",
              transition: "all 0.25s ease",
              boxShadow: urlFocused
                ? "0 0 24px rgba(124,58,237,0.08)"
                : "none",
            }}
          >
            <Link
              size={16}
              style={{
                color: urlFocused ? "#a78bfa" : "#484f58",
                flexShrink: 0,
                transition: "color 0.2s ease",
              }}
            />
            <input
              type="text"
              placeholder="https://github.com/username/repository"
              value={urlValue}
              onChange={(e) => setUrlValue(e.target.value)}
              onFocus={() => setUrlFocused(true)}
              onBlur={() => setUrlFocused(false)}
              className="w-full bg-transparent outline-none"
              style={{
                color: "#e6edf3",
                fontFamily: "var(--font-mono)",
                fontSize: 13,
                border: "none",
              }}
              id="github-url-input"
            />
            {urlValue && (
              <motion.div
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: isValidUrl ? "#3fb950" : "#f85149",
                  boxShadow: isValidUrl
                    ? "0 0 8px rgba(63,185,80,0.6)"
                    : "0 0 8px rgba(248,81,73,0.6)",
                  flexShrink: 0,
                }}
              />
            )}
          </div>

          <motion.button
            whileHover={!uploading ? { scale: 1.02, y: -1 } : {}}
            whileTap={!uploading ? { scale: 0.98 } : {}}
            onClick={handleImportUrl}
            disabled={uploading || !isValidUrl}
            className="flex items-center rounded-xl flex-shrink-0 cursor-pointer"
            style={{
              gap: 8,
              padding: "14px 24px",
              background: isValidUrl
                ? (uploading ? "rgba(124,58,237,0.5)" : "linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)")
                : "#7c3aed",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              border: "none",
              fontFamily: "var(--font-sans)",
              boxShadow: uploading
                  ? "none"
                  : "0 0 16px rgba(124,58,237,0.25), 0 2px 8px rgba(0,0,0,0.2)",
              opacity: isValidUrl ? (uploading ? 0.7 : 1) : 0.8,
              cursor: uploading || !isValidUrl ? "not-allowed" : "pointer",
            }}
            id="url-import-btn"
          >
            {uploading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Importing...
              </>
            ) : (
              <>
                Import
                <ArrowRight size={15} />
              </>
            )}
          </motion.button>
        </div>
        {errorMsg && (
          <div style={{ color: "#f85149", fontSize: 13, marginTop: 4 }}>
            {errorMsg}
          </div>
        )}
      </div>

      {/* ── Divider: OR SELECT FROM ACCOUNT ─────────────────── */}
      <div className="flex items-center" style={{ gap: 16 }}>
        <div
          style={{
            flex: 1,
            height: 1,
            background: "rgba(255,255,255,0.07)",
          }}
        />
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "#484f58",
            fontFamily: "var(--font-sans)",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
          }}
        >
          Or select from account
        </span>
        <div
          style={{
            flex: 1,
            height: 1,
            background: "rgba(255,255,255,0.07)",
          }}
        />
      </div>

      {/* ── Repository Browser ─────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <RepoList onClose={onClose} />
      </div>
    </div>
  );
}
