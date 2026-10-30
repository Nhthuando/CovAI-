import { CoverageTrendChart } from "../charts/CoverageTrendChart.jsx";
import { UnifiedRecentRunsTable } from "../history/UnifiedRecentRunsTable.jsx";

export function TrendsAndHistoryZone({
  vm,
  onNavigateWorkspace,
  onInspectItem,
  className = "",
}) {
  const trend = vm?.trend || {};
  const history = vm?.history || {};

  return (
    <div className={`grid grid-cols-12 gap-4 ${className}`}>
      {/* Left 6 Cols: Coverage & Quality Trends Chart */}
      <div className="col-span-12 xl:col-span-6">
        <CoverageTrendChart trendData={trend} />
      </div>

      {/* Right 6 Cols: Unified Execution History Table */}
      <div className="col-span-12 xl:col-span-6">
        <UnifiedRecentRunsTable
          historyData={history}
          onNavigateWorkspace={onNavigateWorkspace}
          onInspectItem={onInspectItem}
        />
      </div>
    </div>
  );
}

export default TrendsAndHistoryZone;
