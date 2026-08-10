import { useState, useEffect, useCallback } from "react";
import { Zap, AlertTriangle, Clock, BarChart2, RefreshCw, Inbox } from "lucide-react";
import { getPerformanceSnapshotApi } from "../../services/job.service";

export default function PerformanceDashboard({ snapshotId, projectId }) {
    const [data, setData] = useState(null);
    const [status, setStatus] = useState("idle"); // idle | loading | ready | not_found | error
    const [errorMessage, setErrorMessage] = useState(null);

    const fetchPerformance = useCallback(async () => {
        if (!snapshotId) {
            setStatus("idle");
            setData(null);
            return;
        }

        setStatus("loading");
        setErrorMessage(null);

        try {
            const result = await getPerformanceSnapshotApi(snapshotId);

            if (!result || !result.metric) {
                setStatus("not_found");
                setData(null);
                return;
            }

            setData(result);
            setStatus("ready");
        } catch (err) {
            if (err.message.includes("404")) {
                setStatus("not_found");
                setData(null);
                return;
            }
            console.error("Failed to fetch performance:", err);
            setErrorMessage(err.message || "Failed to load performance metrics.");
            setStatus("error");
        }
    }, [snapshotId]);

    useEffect(() => {
        fetchPerformance();
    }, [fetchPerformance]);

    if (!snapshotId || status === "idle") {
        return (
            <EmptyState
                icon={<Inbox size={22} />}
                title="No snapshot selected"
                message="Chọn một project và chạy Run Tests để tạo snapshot trước khi xem Performance."
            />
        );
    }

    if (status === "loading") {
        return (
            <div className="p-6 text-gray-400 flex items-center gap-2">
                <RefreshCw size={14} className="animate-spin" />
                Loading performance metrics...
            </div>
        );
    }

    if (status === "not_found") {
        return (
            <EmptyState
                icon={<Zap size={22} />}
                title="Performance analysis chưa sẵn sàng"
                message="Job PERFORMANCE_ANALYSIS cho snapshot này chưa hoàn tất (hoặc chưa được kích hoạt). Việc này thường tự chạy sau khi BUILD_CFG hoàn tất."
                onRetry={fetchPerformance}
            />
        );
    }

    if (status === "error") {
        return (
            <EmptyState
                icon={<AlertTriangle size={22} />}
                title="Không tải được dữ liệu"
                message={errorMessage}
                onRetry={fetchPerformance}
                isError
            />
        );
    }

    const { metric, slowFunctions } = data;

    return (
        <div className="p-6 space-y-6 text-gray-300">
            <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">
                    Performance Overview
                </h2>
                <button
                    onClick={fetchPerformance}
                    className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
                    title="Refresh"
                >
                    <RefreshCw size={12} /> Refresh
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <MetricCard
                    title="Performance Score"
                    value={Number.isFinite(metric.performanceScore) ? metric.performanceScore.toFixed(1) : "—"}
                    icon={<Zap />}
                />
                <MetricCard
                    title="Execution Time"
                    value={Number.isFinite(metric.executionTimeMs) ? `${metric.executionTimeMs}ms` : "—"}
                    icon={<Clock />}
                />
                <MetricCard title="Risk Level" value={metric.riskLevel || "—"} icon={<AlertTriangle />} riskLevel={metric.riskLevel} />
            </div>

            <div className="bg-[#161b22] p-4 rounded-lg border border-[#30363d]">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <BarChart2 size={18} /> Slow / High-Risk Functions
                </h3>
                {!slowFunctions || slowFunctions.length === 0 ? (
                    <p className="text-sm text-gray-500">No slow or high-risk functions detected.</p>
                ) : (
                    <ul className="space-y-2">
                        {slowFunctions.slice(0, 5).map((fn, i) => (
                            <li
                                key={`${fn.filePath}-${fn.functionName}-${i}`}
                                className="flex justify-between items-center p-2 bg-[#0d1117] rounded text-sm"
                            >
                                <div className="flex flex-col min-w-0">
                                    <span className="truncate">{fn.functionName}</span>
                                    <span className="text-[11px] text-gray-600 truncate">{fn.filePath}</span>
                                </div>
                                <span className="text-red-400 flex-shrink-0 ml-3">
                                    Risk: {fn.riskScore}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}

function MetricCard({ title, value, icon, riskLevel }) {
    const riskColor =
        riskLevel === "HIGH" ? "text-red-400" : riskLevel === "MEDIUM" ? "text-yellow-400" : "text-emerald-400";

    return (
        <div className="bg-[#161b22] p-4 rounded-lg border border-[#30363d] flex items-center gap-4">
            <div className="p-2 bg-[#7c3aed]/10 text-[#a78bfa] rounded">{icon}</div>
            <div>
                <div className="text-xs text-gray-500">{title}</div>
                <div className={`text-xl font-bold ${title === "Risk Level" ? riskColor : ""}`}>{value}</div>
            </div>
        </div>
    );
}

function EmptyState({ icon, title, message, onRetry, isError }) {
    return (
        <div className="p-10 flex flex-col items-center justify-center text-center gap-3 h-full">
            <div
                className={`p-3 rounded-full ${isError ? "bg-red-500/10 text-red-400" : "bg-[#7c3aed]/10 text-[#a78bfa]"
                    }`}
            >
                {icon}
            </div>
            <h3 className="text-[#e6edf3] font-semibold text-sm">{title}</h3>
            <p className="text-gray-500 text-sm max-w-sm">{message}</p>
            {onRetry && (
                <button
                    onClick={onRetry}
                    className="mt-2 flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-[#21262d] hover:bg-[#30363d] text-gray-300 transition-colors"
                >
                    <RefreshCw size={12} /> Retry
                </button>
            )}
        </div>
    );
}