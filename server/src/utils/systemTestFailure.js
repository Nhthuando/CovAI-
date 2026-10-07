export const formatSystemTestFailure = ({ stdout = "", stderr = "", exitCode }) => {
  try {
    const report = JSON.parse(stdout);
    const messages = (report.errors || []).map(error => error.message).filter(Boolean);
    const walk = (suite) => {
      for (const spec of suite.specs || []) for (const test of spec.tests || []) {
        if (test.status !== "unexpected") continue;
        const result = test.results?.at(-1);
        const errors = result?.errors?.length ? result.errors : [result?.error];
        for (const error of errors) if (error?.message) messages.push(`${spec.title}: ${error.message}`);
      }
      for (const child of suite.suites || []) walk(child);
    };
    for (const suite of report.suites || []) walk(suite);
    if (messages.length) return messages.join("\n").replace(/\u001b\[[0-9;]*m/g, "");
  } catch { /* Use plain process output when no JSON report is available. */ }
  return stderr.trim() || stdout.trim() || `Process exited with code ${exitCode}`;
};
