import { ZonePanel } from "../primitives/ZonePanel.jsx";
import { TestPyramidVisualizer } from "../charts/TestPyramidVisualizer.jsx";
import { UnitPillarCard } from "../pillars/UnitPillarCard.jsx";
import { IntegrationPillarCard } from "../pillars/IntegrationPillarCard.jsx";
import { SystemPillarCard } from "../pillars/SystemPillarCard.jsx";

export function PyramidAndPillarsZone({
  vm,
  loading = false,
  onNavigateWorkspace,
  activeCrossFilter = null,
  onSelectCrossFilter = null,
  className = "",
}) {
  const pyramid = vm?.pyramid || {};
  const pillars = vm?.pillars || {};

  return (
    <div data-guide="ud-pyramid" className={`grid grid-cols-12 gap-4 ${className}`}>
      {/* Left 4 Cols: Test Pyramid Visualizer */}
      <div className="col-span-12 xl:col-span-4">
        <ZonePanel
          id="ud-zone-pyramid"
          title="Testing Pyramid"
          description="Architecture & distribution balance"
          source={vm?.dataMode === "demo" ? "demo" : "live"}
          contentClassName="p-4"
          className="h-full"
        >
          <TestPyramidVisualizer
            pyramid={pyramid}
            loading={loading}
            activeCrossFilter={activeCrossFilter}
            onSelectCrossFilter={onSelectCrossFilter}
          />
        </ZonePanel>
      </div>

      {/* Right 8 Cols: The 3 Dedicated Pillar Cards */}
      <div className="col-span-12 xl:col-span-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 h-full">
          <UnitPillarCard
            pillarData={pillars.unit}
            loading={loading}
            onNavigateWorkspace={onNavigateWorkspace}
            activeCrossFilter={activeCrossFilter}
            onSelectCrossFilter={onSelectCrossFilter}
          />
          <IntegrationPillarCard
            pillarData={pillars.integration}
            loading={loading}
            onNavigateWorkspace={onNavigateWorkspace}
            activeCrossFilter={activeCrossFilter}
            onSelectCrossFilter={onSelectCrossFilter}
          />
          <SystemPillarCard
            pillarData={pillars.system}
            loading={loading}
            onNavigateWorkspace={onNavigateWorkspace}
            activeCrossFilter={activeCrossFilter}
            onSelectCrossFilter={onSelectCrossFilter}
          />
        </div>
      </div>
    </div>
  );
}

export default PyramidAndPillarsZone;
