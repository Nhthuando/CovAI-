# Unified Quality & Testing Dashboard — Backend API Specification (Handover Document)

This document specifies the backend requirements to transition mock demo fixtures in the Frontend Unified Quality & Testing Dashboard (`client/src/services/unifiedDashboard/`) to live persistent backend endpoints.

---

## 1. Proposed New Endpoints

To replace the client-side fixtures (`unifiedDashboard.mock.js`), the following REST endpoints should be created on the backend:

| Proposed Endpoint | HTTP Method | Description | Current Status in Frontend |
|-------------------|-------------|-------------|----------------------------|
| `/api/coverage/:snapshotId/unified/matrix` | GET | Cross-layer trace matrix mapping modules to Unit, Integration, and System coverage | Fallback to `generateMockMatrixRows()` labeled `[Demo data]` |
| `/api/coverage/:snapshotId/unified/history` | GET | Unified execution run log across all 3 testing tiers with duration, status, and coverage | Fallback to `generateMockRecentRuns()` labeled `[Demo data]` |
| `/api/coverage/:snapshotId/unified/trend` | GET | Historical coverage and pass rate trajectory across the last N snapshots / test runs | Fallback to `generateMockTrendSeries()` labeled `[Demo data]` |
| `/api/coverage/:snapshotId/unified/ai-stats` | GET | Aggregated AI suggestions, acceptance rate, and auto-repair test generation metrics | Fallback to `generateMockAiStats()` labeled `[Demo data]` |

---

## 2. JSON Schemas & Response Shapes

### 2.1 Cross-Layer Trace Matrix (`GET /api/coverage/:snapshotId/unified/matrix`)

```json
{
  "success": true,
  "data": {
    "rows": [
      {
        "id": "module-auth",
        "moduleName": "Authentication & Authorization",
        "sourceFiles": ["server/src/controllers/auth.controller.js", "server/src/middlewares/auth.middleware.js"],
        "unit": {
          "total": 24,
          "passed": 24,
          "failed": 0,
          "coveragePct": 92.5,
          "status": "passed"
        },
        "integration": {
          "total": 8,
          "passed": 8,
          "failed": 0,
          "status": "passed",
          "targetEndpoint": "POST /api/auth/login"
        },
        "system": {
          "total": 3,
          "passed": 2,
          "failed": 1,
          "status": "failed",
          "scenarioId": "user_auth_journey"
        },
        "rootCause": {
          "category": "E2E Flake / Timing",
          "explanation": "Unit and integration tests pass, but user login system test fails intermittently.",
          "suggestedFix": "Inspect network wait timeouts in system test scenario.",
          "targetPillar": "system",
          "targetTarget": "user_auth_journey"
        }
      }
    ],
    "summary": {
      "totalModules": 12,
      "alignedCount": 9,
      "discrepancyCount": 3
    }
  }
}
```

### 2.2 Unified History (`GET /api/coverage/:snapshotId/unified/history?limit=10&page=1`)

```json
{
  "success": true,
  "data": {
    "total": 45,
    "page": 1,
    "pageSize": 10,
    "runs": [
      {
        "id": "run-001",
        "type": "unit",
        "status": "passed",
        "passedTests": 142,
        "failedTests": 0,
        "skippedTests": 2,
        "totalTests": 144,
        "coveragePct": 88.5,
        "durationMs": 4200,
        "timestamp": "2026-10-27T14:30:00.000Z",
        "triggeredBy": "manual"
      }
    ]
  }
}
```

### 2.3 Coverage & Pass Rate Trend (`GET /api/coverage/:snapshotId/unified/trend?limit=10`)

```json
{
  "success": true,
  "data": {
    "series": [
      {
        "snapshotId": "snap-001",
        "runLabel": "Run #1",
        "unitCoverage": 82.0,
        "integrationCoverage": 75.0,
        "systemCoverage": 65.0,
        "passRate": 94.2,
        "timestamp": "2026-10-20T10:00:00.000Z"
      }
    ],
    "beforeAfter": {
      "before": { "unit": 78.0, "integration": 68.0, "system": 60.0 },
      "after": { "unit": 84.5, "integration": 78.2, "system": 71.0 }
    }
  }
}
```

---

## 3. Adapter Migration Points

When the backend endpoints above are deployed, update `client/src/services/unifiedDashboard/unifiedDashboard.adapter.js`:

1. **Matrix Adapter (`adaptMatrix`)**:
   - Change `source: "demo"` to `source: "live"`.
   - Map `res.data.rows` directly without calling `generateMockMatrixRows()`.

2. **Trend Adapter (`adaptTrend`)**:
   - Change `source: "demo"` to `source: "live"`.
   - Replace synthetic point interpolation with real `res.data.series`.

3. **History Adapter (`adaptHistory`)**:
   - Change `source: "demo"` to `source: "live"`.
   - Query `/api/coverage/:snapshotId/unified/history` in `fetchUnifiedDashboardData()`.

4. **Demo Data Badges**:
   - The UI automatically hides the `[Demo data]` badge as soon as the adapter sets `source: "live"`.
