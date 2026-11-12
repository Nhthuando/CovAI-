import React, { useState } from "react";
import { Plus, Trash2, Filter, Check, RotateCcw, X } from "lucide-react";

/**
 * Operator definitions by field type
 */
const OPERATORS_BY_TYPE = {
  String: [
    { label: "contains", value: "contains" },
    { label: "equals", value: "equals" },
    { label: "starts with", value: "startsWith" },
    { label: "ends with", value: "endsWith" },
    { label: "is null", value: "isNull" },
    { label: "is not null", value: "isNotNull" },
  ],
  Int: [
    { label: "equals (=)", value: "equals" },
    { label: "greater than (>)", value: "gt" },
    { label: "greater or equal (>=)", value: "gte" },
    { label: "less than (<)", value: "lt" },
    { label: "less or equal (<=)", value: "lte" },
    { label: "is null", value: "isNull" },
    { label: "is not null", value: "isNotNull" },
  ],
  Float: [
    { label: "equals (=)", value: "equals" },
    { label: "greater than (>)", value: "gt" },
    { label: "greater or equal (>=)", value: "gte" },
    { label: "less than (<)", value: "lt" },
    { label: "less or equal (<=)", value: "lte" },
  ],
  Boolean: [
    { label: "is true", value: "isTrue" },
    { label: "is false", value: "isFalse" },
    { label: "is null", value: "isNull" },
    { label: "is not null", value: "isNotNull" },
  ],
  DateTime: [
    { label: "after (>=)", value: "gte" },
    { label: "before (<=)", value: "lte" },
    { label: "equals", value: "equals" },
    { label: "is null", value: "isNull" },
    { label: "is not null", value: "isNotNull" },
  ],
  Enum: [
    { label: "equals", value: "equals" },
    { label: "in (comma-separated)", value: "in" },
    { label: "is null", value: "isNull" },
    { label: "is not null", value: "isNotNull" },
  ],
};

const DEFAULT_OPERATORS = [
  { label: "equals", value: "equals" },
  { label: "contains", value: "contains" },
  { label: "is null", value: "isNull" },
  { label: "is not null", value: "isNotNull" },
];

/**
 * FilterExpressionBuilder — Visual AND / OR Query Condition Builder
 */
export function FilterExpressionBuilder({
  schemaFields = [], // [{ name, type, isId, isRequired }]
  onApplyFilters,
  onReset,
  isOpen = false,
  onClose,
}) {
  const [matchMode, setMatchMode] = useState("AND"); // 'AND' | 'OR'
  const [conditions, setConditions] = useState([
    {
      id: "cond-1",
      field: schemaFields[0]?.name || "id",
      operator: "equals",
      value: "",
    },
  ]);

  if (!isOpen) return null;

  const getOperatorsForField = (fieldName) => {
    const fieldDef = schemaFields.find((f) => f.name === fieldName);
    if (!fieldDef) return DEFAULT_OPERATORS;
    return OPERATORS_BY_TYPE[fieldDef.type] || DEFAULT_OPERATORS;
  };

  const handleFieldChange = (condId, newField) => {
    const ops = getOperatorsForField(newField);
    setConditions((prev) =>
      prev.map((c) =>
        c.id === condId
          ? {
              ...c,
              field: newField,
              operator: ops[0]?.value || "equals",
              value: "",
            }
          : c
      )
    );
  };

  const handleOperatorChange = (condId, newOp) => {
    setConditions((prev) =>
      prev.map((c) => (c.id === condId ? { ...c, operator: newOp } : c))
    );
  };

  const handleValueChange = (condId, val) => {
    setConditions((prev) =>
      prev.map((c) => (c.id === condId ? { ...c, value: val } : c))
    );
  };

  const addCondition = () => {
    const firstField = schemaFields[0]?.name || "id";
    const ops = getOperatorsForField(firstField);
    setConditions((prev) => [
      ...prev,
      {
        id: `cond-${Date.now()}`,
        field: firstField,
        operator: ops[0]?.value || "equals",
        value: "",
      },
    ]);
  };

  const removeCondition = (condId) => {
    setConditions((prev) => {
      const remaining = prev.filter((c) => c.id !== condId);
      return remaining.length > 0 ? remaining : [];
    });
  };

  const compilePrismaFilters = () => {
    const clauses = [];

    for (const cond of conditions) {
      if (!cond.field) continue;
      const fieldDef = schemaFields.find((f) => f.name === cond.field);
      const type = fieldDef?.type || "String";

      let clause = {};

      if (cond.operator === "isNull") {
        clause[cond.field] = null;
      } else if (cond.operator === "isNotNull") {
        clause[cond.field] = { not: null };
      } else if (cond.operator === "isTrue") {
        clause[cond.field] = true;
      } else if (cond.operator === "isFalse") {
        clause[cond.field] = false;
      } else {
        // Value required
        if (cond.value === "" || cond.value === undefined) continue;

        let parsedVal = cond.value;
        if (type === "Int") {
          parsedVal = parseInt(cond.value, 10);
        } else if (type === "Float") {
          parsedVal = parseFloat(cond.value);
        } else if (type === "DateTime") {
          parsedVal = new Date(cond.value).toISOString();
        } else if (cond.operator === "in") {
          parsedVal = cond.value.split(",").map((s) => s.trim());
        }

        clause[cond.field] = {
          [cond.operator]: parsedVal,
        };
      }

      clauses.push(clause);
    }

    if (clauses.length === 0) return {};
    if (clauses.length === 1) return clauses[0];

    return { [matchMode]: clauses };
  };

  const handleApply = () => {
    const compiled = compilePrismaFilters();
    onApplyFilters?.(compiled);
  };

  const handleClear = () => {
    setConditions([
      {
        id: `cond-${Date.now()}`,
        field: schemaFields[0]?.name || "id",
        operator: "equals",
        value: "",
      },
    ]);
    onReset?.();
  };

  return (
    <div className="p-4 rounded-lg bg-[var(--admin-surface-raised)] border border-[var(--admin-border-strong)] shadow-xl mb-4 space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-semibold text-[var(--admin-text-high)] uppercase tracking-wider">
          <Filter size={14} className="text-[var(--admin-accent-primary)]" />
          <span>Compound Filter Expression</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Match mode toggle */}
          <div className="flex items-center rounded-md bg-[var(--admin-surface-base)] border border-[var(--admin-border-subtle)] p-0.5 text-[11px] font-mono">
            <button
              type="button"
              onClick={() => setMatchMode("AND")}
              className={`px-2.5 py-0.5 rounded ${
                matchMode === "AND"
                  ? "bg-[var(--admin-accent-primary)] text-black font-bold"
                  : "text-[var(--admin-text-medium)] hover:text-[var(--admin-text-high)]"
              } transition-colors`}
            >
              AND (All)
            </button>
            <button
              type="button"
              onClick={() => setMatchMode("OR")}
              className={`px-2.5 py-0.5 rounded ${
                matchMode === "OR"
                  ? "bg-[var(--admin-accent-primary)] text-black font-bold"
                  : "text-[var(--admin-text-medium)] hover:text-[var(--admin-text-high)]"
              } transition-colors`}
            >
              OR (Any)
            </button>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded text-[var(--admin-text-medium)] hover:text-[var(--admin-text-high)] hover:bg-[var(--admin-surface-base)]"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Conditions Rows */}
      <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
        {conditions.map((cond, idx) => {
          const ops = getOperatorsForField(cond.field);
          const isUnary =
            cond.operator === "isNull" ||
            cond.operator === "isNotNull" ||
            cond.operator === "isTrue" ||
            cond.operator === "isFalse";

          return (
            <div
              key={cond.id}
              className="flex items-center gap-2 p-2 rounded-md bg-[var(--admin-surface-base)] border border-[var(--admin-border-subtle)] text-xs"
            >
              <span className="w-6 text-[10px] font-mono text-[var(--admin-text-low)] text-center">
                #{idx + 1}
              </span>

              {/* Field Select */}
              <select
                value={cond.field}
                onChange={(e) => handleFieldChange(cond.id, e.target.value)}
                className="px-2.5 py-1.5 rounded bg-[var(--admin-surface-overlay)] border border-[var(--admin-border-strong)] text-[var(--admin-text-high)] font-mono text-xs focus:outline-none focus:border-[var(--admin-accent-primary)]"
              >
                {schemaFields.map((f) => (
                  <option key={f.name} value={f.name}>
                    {f.name} ({f.type})
                  </option>
                ))}
              </select>

              {/* Operator Select */}
              <select
                value={cond.operator}
                onChange={(e) => handleOperatorChange(cond.id, e.target.value)}
                className="px-2.5 py-1.5 rounded bg-[var(--admin-surface-overlay)] border border-[var(--admin-border-strong)] text-[var(--admin-accent-telemetry)] font-mono text-xs focus:outline-none focus:border-[var(--admin-accent-primary)]"
              >
                {ops.map((op) => (
                  <option key={op.value} value={op.value}>
                    {op.label}
                  </option>
                ))}
              </select>

              {/* Value Input (if not unary) */}
              {!isUnary && (
                <input
                  type="text"
                  value={cond.value}
                  onChange={(e) => handleValueChange(cond.id, e.target.value)}
                  placeholder="Comparison value..."
                  className="flex-1 px-3 py-1.5 rounded bg-[var(--admin-surface-overlay)] border border-[var(--admin-border-strong)] text-[var(--admin-text-high)] font-mono text-xs focus:outline-none focus:border-[var(--admin-accent-primary)]"
                />
              )}

              {/* Remove condition */}
              <button
                type="button"
                onClick={() => removeCondition(cond.id)}
                className="p-1.5 rounded text-[var(--admin-text-medium)] hover:text-[var(--admin-status-danger)] hover:bg-[var(--admin-surface-overlay)] transition-colors"
                title="Remove condition"
              >
                <Trash2 size={14} />
              </button>
            </div>
          );
        })}
      </div>

      {/* Action Toolbar */}
      <div className="flex items-center justify-between pt-2 border-t border-[var(--admin-border-subtle)]">
        <button
          type="button"
          onClick={addCondition}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs text-[var(--admin-accent-primary)] hover:bg-[var(--admin-accent-primary-muted)] border border-[var(--admin-border-accent)] transition-colors admin-tactile-btn"
        >
          <Plus size={13} />
          <span>Add Condition</span>
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleClear}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs text-[var(--admin-text-medium)] hover:text-[var(--admin-text-high)] hover:bg-[var(--admin-surface-base)] border border-[var(--admin-border-subtle)] transition-colors admin-tactile-btn"
          >
            <RotateCcw size={12} />
            <span>Reset</span>
          </button>
          <button
            type="button"
            onClick={handleApply}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-semibold bg-[var(--admin-accent-primary)] hover:bg-[var(--admin-accent-primary-hover)] text-black transition-all admin-tactile-btn cursor-pointer shadow-[0_0_12px_rgba(0,229,153,0.3)]"
          >
            <Check size={13} />
            <span>Apply Filters</span>
          </button>
        </div>
      </div>
    </div>
  );
}
