import test from "node:test";
import assert from "node:assert/strict";
import {
  GUIDANCE_STEPS,
  GUIDANCE_TRACKS,
  resolveInitialGuideStep,
} from "../components/dashboard/guidance/platformGuidanceData.js";

test("GUIDANCE_STEPS covers all tracks, sequential numbering, and valid connection links", () => {
  const trackIds = new Set(GUIDANCE_TRACKS.map((t) => t.id));
  const stepIds = new Set(GUIDANCE_STEPS.map((s) => s.id));

  assert.equal(GUIDANCE_STEPS.length, 12);
  assert.equal(stepIds.size, GUIDANCE_STEPS.length);

  GUIDANCE_STEPS.forEach((step, idx) => {
    assert.equal(step.number, idx + 1);
    assert.ok(trackIds.has(step.track), `Unknown track ${step.track}`);
    assert.ok(Array.isArray(step.stages) && step.stages.length >= 3);
    assert.ok(Array.isArray(step.connections) && step.connections.length >= 2);
    for (const conn of step.connections) {
      if (conn.stepId) {
        assert.ok(stepIds.has(conn.stepId), `Broken connection stepId: ${conn.stepId}`);
      }
    }
  });
});

test("resolveInitialGuideStep maps pages, test tiers, and chatbot evaluation views accurately", () => {
  assert.equal(resolveInitialGuideStep({ page: "portfolio" }), "portfolio-import");
  assert.equal(resolveInitialGuideStep({ activeActivity: "explorer" }), "explorer-editor");
  assert.equal(resolveInitialGuideStep({ activeActivity: "overview" }), "unified-overview");
  assert.equal(
    resolveInitialGuideStep({ activeActivity: "coverage", coverageType: "unit" }),
    "unit-setup-run",
  );
  assert.equal(
    resolveInitialGuideStep({ activeActivity: "coverage", coverageType: "integration" }),
    "integration-scan-setup",
  );
  assert.equal(
    resolveInitialGuideStep({ activeActivity: "coverage", coverageType: "system" }),
    "system-setup-matrix",
  );
  assert.equal(
    resolveInitialGuideStep({ activeActivity: "trustworthiness", evalView: "audit" }),
    "chatbot-audit-connect",
  );
  assert.equal(
    resolveInitialGuideStep({ activeActivity: "trustworthiness", evalView: "connect" }),
    "chatbot-audit-connect",
  );
  assert.equal(
    resolveInitialGuideStep({ activeActivity: "trustworthiness", evalView: "run" }),
    "chatbot-benchmark-run",
  );
  assert.equal(resolveInitialGuideStep({ showCFG: true }), "arch-cfg-git-rbac");
});
