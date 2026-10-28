/**
 * JSDoc Type Definitions for Unified Quality & Testing Dashboard
 * Defines the contract between Raw Backend API Data, Adapter, and View-Model
 */

/**
 * @typedef {'unit' | 'integration' | 'system'} Pillar
 * @typedef {'pass' | 'fail' | 'warn' | 'untested' | 'none'} CellStatus
 * @typedef {'live' | 'demo' | 'unavailable'} DataSource
 * @typedef {'PASSED' | 'WARNING' | 'FAILED'} QualityGateStatus
 * @typedef {'A' | 'B' | 'C' | 'D'} HealthGrade
 * @typedef {'pyramid' | 'ice-cream-cone' | 'hourglass' | 'insufficient'} PyramidShape
 * @typedef {'HIGH' | 'MEDIUM' | 'LOW'} ActionPriority
 */

/**
 * @typedef PillarVM
 * @property {Pillar} id
 * @property {string} label
 * @property {string} framework
 * @property {number} totalTests
 * @property {number} passedTests
 * @property {number} failedTests
 * @property {number} skippedTests
 * @property {number} flakyTests
 * @property {number} passRate
 * @property {number} durationMs
 * @property {number} avgDurationMs
 * @property {Record<string, number>} coverageMetrics - e.g. { lines: 84.5, branches: 78.2, functions: 90.1, statements: 85.0 }
 * @property {Array<{ filePath: string, line: number, name: string, branchesPct: number, linesPct: number }>} lowCoverageItems
 * @property {Record<string, number>} failureDistribution - e.g. for Integration: { route: 2, middlewareAuth: 1, controller: 4, database: 0 }
 *                                                         for System: { selectorNotFound: 2, networkTimeout: 1, assertion: 3, flaky: 1 }
 * @property {DataSource} source
 * @property {string | null} errorMessage
 */

/**
 * @typedef TraceRowVM
 * @property {string} id
 * @property {string} moduleName
 * @property {string} description
 * @property {{ status: CellStatus, label: string, passed: number, total: number, path?: string }} unit
 * @property {{ status: CellStatus, label: string, passed: number, total: number, endpoint?: string }} integration
 * @property {{ status: CellStatus, label: string, passed: number, total: number, scenarioId?: string }} system
 * @property {{ diagnosis: string, suspectLayer: Pillar | 'logic' | 'none', summary: string }} rootCause
 * @property {Array<{ type: Pillar, name: string, path?: string, status: CellStatus }>} items
 */

/**
 * @typedef ActionItemVM
 * @property {string} id
 * @property {ActionPriority} priority - 'HIGH' | 'MEDIUM' | 'LOW'
 * @property {Pillar} pillar
 * @property {string} title
 * @property {string} targetName - file path, endpoint, or scenario title
 * @property {string} actionType - 'GENERATE_UNIT_TEST' | 'FIX_INTEGRATION_TEST' | 'REPAIR_E2E_SCENARIO'
 * @property {string} ctaLabel
 * @property {{ focusFile?: string, focusEndpoint?: string, focusScenario?: string }} focusParams
 * @property {string} description
 */

/**
 * @typedef RunVM
 * @property {string} id
 * @property {Pillar} type
 * @property {CellStatus} status
 * @property {number} passed
 * @property {number} failed
 * @property {number} total
 * @property {number} coveragePct
 * @property {number} durationMs
 * @property {string | number} startedAt
 * @property {string} commitSha
 */

/**
 * @typedef TrendPointVM
 * @property {string} runLabel
 * @property {string | number} timestamp
 * @property {number | null} unitCoverage
 * @property {number | null} integrationCoverage
 * @property {number | null} systemCoverage
 * @property {number | null} overallCoverage
 * @property {number | null} passRate
 */

/**
 * @typedef UnifiedDashboardVM
 * @property {{ projectId: string, projectName: string, snapshotId: string, snapshots: Array<{ id: string, label: string, branch?: string, createdAt: string }>, updatedAt: number }} context
 * @property {{ status: QualityGateStatus, label: string, reasons: string[] }} qualityGate
 * @property {{ score: number | null, grade: HealthGrade | null, delta: number | null, source: DataSource }} health
 * @property {{ total: number, passed: number, failed: number, skipped: number, flaky: number, passRate: number, durationMs: number, source: DataSource }} execution
 * @property {{ overall: number | null, codePct: number | null, apiPct: number | null, flowPct: number | null, source: DataSource }} coverage
 * @property {{ aiGenerated: number, aiRepaired: number, gaps: number, source: DataSource }} ai
 * @property {Record<Pillar, PillarVM>} pillars
 * @property {{ shape: PyramidShape, warning: string | null, layers: Array<{ pillar: Pillar, label: string, count: number, pctOfTotal: number, durationMs: number }> }} pyramid
 * @property {{ rows: TraceRowVM[], source: DataSource }} matrix
 * @property {{ items: ActionItemVM[], source: DataSource }} actions
 * @property {{ series: TrendPointVM[], beforeAfter: { before: Record<Pillar, number>, after: Record<Pillar, number> }, source: DataSource }} trend
 * @property {{ runs: RunVM[], source: DataSource }} history
 */
