import { useState } from "react";
import IntegrationWorkspace from "./IntegrationWorkspace.jsx";
import { generateIntegrationTestApi } from "../../services/project.service.js";

export default function IntegrationTestDashboard(props) {
  const [generating, setGenerating] = useState(false);

  const handleGenerate = async () => {
    if (!props.projectId || !props.snapshotId) return;
    setGenerating(true);
    try {
      await generateIntegrationTestApi(props.projectId, props.snapshotId);
    } finally {
      setGenerating(false);
    }
  };

  return <IntegrationWorkspace {...props} onGenerate={handleGenerate} generating={generating} />;
}
