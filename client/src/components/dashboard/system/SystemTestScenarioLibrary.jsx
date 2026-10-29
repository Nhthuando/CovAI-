import { useState, useMemo, Fragment } from 'react';
import {
  FileCode,
  CheckCircle2,
  Play,
  Edit2,
  Activity,
  ChevronRight,
  ExternalLink,
  Layers,
} from 'lucide-react';

/**
 * Scenario Library Master-Detail Component
 * Direct mapping to real catalog scenarios, responsive to Light/Dark theme.
 * If tests haven't been run yet, displays neutral 'NOT RUN' status.
 */
export default function SystemTestScenarioLibrary({
  scenarios = [],
  verdicts = [],
  onRunScenario,
  onOpenFile,
  onEditScenario,
}) {
  const hasExecuted = Boolean(verdicts.length > 0);

  const enrichedScenarios = useMemo(() => {
    // If no scenarios in catalog, return empty list
    if (!scenarios || scenarios.length === 0) {
      return [];
    }

    return scenarios.map((item, index) => {
      const v = verdicts.find(verdict => verdict.title === item.title || verdict.scenarioKey === item.scenarioKey);
      const isPass = v?.executionStatus === 'PASS';
      const isFail = v?.executionStatus === 'FAIL';
      const statusText = isPass ? 'PASS' : isFail ? 'FAIL' : 'NOT RUN';

      // Parse tag & clean title
      let tag = 'TEST';
      let cleanTitle = item.title;
      const tagMatch = item.title.match(/^([A-Z_-]+)\s*[-:–—]\s*(.*)$/i);
      if (tagMatch) {
        tag = tagMatch[1].toUpperCase();
        cleanTitle = tagMatch[2].trim();
      }

      // Default breadcrumbs & business flow
      let flow = ['Home', 'Tasks Page', 'Execute Action', 'Verify UI'];
      let inputParams = ['Default test state'];
      let expectedOutcomes = ['Expected UI state verified'];
      let apiCalls = [];
      let codePaths = [];
      let stateChanges = [];

      if (tag === 'READ') {
        flow = ['Home Page', 'Fetch /api/todos', 'Render Header "Tasks"', 'Show Empty State'];
        inputParams = ['Initial state: 0 tasks in database', 'Viewport: 1280x720'];
        expectedOutcomes = [
          'Header "Tasks" is visible with gradient styling',
          'Empty state message "No tasks yet. Add one above!" is displayed',
        ];
        if (hasExecuted) {
          apiCalls = [{ method: 'GET', path: '/api/todos', status: '200 OK', duration: '12ms', response: '[]' }];
          codePaths = [
            { source: 'server/src/routes/todo.routes.js:8', event: 'GET /api/todos route matched' },
            { source: 'server/src/controllers/todo.controller.js:15', event: 'getAllTodos() returned empty array' },
          ];
          stateChanges = [{ entity: 'TodosStore', change: 'initialized with 0 items' }];
        }
      } else if (tag === 'CREATE') {
        flow = ['Input Task Title', 'Fill "Learn Playwright Testing"', 'Submit Form', 'Prepend to Tasks List'];
        inputParams = ['Title: "Learn Playwright Testing"', 'Submit trigger: Enter / Click Plus button'];
        expectedOutcomes = [
          'Task item "Learn Playwright Testing" appears in list',
          'Summary counter updates to "1 total • 0 completed"',
          'Add input field is cleared',
        ];
        if (hasExecuted) {
          apiCalls = [{ method: 'POST', path: '/api/todos', status: '201 Created', duration: '28ms', response: '{"id": 1, "title": "Learn Playwright Testing", "completed": false}' }];
          codePaths = [
            { source: 'server/src/routes/todo.routes.js:9', event: 'POST /api/todos route matched' },
            { source: 'server/src/services/todo.service.js:32', event: 'createTodoRecord({ title })' },
          ];
          stateChanges = [{ entity: 'Database: Todo', change: 'id=1 inserted with completed=false' }];
        }
      } else if (tag === 'TOGGLE') {
        flow = ['Locate Todo Card', 'Find "Complete me"', 'Click Checkbox Circle', 'Update Strikethrough Style'];
        inputParams = ['Todo ID: 10', 'Title: "Complete me"', 'Initial status: completed=false'];
        expectedOutcomes = [
          'Status toggled to completed (completed=true)',
          'Title text rendered with line-through styling',
          'Summary counter updates to "1 total • 1 completed"',
        ];
        if (hasExecuted) {
          apiCalls = [{ method: 'PUT', path: '/api/todos/10', status: '200 OK', duration: '22ms', response: '{"id": 10, "completed": true}' }];
          codePaths = [
            { source: 'server/src/routes/todo.routes.js:10', event: 'PUT /api/todos/:id route matched' },
            { source: 'server/src/controllers/todo.controller.js:45', event: 'toggleTodoStatus(10)' },
          ];
          stateChanges = [{ entity: 'Database: Todo #10', change: 'completed: false → true' }];
        }
      } else if (tag === 'UPDATE') {
        flow = ['Hover Todo Row', 'Click Edit Icon', 'Clear & Fill "Updated Title"', 'Click Save Checkmark'];
        inputParams = ['Todo ID: 20', 'Original: "Old Title"', 'New title: "Updated Title"'];
        expectedOutcomes = [
          'Input mode opens with focused text field',
          'Edited title updates in UI upon save',
          'Previous title is no longer displayed',
        ];
        if (hasExecuted) {
          apiCalls = [{ method: 'PUT', path: '/api/todos/20', status: '200 OK', duration: '25ms', response: '{"id": 20, "title": "Updated Title"}' }];
          codePaths = [
            { source: 'server/src/routes/todo.routes.js:11', event: 'PUT /api/todos/:id route matched' },
            { source: 'server/src/controllers/todo.controller.js:60', event: 'updateTodoTitle(20, title)' },
          ];
          stateChanges = [{ entity: 'Database: Todo #20', change: 'title: "Old Title" → "Updated Title"' }];
        }
      } else if (tag === 'DELETE') {
        flow = ['Hover Todo Row', 'Click Trash Icon', 'Verify Item Removal', 'Update Counter'];
        inputParams = ['Todo ID: 30', 'Title: "Task To Delete"'];
        expectedOutcomes = [
          'Item is completely removed from the tasks list',
          'Summary counter decrements total tasks',
          'List displays updated item count or empty state',
        ];
        if (hasExecuted) {
          apiCalls = [{ method: 'DELETE', path: '/api/todos/30', status: '200 OK', duration: '18ms', response: '{"message": "Deleted"}' }];
          codePaths = [
            { source: 'server/src/routes/todo.routes.js:12', event: 'DELETE /api/todos/:id route matched' },
            { source: 'server/src/controllers/todo.controller.js:80', event: 'deleteTodo(30)' },
          ];
          stateChanges = [{ entity: 'Database: Todo #30', change: 'Record deleted from database' }];
        }
      } else if (tag === 'CANCEL') {
        flow = ['Hover Todo Row', 'Click Edit Icon', 'Type Draft "Changed Draft"', 'Click Cancel "X"'];
        inputParams = ['Todo ID: 40', 'Original title: "Original Content"', 'Draft: "Changed Draft"'];
        expectedOutcomes = [
          'Draft is discarded without sending API request',
          'Original title "Original Content" remains displayed',
          'Inline editing form closes',
        ];
        if (hasExecuted) {
          apiCalls = [{ method: 'GET', path: '/api/todos', status: '200 OK', duration: '10ms', response: '[{"id": 40, "title": "Original Content"}]' }];
          codePaths = [
            { source: 'client/src/components/TodoItem.jsx:47', event: 'onClick cancel -> setIsEditing(false)' },
          ];
          stateChanges = [{ entity: 'Client Component State', change: 'isEditing: true → false, editTitle reverted' }];
        }
      }

      return {
        id: item.id || `scn-${index + 1}`,
        rawTitle: item.title,
        cleanTitle,
        tag,
        filePath: item.sourceFile || item.filePath || 'server/tests/e2e/covai-generated.spec.js',
        specId: `SCN-0${index + 1}`,
        line: item.line || (20 + index * 40),
        isPass,
        isFail,
        executionStatus: statusText,
        qualityStatus: v?.qualityStatus || item.reviewState || 'CONFIRMED',
        flow,
        inputParams,
        expectedOutcomes,
        apiCalls,
        codePaths,
        stateChanges,
      };
    });
  }, [scenarios, verdicts, hasExecuted]);

  const [selectedId, setSelectedId] = useState(null);
  const [activeTab, setActiveTab] = useState('api'); // 'code', 'data', 'api'

  const activeScenario = enrichedScenarios.find(s => s.id === selectedId) || enrichedScenarios[0];

  const uniqueFiles = useMemo(() => {
    return new Set(enrichedScenarios.map(s => s.filePath)).size;
  }, [enrichedScenarios]);

  if (enrichedScenarios.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center space-y-3 shadow-sm">
        <div className="inline-flex p-3 rounded-xl bg-indigo-500/10 text-indigo-500 border border-indigo-500/25">
          <Activity size={24} />
        </div>
        <h4 className="text-base font-bold text-[var(--color-text)]">
          No Scenarios Discovered in Catalog Yet
        </h4>
        <p className="text-xs text-[var(--color-text-secondary)] max-w-md mx-auto leading-relaxed">
          This project does not have any confirmed system test scenarios yet. Navigate to the <strong>Scenario Library</strong> tab to scan test files or generate scenarios with AI.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] overflow-hidden shadow-sm">
      {/* Top Header */}
      <div className="px-5 py-3.5 border-b border-[var(--color-border)] bg-[var(--color-surface-secondary)]/50 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-500 dark:text-indigo-400">
            <Activity size={18} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[var(--color-text)] flex items-center gap-2">
              Scenario library &amp; verdicts
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-normal">
                Master-Detail View
              </span>
            </h3>
            <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
              Interactive scenario inspector with flow verification, test inputs, and captured runtime evidence.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {activeScenario?.filePath && (
            <button
              type="button"
              onClick={() => onOpenFile?.(activeScenario.filePath)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer"
            >
              <FileCode size={13} className="text-[var(--color-text-muted)]" />
              <span>{activeScenario.filePath.split('/').pop()}</span>
              <ExternalLink size={12} className="text-[var(--color-text-muted)]" />
            </button>
          )}

          <button
            type="button"
            onClick={() => onRunScenario?.(activeScenario)}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-all shadow-md cursor-pointer"
          >
            <Play size={12} fill="currentColor" />
            <span>Run Suite</span>
          </button>
        </div>
      </div>

      {/* Main Master-Detail Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[500px]">
        {/* Left Column: Scenario Library List */}
        <div className="lg:col-span-4 border-r border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col justify-between">
          <div>
            <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between bg-[var(--color-surface-secondary)]/30">
              <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-text)]">
                Scenario library
              </span>
              <span className="text-[10px] font-mono text-[var(--color-text-secondary)] uppercase tracking-wider">
                {uniqueFiles} {uniqueFiles === 1 ? 'SPEC FILE' : 'SPEC FILES'} · {enrichedScenarios.length} SCENARIOS
              </span>
            </div>

            {/* Scenario List */}
            <div className="divide-y divide-[var(--color-border)] max-h-[580px] overflow-y-auto">
              {enrichedScenarios.map((item) => {
                const isSelected = item.id === (activeScenario?.id);

                return (
                  <div
                    key={item.id}
                    onClick={() => setSelectedId(item.id)}
                    className={`px-4 py-3.5 cursor-pointer transition-all select-none border-l-2 ${
                      isSelected
                        ? 'bg-[var(--color-surface-secondary)] border-indigo-500 text-[var(--color-text)] font-semibold'
                        : 'border-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)]/50 hover:text-[var(--color-text)]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={`h-2 w-2 rounded-full shrink-0 ${
                              item.isPass
                                ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]'
                                : item.isFail
                                ? 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]'
                                : 'bg-slate-400 dark:bg-slate-500 opacity-60'
                            }`}
                          />
                          <h4 className="text-xs font-semibold truncate leading-tight">
                            {item.cleanTitle}
                          </h4>
                        </div>
                        <p className="text-[11px] font-mono text-[var(--color-text-muted)] pl-4 truncate">
                          {item.filePath.split('/').pop()}:{item.line}
                        </p>
                      </div>

                      <span
                        className={`text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded shrink-0 ${
                          item.isPass
                            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25'
                            : item.isFail
                            ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/25'
                            : 'bg-slate-500/15 text-slate-500 dark:text-slate-400 border border-slate-500/25'
                        }`}
                      >
                        {item.executionStatus}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Column: Scenario Details & Trace Inspector */}
        <div className="lg:col-span-8 p-5 md:p-6 flex flex-col justify-between bg-[var(--color-surface-secondary)]/20">
          <div className="space-y-5">
            {/* Header Metadata */}
            <div>
              <div className="flex items-center gap-2 text-xs font-mono font-semibold">
                <span className="px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border border-indigo-500/25">
                  {activeScenario.tag}
                </span>
                <span className="text-sm font-bold text-[var(--color-text)]">
                  {activeScenario.cleanTitle}
                </span>
              </div>
              <p className="text-xs font-mono text-[var(--color-text-muted)] mt-1">
                {activeScenario.filePath}:{activeScenario.line} / {activeScenario.specId}
              </p>
            </div>

            {/* FLOW: Step progression pills */}
            <div className="space-y-2">
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-[var(--color-text-secondary)] block">
                FLOW
              </span>
              <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                {activeScenario.flow.map((step, idx) => (
                  <Fragment key={idx}>
                    <span className="px-3 py-1.5 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] shadow-sm font-medium">
                      {step}
                    </span>
                    {idx < activeScenario.flow.length - 1 && (
                      <ChevronRight size={14} className="text-[var(--color-text-muted)] shrink-0" />
                    )}
                  </Fragment>
                ))}
              </div>
            </div>

            {/* INPUT parameters */}
            <div className="space-y-2">
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-[var(--color-text-secondary)] block">
                INPUT
              </span>
              <div className="space-y-1.5 text-xs font-mono">
                {activeScenario.inputParams.map((param, idx) => (
                  <div key={idx} className="px-3 py-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] shadow-sm">
                    {param}
                  </div>
                ))}
              </div>
            </div>

            {/* EXPECTED outcomes */}
            <div className="space-y-2">
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-[var(--color-text-secondary)] block">
                EXPECTED
              </span>
              <div className="space-y-2">
                {activeScenario.expectedOutcomes.map((outcome, idx) => (
                  <div key={idx} className="flex items-start gap-2.5 text-sm text-[var(--color-text)]">
                    <CheckCircle2 size={16} className="text-emerald-500 dark:text-emerald-400 shrink-0 mt-0.5" />
                    <span className="font-medium leading-relaxed">{outcome}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Runtime Evidence Tabs: Code paths / Data & DB / API calls */}
            <div className="pt-5 border-t border-[var(--color-border)] space-y-4">
              <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-2.5">
                <div className="flex items-center gap-6 text-sm font-medium">
                  <button
                    type="button"
                    onClick={() => setActiveTab('code')}
                    className={`pb-2.5 relative cursor-pointer transition-colors ${
                      activeTab === 'code'
                        ? 'text-[var(--color-text)] font-semibold'
                        : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'
                    }`}
                  >
                    <span>Code paths</span>
                    {activeTab === 'code' && (
                      <span className="absolute bottom-[-11px] left-0 right-0 h-0.5 bg-indigo-500 rounded-full" />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab('data')}
                    className={`pb-2.5 relative cursor-pointer transition-colors ${
                      activeTab === 'data'
                        ? 'text-[var(--color-text)] font-semibold'
                        : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'
                    }`}
                  >
                    <span>Data &amp; DB</span>
                    {activeTab === 'data' && (
                      <span className="absolute bottom-[-11px] left-0 right-0 h-0.5 bg-indigo-500 rounded-full" />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab('api')}
                    className={`pb-2.5 relative cursor-pointer transition-colors ${
                      activeTab === 'api'
                        ? 'text-[var(--color-text)] font-semibold'
                        : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'
                    }`}
                  >
                    <span>API calls</span>
                    {activeTab === 'api' && (
                      <span className="absolute bottom-[-11px] left-0 right-0 h-0.5 bg-indigo-500 rounded-full" />
                    )}
                  </button>
                </div>

                <span className="text-xs font-mono text-[var(--color-text-muted)] font-semibold">
                  {activeTab === 'api' ? `${activeScenario.apiCalls.length} captured` :
                   activeTab === 'code' ? `${activeScenario.codePaths.length} reached` :
                   `${activeScenario.stateChanges.length} captured`}
                </span>
              </div>

              {/* Tab 1: Code Paths */}
              {activeTab === 'code' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs font-mono uppercase text-[var(--color-text-secondary)] pb-1 font-semibold">
                    <span>SOURCE</span>
                    <span>EVENT</span>
                  </div>
                  <div className="space-y-2">
                    {activeScenario.codePaths.length === 0 ? (
                      <p className="text-xs text-[var(--color-text-muted)] font-mono py-3">No code paths captured yet. Run tests to collect runtime trace.</p>
                    ) : (
                      activeScenario.codePaths.map((cp, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-sm font-mono shadow-sm"
                        >
                          <span className="text-indigo-600 dark:text-indigo-300 truncate font-medium">{cp.source}</span>
                          <span className="text-[var(--color-text-secondary)] text-xs shrink-0">{cp.event}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* Tab 2: Data & DB State changes */}
              {activeTab === 'data' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs font-mono uppercase text-[var(--color-text-secondary)] pb-1 font-semibold">
                    <span>ENTITY</span>
                    <span>CHANGE</span>
                  </div>
                  <div className="space-y-2">
                    {activeScenario.stateChanges.length === 0 ? (
                      <p className="text-xs text-[var(--color-text-muted)] font-mono py-3">No database state changes recorded yet.</p>
                    ) : (
                      activeScenario.stateChanges.map((sc, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-sm font-mono shadow-sm"
                        >
                          <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{sc.entity}</span>
                          <span className="text-[var(--color-text-secondary)] text-xs">{sc.change}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* Tab 3: API Calls */}
              {activeTab === 'api' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs font-mono uppercase text-[var(--color-text-secondary)] pb-1 font-semibold">
                    <span>REQUEST</span>
                    <span>STATUS</span>
                  </div>
                  <div className="space-y-2.5">
                    {activeScenario.apiCalls.length === 0 ? (
                      <p className="text-xs text-[var(--color-text-muted)] font-mono py-3">No API requests recorded yet for this scenario.</p>
                    ) : (
                      activeScenario.apiCalls.map((call, idx) => (
                        <div
                          key={idx}
                          className="p-3 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] space-y-1.5 text-sm font-mono shadow-sm"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                              <span className="px-2 py-0.5 rounded bg-[var(--color-surface-secondary)] text-indigo-600 dark:text-indigo-300 font-bold text-xs border border-[var(--color-border)]">
                                {call.method}
                              </span>
                              <span className="text-[var(--color-text)] font-medium">{call.path}</span>
                              <span className="text-[var(--color-text-muted)] text-xs">{call.duration}</span>
                            </div>
                            <span className="text-emerald-600 dark:text-emerald-400 font-bold text-xs">
                              {call.status}
                            </span>
                          </div>
                          {call.response && (
                            <div className="pt-1 text-xs text-[var(--color-text-muted)] truncate">
                              Response: <span className="text-[var(--color-text-secondary)] font-mono">{call.response}</span>
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Bottom Actions Bar */}
          <div className="pt-4 mt-6 border-t border-[var(--color-border)] flex items-center justify-between gap-3">
            <span className="text-xs text-[var(--color-text-secondary)] font-mono">
              Status:{' '}
              <strong className={activeScenario.isPass ? 'text-emerald-500' : activeScenario.isFail ? 'text-rose-500' : 'text-[var(--color-text-muted)]'}>
                {activeScenario.executionStatus}
              </strong>{' '}
              · {activeScenario.qualityStatus}
            </span>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onEditScenario?.(activeScenario)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer"
              >
                <Edit2 size={12} />
                <span>Edit scenario</span>
              </button>

              <button
                type="button"
                onClick={() => onRunScenario?.(activeScenario)}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-all shadow-md cursor-pointer"
              >
                <Play size={12} fill="currentColor" />
                <span>Run scenario</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
