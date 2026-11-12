import React from "react";
import { MetricSparkline } from "./MetricSparkline.jsx";

/**
 * TelemetryWidget — Industrial Metric Display Card
 * High information density, monospace numbers, status pulse.
 */
export function TelemetryWidget({
  title,
  value,
  unit = "",
  delta = null, // e.g. { value: "+12.4%", isPositive: true }
  trendData = null, // array of numbers for sparkline
  status = "normal", // 'normal' | 'healthy' | 'warning' | 'danger'
  icon: Icon = null,
  footerNote = null,
  onClick = null,
  className = "",
}) {
  const getStatusIndicator = () => {
    switch (status) {
      case "healthy":
        return "bg-[#00E599] shadow-[0_0_8px_rgba(0,229,153,0.6)]";
      case "warning":
        return "bg-[#F59E0B] shadow-[0_0_8px_rgba(245,158,11,0.6)]";
      case "danger":
        return "bg-[#EF4444] shadow-[0_0_8px_rgba(239,68,68,0.6)]";
      default:
        return "bg-[#38BDF8] shadow-[0_0_8px_rgba(56,189,248,0.4)]";
    }
  };

  const getSparklineColors = () => {
    switch (status) {
      case "danger":
        return {
          stroke: "var(--admin-status-danger)",
          fill: "rgba(239, 68, 68, 0.2)",
        };
      case "warning":
        return {
          stroke: "var(--admin-status-warning)",
          fill: "rgba(245, 158, 11, 0.2)",
        };
      case "healthy":
        return {
          stroke: "var(--admin-accent-primary)",
          fill: "rgba(0, 229, 153, 0.2)",
        };
      default:
        return {
          stroke: "var(--admin-accent-telemetry)",
          fill: "rgba(56, 189, 248, 0.2)",
        };
    }
  };

  return (
    <div
      onClick={onClick}
      className={`relative p-4 rounded-lg bg-[var(--admin-surface-raised)] border border-[var(--admin-border-subtle)] hover:border-[var(--admin-border-strong)] transition-all duration-150 flex flex-col justify-between ${
        onClick ? "cursor-pointer active:scale-[0.99]" : ""
      } ${className}`}
    >
      {/* Top Header */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 overflow-hidden">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 admin-live-pulse ${getStatusIndicator()}`} />
          <span className="text-xs font-medium text-[var(--admin-text-medium)] truncate uppercase tracking-wider">
            {title}
          </span>
        </div>

        {Icon && (
          <div className="p-1.5 rounded-md bg-[var(--admin-surface-base)] border border-[var(--admin-border-subtle)] text-[var(--admin-text-medium)]">
            <Icon size={14} />
          </div>
        )}
      </div>

      {/* Main Metric & Sparkline */}
      <div className="flex items-baseline justify-between gap-3 my-1">
        <div className="flex items-baseline gap-1.5 overflow-hidden">
          <span className="text-2xl font-bold admin-mono tracking-tight text-[var(--admin-text-high)]">
            {value}
          </span>
          {unit && (
            <span className="text-xs font-mono text-[var(--admin-text-medium)]">
              {unit}
            </span>
          )}
        </div>

        {trendData && trendData.length > 1 && (
          <div className="flex-shrink-0">
            <MetricSparkline
              data={trendData}
              width={90}
              height={28}
              strokeColor={getSparklineColors().stroke}
              fillColor={getSparklineColors().fill}
            />
          </div>
        )}
      </div>

      {/* Footer Info / Delta */}
      <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-[var(--admin-border-subtle)] text-[11px]">
        {delta ? (
          <div className="flex items-center gap-1">
            <span
              className={`font-mono font-medium ${
                delta.isPositive ? "text-[var(--admin-accent-primary)]" : "text-[var(--admin-status-danger)]"
              }`}
            >
              {delta.value}
            </span>
            <span className="text-[var(--admin-text-low)]">vs last cycle</span>
          </div>
        ) : (
          <span className="text-[var(--admin-text-low)] font-mono">
            {footerNote || "Real-time Telemetry"}
          </span>
        )}

        <div className="text-[var(--admin-text-low)] uppercase tracking-wider text-[10px]">
          {status}
        </div>
      </div>
    </div>
  );
}
