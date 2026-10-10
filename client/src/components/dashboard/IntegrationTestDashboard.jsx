import { useState } from "react";
import IntegrationWorkspace from "./IntegrationWorkspace.jsx";
import { generateIntegrationTestApi } from "../../services/project.service.js";

export default function IntegrationTestDashboard(props) {
  const [generating, setGenerating] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingTargets, setPendingTargets] = useState(null);

  const handleGenerate = async (force = false, targetEndpoints = null) => {
    if (!props.projectId || !props.snapshotId) return null;
    setGenerating(true);
    try {
      const res = await generateIntegrationTestApi(props.projectId, props.snapshotId, force, targetEndpoints);
      setShowConfirm(false);
      setPendingTargets(null);
      return res; // Return job data so IntegrationWorkspace can capture job ID immediately
    } catch (err) {
      if (err.status === 409 || err.code === 'USER_MODIFICATIONS_EXIST') {
        setPendingTargets(targetEndpoints);
        setShowConfirm(true);
      } else {
        throw err;
      }
    } finally {
      setGenerating(false);
    }
  };

  return (
    <>
      <IntegrationWorkspace
        {...props}
        onGenerate={(targets, force = false) => handleGenerate(force, targets)}
        generating={generating}
      />
      
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-[#1a1b1e] border border-gray-700 rounded-lg shadow-xl w-full max-w-md p-6">
            <h2 className="text-xl font-semibold text-white mb-4">Overwrite Modified Scenarios?</h2>
            <p className="text-gray-300 mb-6 text-sm">
              Your existing integration test scenarios contain manual edits, added scenarios, or disabled scenarios. 
              Continuing will permanently overwrite your manual changes and destroy the execution history for these tests. 
              Are you sure you want to proceed?
            </p>
            <div className="flex justify-end gap-3">
              <button 
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm transition-colors"
                onClick={() => {
                  setShowConfirm(false);
                  setPendingTargets(null);
                }}
                disabled={generating}
              >
                Cancel
              </button>
              <button 
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded text-sm font-medium transition-colors disabled:opacity-50"
                onClick={() => handleGenerate(true, pendingTargets)}
                disabled={generating}
              >
                {generating ? "Generating..." : "Confirm Overwrite"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
