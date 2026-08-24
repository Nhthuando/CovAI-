import React, { useState } from "react";
import { startAnalysis } from "../../services/job.service";
import { toast } from "../../components/ToastContext";

/**
 * Button to start automatic analysis for a project/snapshot.
 *
 * @param {Object} props - React props
 * @param {string} props.projectId - The project ID to analyze
 */
export default function AnalysisButton({ projectId }) {
  const [loading, setLoading] = useState(false);

  const handleAnalysis = async () => {
    setLoading(true);
    try {
      const response = await startAnalysis(projectId);
      toast.success("Analysis started successfully!");
    } catch (error) {
      toast.error("Failed to start analysis.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      className="btn btn-primary"
      onClick={handleAnalysis}
      disabled={loading}
    >
      {loading ? "Starting..." : "Run Analysis"}
    </button>
  );
}
