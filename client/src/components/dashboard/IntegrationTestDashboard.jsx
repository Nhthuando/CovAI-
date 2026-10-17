import { useState } from "react";
import IntegrationWorkspace from "./IntegrationWorkspace.jsx";
import { generateIntegrationTestApi } from "../../services/project.service.js";
import ConfirmDialog from "../common/ConfirmDialog.jsx";

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
      
      <ConfirmDialog
        isOpen={showConfirm}
        onClose={() => {
          setShowConfirm(false);
          setPendingTargets(null);
        }}
        onConfirm={() => handleGenerate(true, pendingTargets)}
        title="Overwrite Modified Scenarios?"
        message="Your existing integration test scenarios contain manual edits, added scenarios, or disabled scenarios. Continuing will permanently overwrite your manual changes and reset the execution history for these tests. Are you sure you want to proceed?"
        confirmText={generating ? "Generating..." : "Confirm Overwrite"}
        cancelText="Cancel"
        variant="danger"
        loading={generating}
      />
    </>
  );
}
