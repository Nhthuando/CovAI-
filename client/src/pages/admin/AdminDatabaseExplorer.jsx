import React, { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Database,
  Search,
  Filter,
  Download,
  Trash2,
  Plus,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Layers,
  Sparkles,
} from "lucide-react";
import { AdminDataGrid } from "../../components/admin/AdminDataGrid.jsx";
import { FilterExpressionBuilder } from "../../components/admin/FilterExpressionBuilder.jsx";
import { RecordInspectorDrawer } from "../../components/admin/RecordInspectorDrawer.jsx";
import { DangerousActionModal } from "../../components/admin/DangerousActionModal.jsx";
import { adminService } from "../../services/admin.service.js";

/**
 * AdminDatabaseExplorer — Universal Dynamic Engine for All 67 Models
 */
export default function AdminDatabaseExplorer() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTable = searchParams.get("table") || "User";

  const [schemaData, setSchemaData] = useState(null);
  const [modelDetail, setModelDetail] = useState(null);
  const [records, setRecords] = useState([]);
  const [meta, setMeta] = useState({ page: 1, limit: 25, total: 0, totalPages: 1 });
  const [sortBy, setSortBy] = useState(null);
  const [sortDir, setSortDir] = useState("desc");
  const [searchQuery, setSearchQuery] = useState("");
  const [appliedFilters, setAppliedFilters] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  // Modals & Drawers state
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [inspectingRecord, setInspectingRecord] = useState(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deleteTargetIds, setDeleteTargetIds] = useState([]);
  const [isDeleting, setIsDeleting] = useState(false);

  // Load schema on mount
  useEffect(() => {
    async function loadSchema() {
      try {
        const schema = await adminService.getSchema();
        setSchemaData(schema);
      } catch (err) {
        console.error("[AdminDatabaseExplorer] Error loading schema:", err);
      }
    }
    loadSchema();
  }, []);

  // Fetch model detail whenever activeTable changes
  useEffect(() => {
    async function loadModelDetail() {
      if (!activeTable) return;
      try {
        const detail = await adminService.getModelSchema(activeTable);
        setModelDetail(detail);
      } catch (err) {
        console.warn(`[AdminDatabaseExplorer] Error loading model detail for ${activeTable}:`, err);
      }
    }
    loadModelDetail();
  }, [activeTable]);

  const activeModelMeta = modelDetail || schemaData?.models?.find((m) => m.name === activeTable);
  const primaryKey = activeModelMeta?.primaryKey || "id";
  const schemaFields = activeModelMeta?.fields || [];
  const domainLabel =
    typeof activeModelMeta?.domain === "object"
      ? activeModelMeta.domain?.name || "General"
      : activeModelMeta?.domain || "General";

  // Fetch records
  const fetchRecords = useCallback(
    async (pageToLoad = meta.page) => {
      if (!activeTable) return;
      setIsLoading(true);
      try {
        const res = await adminService.listRecords(activeTable, {
          page: pageToLoad,
          limit: meta.limit,
          sortBy: sortBy || undefined,
          sortDir: sortDir,
          q: searchQuery || undefined,
          filters: appliedFilters || undefined,
          includeRelations: true,
        });

        setRecords(res.records || []);
        setMeta(res.meta || { page: 1, limit: 25, total: 0, totalPages: 1 });
      } catch (err) {
        console.error(`[AdminDatabaseExplorer] Error fetching ${activeTable}:`, err);
        setRecords([]);
      } finally {
        setIsLoading(false);
      }
    },
    [activeTable, meta.limit, meta.page, sortBy, sortDir, searchQuery, appliedFilters]
  );

  useEffect(() => {
    setSelectedIds([]);
    fetchRecords(1);
  }, [activeTable, sortBy, sortDir, appliedFilters]);

  // Handle table switch
  const handleSelectTable = (newTable) => {
    setSearchParams({ table: newTable });
    setSearchQuery("");
    setAppliedFilters(null);
    setSortBy(null);
  };

  // Handle search submit
  const handleSearchSubmit = (e) => {
    e.preventDefault();
    fetchRecords(1);
  };

  // Handle export CSV
  const handleExportCsv = async () => {
    try {
      const csvContent = await adminService.exportCsv(activeTable, {
        q: searchQuery,
        filters: appliedFilters,
      });

      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `${activeTable}_export_${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      alert(`Export CSV failed: ${err.message}`);
    }
  };

  // Handle delete execution
  const executeDelete = async () => {
    setIsDeleting(true);
    try {
      if (deleteTargetIds.length === 1) {
        await adminService.deleteRecord(activeTable, deleteTargetIds[0]);
      } else {
        await adminService.batchDelete(activeTable, deleteTargetIds);
      }

      setIsDeleteModalOpen(false);
      setSelectedIds([]);
      fetchRecords();
    } catch (err) {
      alert(`Failed to delete records: ${err.message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  // Convert schema fields to grid columns
  const gridColumns = schemaFields.map((f) => ({
    key: f.name,
    label: f.name,
    type: f.type,
    isId: f.isId,
    width: f.name === primaryKey ? 150 : f.type === "DateTime" ? 140 : 180,
  }));

  return (
    <div className="p-6 h-full flex flex-col space-y-4 max-w-[1800px] mx-auto overflow-hidden">
      {/* 1. Header Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-[var(--admin-border-subtle)] flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-md bg-[var(--admin-accent-primary-muted)] text-[var(--admin-accent-primary)] border border-[var(--admin-border-accent)]">
            <Database size={18} />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <select
                value={activeTable}
                onChange={(e) => handleSelectTable(e.target.value)}
                className="text-base font-bold font-mono bg-transparent text-[var(--admin-text-high)] focus:outline-none cursor-pointer border-b border-dashed border-[var(--admin-border-strong)] hover:border-[var(--admin-accent-primary)] pr-2"
              >
                {schemaData?.models?.map((m) => (
                  <option key={m.name} value={m.name} className="bg-[var(--admin-surface-raised)]">
                    {m.name} ({m.count ?? 0} records)
                  </option>
                ))}
              </select>

              <span className="text-xs font-mono px-2 py-0.5 rounded bg-[var(--admin-surface-raised)] border border-[var(--admin-border-subtle)] text-[var(--admin-accent-telemetry)]">
                {meta.total.toLocaleString()} total
              </span>
            </div>
            <div className="text-[11px] text-[var(--admin-text-medium)]">
              Domain: <span className="font-semibold text-[var(--admin-text-high)]">{domainLabel}</span> · PK: <span className="font-mono">{primaryKey}</span>
            </div>
          </div>
        </div>

        {/* Global Toolbar Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Search box */}
          <form onSubmit={handleSearchSubmit} className="relative">
            <Search size={13} className="absolute left-2.5 top-2.5 text-[var(--admin-text-low)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search records (Enter)..."
              className="pl-8 pr-3 py-1.5 text-xs font-mono rounded bg-[var(--admin-surface-raised)] border border-[var(--admin-border-strong)] text-[var(--admin-text-high)] focus:outline-none focus:border-[var(--admin-accent-primary)] w-48 sm:w-64"
            />
          </form>

          {/* Filter toggle */}
          <button
            type="button"
            onClick={() => setIsFilterOpen(!isFilterOpen)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border transition-colors admin-tactile-btn ${
              isFilterOpen || appliedFilters
                ? "bg-[var(--admin-accent-primary-muted)] text-[var(--admin-accent-primary)] border-[var(--admin-border-accent)]"
                : "bg-[var(--admin-surface-raised)] text-[var(--admin-text-medium)] border-[var(--admin-border-subtle)] hover:text-[var(--admin-text-high)]"
            }`}
          >
            <Filter size={13} />
            <span>Filter {appliedFilters ? "(Active)" : ""}</span>
          </button>

          {/* Export CSV */}
          <button
            type="button"
            onClick={handleExportCsv}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-[var(--admin-surface-raised)] text-[var(--admin-text-medium)] hover:text-[var(--admin-text-high)] hover:bg-[var(--admin-surface-overlay)] border border-[var(--admin-border-subtle)] transition-colors admin-tactile-btn"
            title="Export RFC-4180 CSV"
          >
            <Download size={13} />
            <span className="hidden sm:inline">Export CSV</span>
          </button>

          {/* Bulk Delete Button (if selected) */}
          {selectedIds.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setDeleteTargetIds(selectedIds);
                setIsDeleteModalOpen(true);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-[var(--admin-status-danger-muted)] text-[var(--admin-status-danger)] hover:bg-[var(--admin-status-danger)] hover:text-white border border-[var(--admin-status-danger)]/40 transition-colors admin-tactile-btn"
            >
              <Trash2 size={13} />
              <span>Delete ({selectedIds.length})</span>
            </button>
          )}

          {/* Refresh button */}
          <button
            type="button"
            onClick={() => fetchRecords()}
            disabled={isLoading}
            className="p-2 rounded bg-[var(--admin-surface-raised)] text-[var(--admin-text-medium)] hover:text-[var(--admin-text-high)] border border-[var(--admin-border-subtle)] transition-colors"
            title="Reload Records"
          >
            <RefreshCw size={13} className={isLoading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* 2. Compound Filter Expression Builder (Collapsible) */}
      <FilterExpressionBuilder
        isOpen={isFilterOpen}
        schemaFields={schemaFields}
        onClose={() => setIsFilterOpen(false)}
        onApplyFilters={(filters) => {
          setAppliedFilters(filters);
          setIsFilterOpen(false);
        }}
        onReset={() => {
          setAppliedFilters(null);
          setIsFilterOpen(false);
        }}
      />

      {/* 3. Main DataGrid Display */}
      <div className="flex-1 overflow-hidden min-h-0">
        <AdminDataGrid
          columns={gridColumns}
          data={records}
          primaryKey={primaryKey}
          selectedIds={selectedIds}
          onSelectIds={setSelectedIds}
          sortBy={sortBy}
          sortDir={sortDir}
          onSortChange={(col, dir) => {
            setSortBy(col);
            setSortDir(dir);
          }}
          onRowClick={(row) => setInspectingRecord(row)}
          onDeleteRow={(row) => {
            const rowId = row[primaryKey] || row.id;
            setDeleteTargetIds([rowId]);
            setIsDeleteModalOpen(true);
          }}
          isLoading={isLoading}
          emptyMessage={`No records found in model "${activeTable}".`}
        />
      </div>

      {/* 4. Footer Pagination Bar */}
      <div className="flex items-center justify-between px-3 py-2 rounded-md bg-[var(--admin-surface-raised)] border border-[var(--admin-border-subtle)] text-xs flex-shrink-0">
        <div className="flex items-center gap-3 text-[var(--admin-text-medium)] font-mono text-[11px]">
          <span>
            Showing page <span className="text-[var(--admin-text-high)] font-bold">{meta.page}</span> of{" "}
            <span className="text-[var(--admin-text-high)] font-bold">{meta.totalPages}</span>
          </span>
          <span>·</span>
          <span>
            Total: <span className="text-[var(--admin-accent-primary)] font-bold">{meta.total}</span> records
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={meta.page <= 1 || isLoading}
            onClick={() => fetchRecords(meta.page - 1)}
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-[var(--admin-surface-base)] border border-[var(--admin-border-subtle)] text-[var(--admin-text-medium)] hover:text-[var(--admin-text-high)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft size={13} />
            <span>Prev</span>
          </button>
          <button
            type="button"
            disabled={meta.page >= meta.totalPages || isLoading}
            onClick={() => fetchRecords(meta.page + 1)}
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-[var(--admin-surface-base)] border border-[var(--admin-border-subtle)] text-[var(--admin-text-medium)] hover:text-[var(--admin-text-high)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <span>Next</span>
            <ChevronRight size={13} />
          </button>
        </div>
      </div>

      {/* 5. Record Inspector Drawer */}
      <RecordInspectorDrawer
        isOpen={!!inspectingRecord}
        onClose={() => setInspectingRecord(null)}
        record={inspectingRecord}
        modelName={activeTable}
        schemaFields={schemaFields}
        primaryKeyField={primaryKey}
        onSaveRecord={async (updatedData) => {
          const rowId = inspectingRecord[primaryKey] || inspectingRecord.id;
          try {
            await adminService.updateRecord(activeTable, rowId, updatedData);
            setInspectingRecord(null);
            fetchRecords();
          } catch (err) {
            alert(`Update record failed: ${err.message}`);
          }
        }}
        onNavigateToRelation={(relModel, relId) => {
          setSearchParams({ table: relModel });
          setSearchQuery(relId);
          setInspectingRecord(null);
        }}
      />

      {/* 6. Dangerous Delete Confirmation Modal */}
      <DangerousActionModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={executeDelete}
        title={`Confirm Deletion from ${activeTable}`}
        description={`You are about to delete ${deleteTargetIds.length} record(s) from table "${activeTable}". This action will permanently remove records and cascade delete associated relations.`}
        confirmTargetName={`DELETE ${activeTable}`}
        itemCount={deleteTargetIds.length}
        isProcessing={isDeleting}
      />
    </div>
  );
}
