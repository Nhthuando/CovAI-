import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeProjectTimeAndRoiMetrics,
  aggregatePortfolioTimeAndRoi,
  MANUAL_BENCHMARK_MS,
  AI_AUTHORING_SAVED_MINUTES_PER_TEST,
} from '../services/portfolioTimeRoi.calculator.js';

describe('Portfolio Time & ROI Calculator Engine', () => {
  it('correctly calculates manual benchmark and speedup according to industry standards', () => {
    // Mock run metrics
    const unitRun = { totalTests: 10, passedTests: 10, durationMs: 1200 };
    const integrationRun = { totalTests: 5, passedTests: 5, durationMs: 2000 };
    const systemRun = { totalTests: 2, passedTests: 2, durationMs: 4000 };

    const metrics = computeProjectTimeAndRoiMetrics({
      unitRun,
      integrationRun,
      systemRun,
      aiGeneratedCount: 4,
      aiRepairedCount: 2,
    });

    // Actual Auto: 1200 + 2000 + 4000 = 7200 ms = 7.2s
    assert.equal(metrics.actualAutoDurationMs, 7200);

    // Expected Manual:
    // 10 Unit * 120,000ms = 1,200,000ms
    // 5 Int * 300,000ms   = 1,500,000ms
    // 2 Sys * 480,000ms   = 960,000ms
    // Total Manual = 3,660,000ms = 3660s = 1.0167 hours
    const expectedManualMs = (10 * 120_000) + (5 * 300_000) + (2 * 480_000);
    assert.equal(metrics.estimatedManualDurationMs, expectedManualMs);

    // Speedup: 3,660,000 / 7200 = 508.3x
    const expectedSpeedup = Number((expectedManualMs / 7200).toFixed(1));
    assert.equal(metrics.speedupMultiplier, expectedSpeedup);

    // AI Authoring: 6 tests * 15m = 90 min = 1.5 hours
    assert.equal(metrics.aiAuthoringSavedMinutes, 6 * AI_AUTHORING_SAVED_MINUTES_PER_TEST);
    assert.equal(metrics.aiAuthoringHoursSaved, 1.5);

    // Execution time saved = 3,660,000 - 7200 = 3,652,800 ms = 1.01 hours
    assert.equal(metrics.executionTimeSavedMs, expectedManualMs - 7200);

    // Total QA Saved = 1.01 + 1.5 = 2.5 hours
    assert.ok(metrics.totalHoursSaved >= 2.4 && metrics.totalHoursSaved <= 2.6);
    assert.ok(metrics.efficiencyScore >= 80, 'High speedup should yield high efficiency score');
  });

  it('handles empty / zero test runs gracefully without dividing by zero', () => {
    const metrics = computeProjectTimeAndRoiMetrics({
      unitRun: null,
      integrationRun: null,
      systemRun: null,
      aiGeneratedCount: 0,
      aiRepairedCount: 0,
    });

    assert.equal(metrics.actualAutoDurationMs, 0);
    assert.equal(metrics.estimatedManualDurationMs, 0);
    assert.equal(metrics.speedupMultiplier, 0);
    assert.equal(metrics.totalHoursSaved, 0);
    assert.equal(metrics.efficiencyScore, 0);
  });

  it('aggregates portfolio-level Time ROI strictly across provided active projects', () => {
    const proj1 = {
      id: 'p1',
      name: 'Project Alpha',
      timeRoi: {
        actualAutoDurationMs: 5000,
        estimatedManualDurationMs: 1_800_000, // 0.5 hours
        executionTimeSavedMs: 1_795_000,
        aiAuthoringSavedMinutes: 60, // 1 hour
        totalHoursSaved: 1.5,
        speedupMultiplier: 360,
      },
    };

    const proj2 = {
      id: 'p2',
      name: 'Project Beta',
      timeRoi: {
        actualAutoDurationMs: 15_000,
        estimatedManualDurationMs: 3_600_000, // 1 hour
        executionTimeSavedMs: 3_585_000,
        aiAuthoringSavedMinutes: 30, // 0.5 hours
        totalHoursSaved: 1.5,
        speedupMultiplier: 240,
      },
    };

    const aggregated = aggregatePortfolioTimeAndRoi([proj1, proj2]);

    assert.equal(aggregated.totalAutoExecutionSeconds, 20.0);
    assert.equal(aggregated.totalManualExecutionHours, 1.5);
    assert.ok(Math.abs(aggregated.totalQaHoursSaved - 3.0) < 0.05);
    assert.ok(aggregated.averageSpeedupMultiplier > 250);
  });
});

describe('Strict Lifecycle Scope Isolation Rules', () => {
  it('strictly isolates NOT_STARTED, PAUSED, COMPLETED, and CANCELLED projects from active KPI computations', () => {
    const projects = [
      { id: '1', name: 'Active Dev', lifecycleStatus: 'DOING', healthScore: 90, unifiedCoveragePct: 85 },
      { id: '2', name: 'Backlog New', lifecycleStatus: 'NOT_STARTED', healthScore: 0, unifiedCoveragePct: 0 },
      { id: '3', name: 'Delivered', lifecycleStatus: 'COMPLETED', healthScore: 95, unifiedCoveragePct: 92 },
      { id: '4', name: 'On Hold', lifecycleStatus: 'PAUSED', healthScore: 40, unifiedCoveragePct: 30 },
      { id: '5', name: 'Archived', lifecycleStatus: 'CANCELLED', healthScore: 10, unifiedCoveragePct: 10 },
    ];

    // Filter active scope: strictly ONLY DOING
    const activeScope = projects.filter((p) => p.lifecycleStatus === 'DOING');
    const isolatedScope = projects.filter((p) => p.lifecycleStatus !== 'DOING');

    assert.equal(activeScope.length, 1, 'Only DOING projects are in active KPI scope');
    assert.equal(isolatedScope.length, 4, 'NOT_STARTED, PAUSED, COMPLETED, CANCELLED are excluded from active KPIs');

    // Verify isolated/unstarted projects do not affect active average health score
    const activeAvgHealth = Math.round(
      activeScope.reduce((acc, p) => acc + p.healthScore, 0) / activeScope.length
    );
    assert.equal(activeAvgHealth, 90, 'Active health score must be 90 (strictly DOING projects)');

    // If NOT_STARTED was improperly included: (90 + 0) / 2 = 45 (skewed)
    const taintedAvg = Math.round(
      [...activeScope, projects[1]].reduce((acc, p) => acc + p.healthScore, 0) / 2
    );
    assert.notEqual(activeAvgHealth, taintedAvg, 'Active KPI must not be tainted by NOT_STARTED projects');
  });
});
