import { CrossLayerTraceMatrix } from "../matrix/CrossLayerTraceMatrix.jsx";
import { SmartActionCenter } from "../actions/SmartActionCenter.jsx";

export function TraceAndActionsZone({ vm, onNavigateWorkspace, className = "" }) {
  const matrix = vm?.matrix || {};
  const actions = vm?.actions || {};

  return (
    <div className={`grid grid-cols-12 gap-4 ${className}`}>
      {/* Left 8 Cols: Cross-Layer Trace Matrix */}
      <div className="col-span-12 xl:col-span-8">
        <CrossLayerTraceMatrix
          matrixData={matrix}
          onNavigateWorkspace={onNavigateWorkspace}
        />
      </div>

      {/* Right 4 Cols: Smart Action Center */}
      <div className="col-span-12 xl:col-span-4">
        <SmartActionCenter
          actionsData={actions}
          onNavigateWorkspace={onNavigateWorkspace}
        />
      </div>
    </div>
  );
}

export default TraceAndActionsZone;
