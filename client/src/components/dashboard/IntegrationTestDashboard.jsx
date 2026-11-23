import { useProjectAccess } from "../../hooks/useProjectAccess";
import { useState } from "react";
import IntegrationWorkspace from "./IntegrationWorkspace.jsx";
import { generateIntegrationTestApi } from "../../services/project.service.js";

export default function IntegrationTestDashboard(props) {
  const projectAccess = useProjectAccess(props.projectId);
  const [generating, setGenerating] = useState(false);

  const handleGenerate = async (targetEndpoints = null) => {
    if (!projectAccess.can("ai.use") || !props.projectId || !props.snapshotId) return null;
    setGenerating(true);
    try {
      // Non-destructive additive generation: always preserve user manual/existing scenarios.
      return await generateIntegrationTestApi(props.projectId, props.snapshotId, true, targetEndpoints);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <IntegrationWorkspace
      key={`${props.projectId}:${props.snapshotId}`}
      {...props}
      onGenerate={(targets) => handleGenerate(targets)}
      generating={generating}
    />
  );
}
