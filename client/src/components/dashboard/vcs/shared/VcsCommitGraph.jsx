import { useMemo } from "react";
import { GitCommit } from "lucide-react";
import {
  computeCommitGraphLayout,
  formatRelativeTime,
} from "../../../../services/vcsUiHelpers";
import { SnapshotsListSkeleton } from "../../../common/Skeleton";

const LANE_WIDTH = 14;
const PADDING_LEFT = 10;

export default function VcsCommitGraph({
  items = [],
  selectedId = null,
  onSelect,
  emptyTitle = "No history entries yet",
  emptySubtitle = "Commits or captured checkpoints will appear on this timeline.",
  renderItemMeta,
  renderItemActions,
  hasMore = false,
  onLoadMore,
  loading = false,
}) {
  const layout = useMemo(() => computeCommitGraphLayout(items), [items]);
  const svgWidth = Math.max(28, layout.laneCount * LANE_WIDTH + PADDING_LEFT * 2);
  const totalHeight = Math.max(layout.rowHeight, items.length * layout.rowHeight);

  const laneX = (lane) => PADDING_LEFT + lane * LANE_WIDTH + 6;
  const rowY = (row) => row * layout.rowHeight + layout.rowHeight / 2;

  if (loading && items.length === 0) {
    return <SnapshotsListSkeleton rows={6} />;
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-10 text-center border border-dashed border-[var(--color-border)] rounded-lg bg-[var(--color-surface)]">
        <GitCommit size={24} className="text-[var(--color-text-muted)] mb-2 opacity-60" />
        <p className="text-sm font-medium text-[var(--color-text)]">{emptyTitle}</p>
        <p className="text-xs text-[var(--color-text-muted)] mt-1">{emptySubtitle}</p>
      </div>
    );
  }

  return (
    <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-surface)] overflow-hidden">
      <div className="relative flex overflow-x-auto custom-scrollbar">
        {/* SVG Lane Graph Column */}
        <svg
          width={svgWidth}
          height={totalHeight}
          className="shrink-0 bg-[var(--color-bg)]/40 border-r border-[var(--color-border)]"
          aria-hidden="true"
        >
          {layout.edges.map((edge, idx) => {
            const x1 = laneX(edge.fromLane);
            const y1 = rowY(edge.fromRow);
            const x2 = laneX(edge.toLane);
            const y2 = rowY(edge.toRow);
            const d =
              x1 === x2
                ? `M ${x1} ${y1} L ${x2} ${y2}`
                : `M ${x1} ${y1} C ${x1} ${y1 + 18}, ${x2} ${y2 - 18}, ${x2} ${y2}`;
            return (
              <path
                key={`edge-${idx}`}
                d={d}
                fill="none"
                stroke={edge.color}
                strokeWidth={1.75}
                strokeOpacity={0.75}
              />
            );
          })}

          {layout.nodes.map((node) => {
            const cx = laneX(node.lane);
            const cy = rowY(node.row);
            const isSelected = selectedId && node.id === selectedId;
            return (
              <g key={`node-${node.id}-${node.row}`}>
                {isSelected && (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={6.5}
                    fill="none"
                    stroke="var(--color-primary)"
                    strokeWidth={1.5}
                  />
                )}
                <circle
                  cx={cx}
                  cy={cy}
                  r={node.isMerge ? 4.5 : 3.75}
                  fill={isSelected ? "var(--color-primary)" : node.color}
                  stroke="var(--color-bg)"
                  strokeWidth={1.5}
                />
              </g>
            );
          })}
        </svg>

        {/* Entries Column */}
        <div className="flex-1 min-w-0 divide-y divide-[var(--color-border)]">
          {layout.nodes.map((node) => {
            const item = node.item;
            const id = node.id;
            const isSelected = selectedId && id === selectedId;
            const title =
              item.subject || item.label || item.commitMessage || "Untitled";
            const shortId = item.shortHash || (item.versionNumber ? `#v${item.versionNumber}` : id?.slice(0, 7));
            const authorName =
              typeof item.author === "string"
                ? item.author
                : item.author?.name || item.author?.email || "System";
            const timeText =
              item.relativeDate || formatRelativeTime(item.dateIso || item.createdAt);

            return (
              <div
                key={id}
                onClick={() => onSelect?.(item)}
                style={{ height: layout.rowHeight }}
                className={`flex items-center justify-between gap-3 px-3 cursor-pointer transition-colors duration-150 ${
                  isSelected
                    ? "bg-[var(--color-primary)]/10 text-[var(--color-text)]"
                    : "hover:bg-[var(--color-surface-secondary)]/60 text-[var(--color-text-secondary)]"
                }`}
              >
                <div className="min-w-0 flex-1 flex items-center gap-2">
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold tabular-nums bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[var(--color-primary)] shrink-0">
                    {shortId}
                  </span>
                  <span className="truncate text-xs font-medium text-[var(--color-text)]">
                    {title}
                  </span>
                  {renderItemMeta?.(item)}
                </div>

                <div className="flex items-center gap-2.5 shrink-0 text-[11px] text-[var(--color-text-muted)]">
                  <span className="hidden md:inline truncate max-w-[120px]">
                    {authorName}
                  </span>
                  <span className="font-mono tabular-nums text-[10.5px]">
                    {timeText}
                  </span>
                  {renderItemActions && (
                    <div
                      className="flex items-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {renderItemActions(item)}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {hasMore && onLoadMore && (
        <div className="px-4 py-2 border-t border-[var(--color-border)] bg-[var(--color-surface-secondary)]/40 text-center">
          <button
            type="button"
            disabled={loading}
            onClick={onLoadMore}
            className="text-xs font-medium text-[var(--color-primary)] hover:underline cursor-pointer disabled:opacity-50"
          >
            {loading ? "Loading more..." : "Load Older Entries"}
          </button>
        </div>
      )}
    </div>
  );
}
