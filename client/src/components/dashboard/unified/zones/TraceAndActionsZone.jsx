import { CrossLayerTraceMatrix } from "../matrix/CrossLayerTraceMatrix.jsx";
import { SmartActionCenter } from "../actions/SmartActionCenter.jsx";

export function TraceAndActionsZone({
  vm,
  onNavigateWorkspace,
  onInspectItem,
  onAskAi,
  activeCrossFilter = null,
  onClearCrossFilter,
  onSwitchToDemo,
  className = "",
}) {
  const matrix = vm?.matrix || {};
  const actions = vm?.actions || {};

  return (
    <div className={`grid grid-cols-12 gap-4 ${className}`}>
      {/* Left 8 Cols: Cross-Layer Trace Matrix */}
      <div className="col-span-12 xl:col-span-8">
        <CrossLayerTraceMatrix
          matrixData={matrix}
          onNavigateWorkspace={onNavigateWorkspace}
          onInspectItem={onInspectItem}
          onAskAi={onAskAi}
          activeCrossFilter={activeCrossFilter}
          onClearCrossFilter={onClearCrossFilter}
          onSwitchToDemo={onSwitchToDemo}
        />
      </div>

      {/* Right 4 Cols: Smart Action Center */}
      <div className="col-span-12 xl:col-span-4">
        <SmartActionCenter
          actionsData={actions}
          onNavigateWorkspace={onNavigateWorkspace}
          onInspectItem={onInspectItem}
          onAskAi={onAskAi}
          activeCrossFilter={activeCrossFilter}
        />
      </div>
    </div>
  );
}

export default TraceAndActionsZone;
