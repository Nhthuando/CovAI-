import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchIntegrationReport } from '../services/report.service';
import { ArrowLeft, Database, BarChart2, AlertCircle, FileText, Activity } from 'lucide-react';
import { format } from 'date-fns';
import IntegrationGuidancePanel from '../components/dashboard/integration/IntegrationGuidancePanel';

export default function IntegrationReportPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetchIntegrationReport(projectId);
      setReport(res.data);
    } catch (err) {
      setError(err.message || 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
  }, [loadData]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--surface-main)] text-[var(--text-primary)] flex items-center justify-center">
        <div className="animate-spin text-[var(--accent-primary)]">
          <Activity size={32} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[var(--surface-main)] text-[var(--text-primary)] p-8">
        <div className="max-w-4xl mx-auto bg-[var(--surface-card)] border border-[var(--border-main)] rounded-lg p-8 text-center">
          <AlertCircle size={48} className="mx-auto text-[var(--error)] mb-4" />
          <h2 className="text-xl font-semibold mb-2">Error Loading Report</h2>
          <p className="text-[var(--text-secondary)] mb-6">{error}</p>
          <button 
            onClick={loadData}
            className="px-4 py-2 bg-[var(--accent-primary)] text-white rounded hover:bg-opacity-90"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!report) return null;

  return (
    <div className="min-h-screen bg-[var(--surface-main)] text-[var(--text-primary)] p-8 overflow-y-auto">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header */}
        <header className="flex items-center justify-between">
          <div>
            <button 
              onClick={() => navigate(`/main-editor?projectId=${projectId}&tab=integration-tests`)}
              className="flex items-center text-[var(--text-secondary)] hover:text-[var(--accent-primary)] mb-4 text-sm"
            >
              <ArrowLeft size={16} className="mr-1" /> Back to Integration Workbench
            </button>
            <h1 className="text-3xl font-bold text-white flex items-center">
              <FileText className="mr-3" /> Integration Test Report
            </h1>
            {report.overview?.snapshotId && (
              <p className="text-[var(--text-secondary)] mt-1">
                Context: Snapshot <span className="font-mono">{report.overview.snapshotId.substring(0,8)}</span>
              </p>
            )}
          </div>
        </header>

        {/* Overview Row */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-[var(--surface-card)] border border-[var(--border-main)] rounded-lg p-6">
            <p className="text-sm text-[var(--text-secondary)] mb-1">Total Scenarios</p>
            <p className="text-2xl font-bold text-white">
              {report.overview ? report.overview.totalScenarios : 'N/A'}
            </p>
          </div>
          <div className="bg-[var(--surface-card)] border border-[var(--border-main)] rounded-lg p-6">
            <p className="text-sm text-[var(--text-secondary)] mb-1">Modified Scenarios</p>
            <p className="text-2xl font-bold text-white">
              {report.overview ? report.overview.modifiedScenarios : 'N/A'}
            </p>
          </div>
          <div className="bg-[var(--surface-card)] border border-[var(--border-main)] rounded-lg p-6">
            <p className="text-sm text-[var(--text-secondary)] mb-1">Unmodified AI Scenarios</p>
            <p className="text-2xl font-bold text-white">
              {report.overview ? report.overview.unmodifiedAiScenarios : 'N/A'}
            </p>
          </div>
          <div className="bg-[var(--surface-card)] border border-[var(--border-main)] rounded-lg p-6">
            <p className="text-sm text-[var(--text-secondary)] mb-1">Pass Rate</p>
            <p className="text-2xl font-bold text-white">
              {report.latestExecution
                ? (report.latestExecution.totalTests > 0
                  ? `${((report.latestExecution.passedTests / report.latestExecution.totalTests) * 100).toFixed(1)}%`
                  : 'N/A')
                : 'N/A'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          
          {/* Latest Execution */}
          <div className="bg-[var(--surface-card)] border border-[var(--border-main)] rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center border-b border-[var(--border-main)] pb-2">
              <Activity className="mr-2" size={18} /> Latest Execution
            </h2>
            {!report.latestExecution ? (
              <p className="text-[var(--text-secondary)] text-sm italic">No Integration Test execution has been recorded for this snapshot.</p>
            ) : (
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-[var(--text-secondary)]">Status</span>
                  <span className={`font-medium ${report.latestExecution.status === 'SUCCESS' ? 'text-green-400' : 'text-red-400'}`}>
                    {report.latestExecution.status}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[var(--text-secondary)]">Passed</span>
                  <span className="text-green-400 font-mono">{report.latestExecution.passedTests}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[var(--text-secondary)]">Failed</span>
                  <span className="text-red-400 font-mono">{report.latestExecution.failedTests}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[var(--text-secondary)]">Skipped</span>
                  <span className="text-yellow-400 font-mono">{report.latestExecution.skippedTests}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[var(--text-secondary)]">Duration</span>
                  <span className="text-white font-mono">{(report.latestExecution.durationMs / 1000).toFixed(2)}s</span>
                </div>
              </div>
            )}
          </div>

          {/* API Endpoint Coverage */}
          <div className="bg-[var(--surface-card)] border border-[var(--border-main)] rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-2 flex items-center border-b border-[var(--border-main)] pb-2">
              <Database className="mr-2" size={18} /> API Endpoint Coverage
            </h2>
            <p className="text-xs text-[var(--text-secondary)] mb-4 leading-tight">
              Static mapping of discovered Express routes to AI tests. (Not runtime coverage).
            </p>
            
            {!report.apiCoverage ? (
              <p className="text-[var(--text-secondary)] text-sm italic">Coverage data not available.</p>
            ) : (
              <div className="space-y-4">
                <div className="flex items-end justify-between">
                  <span className="text-3xl font-bold text-white">{report.apiCoverage.coveragePercentage.toFixed(1)}%</span>
                  <span className="text-[var(--text-secondary)] text-sm">{report.apiCoverage.testedApis} / {report.apiCoverage.discoveredApis} endpoints</span>
                </div>
                <div className="w-full bg-[var(--surface-hover)] h-2 rounded overflow-hidden">
                  <div className="bg-[var(--accent-primary)] h-full" style={{ width: `${report.apiCoverage.coveragePercentage}%` }}></div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="bg-[var(--surface-main)] p-2 rounded text-center">
                    <p className="text-[var(--text-secondary)]">Discovered</p>
                    <p className="font-mono text-white">{report.apiCoverage.discoveredApis}</p>
                  </div>
                  <div className="bg-[var(--surface-main)] p-2 rounded text-center">
                    <p className="text-[var(--text-secondary)]">Uncovered</p>
                    <p className="font-mono text-red-400">{report.apiCoverage.uncoveredApis}</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Project Code Coverage */}
          <div className="bg-[var(--surface-card)] border border-[var(--border-main)] rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-2 flex items-center border-b border-[var(--border-main)] pb-2">
              <BarChart2 className="mr-2" size={18} /> Project Code Coverage
            </h2>
            {!report.projectCodeCoverage ? (
              <p className="text-[var(--text-secondary)] text-sm italic">No coverage parser results recorded for this snapshot.</p>
            ) : (
              <div className="space-y-4">
                <p className="text-xs text-yellow-400/80 mb-4 p-2 bg-yellow-400/10 rounded border border-yellow-400/20 leading-tight">
                  <AlertCircle size={12} className="inline mr-1 flex-shrink-0" />
                  {report.projectCodeCoverage.warning}
                </p>
                
                <div className="flex justify-between items-end">
                  <span className="text-3xl font-bold text-white">{report.projectCodeCoverage.stmtsPct}%</span>
                  <span className="text-[var(--text-secondary)] text-sm">Statements</span>
                </div>
                <div className="w-full bg-[var(--surface-hover)] h-2 rounded overflow-hidden">
                  <div className="bg-green-500 h-full" style={{ width: `${report.projectCodeCoverage.stmtsPct}%` }}></div>
                </div>
                <div className="text-xs text-[var(--text-secondary)] text-right">
                  Recorded: {format(new Date(report.projectCodeCoverage.timestamp), 'MMM d, HH:mm:ss')}
                </div>
              </div>
            )}
          </div>
        </div>

        <IntegrationGuidancePanel projectId={projectId} />

        {/* History Tables */}
        <div className="space-y-8 pb-8">
          
          {/* Execution History */}
          <section className="bg-[var(--surface-card)] border border-[var(--border-main)] rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4 border-b border-[var(--border-main)] pb-2">Execution History</h2>
            {report.history.executions.length === 0 ? (
              <p className="text-[var(--text-secondary)] text-sm italic p-4 text-center">No execution history found.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-[var(--text-secondary)] bg-[var(--surface-main)]">
                    <tr>
                      <th className="px-4 py-3 rounded-tl">Time</th>
                      <th className="px-4 py-3">Snapshot</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Passed / Total</th>
                      <th className="px-4 py-3 rounded-tr">Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.history.executions.slice().reverse().map((run) => (
                      <tr key={run.testRunId} className="border-b border-[var(--border-main)] hover:bg-[var(--surface-hover)]">
                        <td className="px-4 py-3 font-mono text-xs">{format(new Date(run.timestamp), 'MMM d, HH:mm:ss')}</td>
                        <td className="px-4 py-3 font-mono text-xs">{run.snapshotId.substring(0,8)}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 rounded text-xs font-medium ${run.status === 'SUCCESS' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                            {run.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono">
                          <span className="text-green-400">{run.passedTests}</span> / {run.totalTests}
                        </td>
                        <td className="px-4 py-3 font-mono">{(run.durationMs / 1000).toFixed(1)}s</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Coverage History */}
          <section className="bg-[var(--surface-card)] border border-[var(--border-main)] rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4 border-b border-[var(--border-main)] pb-2">Project Code Coverage Trend</h2>
            {report.history.coverage.length === 0 ? (
              <p className="text-[var(--text-secondary)] text-sm italic p-4 text-center">No coverage history found.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-[var(--text-secondary)] bg-[var(--surface-main)]">
                    <tr>
                      <th className="px-4 py-3 rounded-tl">Time</th>
                      <th className="px-4 py-3">Snapshot</th>
                      <th className="px-4 py-3 rounded-tr">Statements %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.history.coverage.slice().reverse().map((cov, idx) => (
                      <tr key={idx} className="border-b border-[var(--border-main)] hover:bg-[var(--surface-hover)]">
                        <td className="px-4 py-3 font-mono text-xs">{format(new Date(cov.timestamp), 'MMM d, HH:mm:ss')}</td>
                        <td className="px-4 py-3 font-mono text-xs">{cov.snapshotId.substring(0,8)}</td>
                        <td className="px-4 py-3 font-mono">
                          <div className="flex items-center">
                            <span className="w-12">{cov.stmtsPct}%</span>
                            <div className="w-32 bg-[var(--surface-main)] h-1.5 rounded ml-2 overflow-hidden">
                              <div className="bg-green-500 h-full" style={{ width: `${cov.stmtsPct}%` }}></div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Generation History */}
          <section className="bg-[var(--surface-card)] border border-[var(--border-main)] rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4 border-b border-[var(--border-main)] pb-2">Generation History</h2>
            {report.history.generations.length === 0 ? (
              <p className="text-[var(--text-secondary)] text-sm italic p-4 text-center">No generation history found.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-[var(--text-secondary)] bg-[var(--surface-main)]">
                    <tr>
                      <th className="px-4 py-3 rounded-tl">Time</th>
                      <th className="px-4 py-3">Snapshot</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 rounded-tr">Mode</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.history.generations.slice().reverse().map((gen) => (
                      <tr key={gen.jobId} className="border-b border-[var(--border-main)] hover:bg-[var(--surface-hover)]">
                        <td className="px-4 py-3 font-mono text-xs">{format(new Date(gen.timestamp), 'MMM d, HH:mm:ss')}</td>
                        <td className="px-4 py-3 font-mono text-xs">{gen.snapshotId.substring(0,8)}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 rounded text-xs font-medium ${
                            gen.status === 'SUCCESS' ? 'bg-green-500/20 text-green-400' : 
                            gen.status === 'FAILED' ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'
                          }`}>
                            {gen.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">
                          {gen.mode}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

        </div>
      </div>
    </div>
  );
}
