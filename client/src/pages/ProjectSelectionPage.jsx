import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getProjectsApi, deleteProjectApi } from "../services/project.service";
import ImportLayout from "../components/dashboard/import/ImportLayout";
import { AnimatePresence } from "framer-motion";
import { FolderGit2, Plus, Trash2 } from "lucide-react";

export default function ProjectSelectionPage() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showImport, setShowImport] = useState(false);
  const navigate = useNavigate();

  const fetchProjects = async () => {
    try {
      setLoading(true);
      const { projects } = await getProjectsApi();
      setProjects(projects || []);
    } catch (err) {
      console.error("Failed to load projects", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line
    fetchProjects();
  }, []);

  const handleDelete = async (e, projectId) => {
    e.stopPropagation();
    if (!window.confirm("Are you sure you want to delete this project?"))
      return;
    try {
      await deleteProjectApi(projectId);
      setProjects((prev) => prev.filter((p) => p.id !== projectId));
    } catch (err) {
      console.error(err);
      alert("Failed to delete project");
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-white font-sans flex flex-col">
      <header className="h-20 border-b border-white/10 bg-neutral-950 px-4 md:px-12 flex items-center justify-between sticky top-0 z-20 page-wrapper !py-0">
        <div className="flex items-center gap-3">
          <div className="text-violet-400 font-bold text-lg tracking-tight">
            TestCovAI
          </div>
          <div className="h-4 w-px bg-white/10" />
          <span className="text-sm text-neutral-500 font-medium">
            Project Hub
          </span>
        </div>
        <button
          onClick={() => setShowImport(true)}
          className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-500 text-white rounded-lg text-sm font-semibold transition-all cursor-pointer shadow-lg shadow-violet-900/20"
        >
          <Plus size={16} /> New Project
        </button>
      </header>

      <main className="w-full max-w-[1400px] mx-auto page-wrapper">
        <div className="flex flex-col gap-10">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-white/10 pb-8">
            <div className="space-y-1">
              <h1 className="text-4xl font-bold text-white tracking-tight">
                Your Projects
              </h1>
              <p className="text-neutral-400 text-base">
                Manage, monitor, and launch your AI-powered workspaces.
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs font-bold text-violet-400 uppercase tracking-widest bg-violet-500/10 px-4 py-2 rounded-full border border-violet-500/20">
              {projects.length} Active Workspaces
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20 text-sm text-neutral-500">
              <div className="animate-pulse">Loading your workspaces...</div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {projects.map((project) => (
                <div
                  key={project.id}
                  className="group relative bg-neutral-900/50 p-6 rounded-2xl border border-white/10 hover:border-violet-500/30 hover:bg-neutral-800 transition-all duration-300 cursor-pointer flex flex-col justify-between aspect-[3/2] shadow-sm hover:shadow-lg hover:shadow-violet-900/10"
                  onClick={() =>
                    navigate(`/main-editor?projectId=${project.id}`)
                  }
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-neutral-950 flex items-center justify-center text-violet-400 border border-white/10 group-hover:border-violet-500/30 transition-all">
                      <FolderGit2 size={24} />
                    </div>
                    <button
                      onClick={(e) => handleDelete(e, project.id)}
                      className="p-2 text-neutral-500 hover:text-red-500 transition-colors rounded-full hover:bg-red-500/10"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                  <div className="mt-2">
                    <h3 className="text-lg font-semibold text-white group-hover:text-violet-400 transition-colors truncate">
                      {project.name}
                    </h3>
                    <p className="text-xs text-neutral-400 mt-1.5 font-medium">
                      Last active:{" "}
                      {project.updatedAt
                        ? new Date(project.updatedAt).toLocaleDateString()
                        : "Never"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
          {projects.length === 0 && !loading && (
            <div className="py-20 border border-dashed border-white/10 rounded-2xl text-center">
              <p className="text-sm text-neutral-500">
                No projects found. Create a new one to begin.
              </p>
            </div>
          )}
        </div>
      </main>

      <AnimatePresence>
        {showImport && (
          <ImportLayout
            onClose={() => setShowImport(false)}
            onSuccess={() => {
              setShowImport(false);
              fetchProjects();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
