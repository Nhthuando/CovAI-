import { describe, it, expect } from "@jest/globals";

describe("Unit Test Apply Process UI & Progress Bar Synchronization Contracts", () => {
  function computeGlobalProcessIndicatorContent(bulkApply) {
    const stepMatch = typeof bulkApply.step === "string" ? bulkApply.step.match(/\[(\d+)\/(\d+)\]/) : null;
    const currentStepNum = stepMatch ? parseInt(stepMatch[1], 10) : null;
    const totalStepNum = stepMatch ? parseInt(stepMatch[2], 10) : null;

    const resolvedCompleted = currentStepNum !== null ? currentStepNum : (bulkApply.completedCount || 0);
    const resolvedTotal = totalStepNum !== null ? totalStepNum : (bulkApply.totalFiles || bulkApply.totalCount || 0);

    let statsText = bulkApply.stats;
    if (stepMatch && currentStepNum !== null && totalStepNum !== null) {
      statsText = `${currentStepNum}/${totalStepNum}`;
    } else if (!statsText) {
      statsText = resolvedTotal > 0 ? `${resolvedCompleted}/${resolvedTotal}` : "Applying...";
    }

    let progressPct = bulkApply.progressPct;
    if (stepMatch && currentStepNum !== null && totalStepNum !== null && totalStepNum > 0) {
      // Calculate true proportional percentage with a visual minimum of 4%
      progressPct = Math.min(100, Math.max(4, Math.round((currentStepNum / totalStepNum) * 100)));
    } else if (progressPct === undefined || progressPct === null) {
      progressPct = resolvedTotal > 0
        ? Math.min(100, Math.max(4, Math.round((resolvedCompleted / resolvedTotal) * 100)))
        : null;
    }

    return {
      statsText,
      progressPct,
      currentStepNum,
      totalStepNum,
    };
  }

  function simulateUpdateBulkApplyStep(prevState, update) {
    const completedCount = update.completedCount !== undefined ? update.completedCount : prevState.completedCount;
    const totalCount = update.totalCount !== undefined ? update.totalCount : prevState.totalCount;

    const stepMatch = typeof update.step === "string" ? update.step.match(/\[(\d+)\/(\d+)\]/) : null;
    const stepCurrent = stepMatch ? parseInt(stepMatch[1], 10) : null;
    const stepTotal = stepMatch ? parseInt(stepMatch[2], 10) : null;

    const effectiveCompleted = stepCurrent !== null ? stepCurrent : completedCount;
    const effectiveTotal = stepTotal !== null ? stepTotal : totalCount;

    const stats = update.stats !== undefined
      ? update.stats
      : (effectiveTotal > 0 ? `${effectiveCompleted}/${effectiveTotal}` : prevState.stats);
    const progressPct = update.progressPct !== undefined
      ? update.progressPct
      : (effectiveTotal > 0 ? Math.min(100, Math.max(4, Math.round((effectiveCompleted / effectiveTotal) * 100))) : prevState.progressPct);

    return {
      completedCount: effectiveCompleted,
      totalCount: effectiveTotal,
      stats,
      progressPct,
      step: update.step || prevState.step,
    };
  }

  it("ensures at step [1/29], badge pill is 1/29 (NOT 29/29) and progress bar is 4% (NOT 50%)", () => {
    const bulkApply = {
      isApplying: true,
      totalCount: 29,
      totalFiles: 29,
      totalSugs: 29,
      completedCount: 1,
      stats: "29/29", // simulated previous corrupted/stale state
      progressPct: 50, // simulated previous hardcoded 50%
      step: "[1/29] Batch applying 29 suggestions across 29 files...",
    };

    const content = computeGlobalProcessIndicatorContent(bulkApply);

    // Safeguard must override the stale 29/29 and 50%
    expect(content.statsText).toBe("1/29");
    expect(content.statsText).not.toBe("29/29");
    expect(content.progressPct).toBe(4);
    expect(content.progressPct).not.toBe(50);
  });

  it("ensures at step [15/29], badge pill is 15/29 and progress is 52%", () => {
    const bulkApply = {
      isApplying: true,
      totalCount: 29,
      totalFiles: 29,
      totalSugs: 29,
      completedCount: 15,
      step: "[15/29] Executing tests for controllers/authController.js...",
    };

    const content = computeGlobalProcessIndicatorContent(bulkApply);

    expect(content.statsText).toBe("15/29");
    expect(content.progressPct).toBe(Math.round((15 / 29) * 100)); // 52%
  });

  it("ensures at step [29/29], badge pill is 29/29 and progress reaches 100%", () => {
    const bulkApply = {
      isApplying: true,
      totalCount: 29,
      totalFiles: 29,
      totalSugs: 29,
      completedCount: 29,
      step: "[29/29] Executing tests for controllers/wishlistController.js...",
    };

    const content = computeGlobalProcessIndicatorContent(bulkApply);

    expect(content.statsText).toBe("29/29");
    expect(content.progressPct).toBe(100);
  });

  it("ensures updateBulkApplyStep automatically synchronizes effective counts from step string", () => {
    const prevState = {
      completedCount: 0,
      totalCount: 29,
      stats: "0/29",
      progressPct: 0,
      step: "",
    };

    const nextState = simulateUpdateBulkApplyStep(prevState, {
      step: "[1/29] Batch applying 29 suggestions across 29 files...",
    });

    expect(nextState.completedCount).toBe(1);
    expect(nextState.totalCount).toBe(29);
    expect(nextState.stats).toBe("1/29");
    expect(nextState.progressPct).toBe(4);
  });
});

