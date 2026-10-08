import { autoHealTestFailures } from './services/applyTestSuggestion.service.js';
import { execSync } from 'child_process';
import path from 'path';

const rootDir = '/app/storage/projects/cmuwtqrg700007job0o1pzjn3/github/1791299956057/repo/backend';
const testFilesToRun = ['tests/services/ai.service.test.js'];

// Run multi-pass auto healing up to 3 passes
for (let pass = 1; pass <= 3; pass++) {
  let rawOutput = '';
  let testResults = null;
  try {
    const jsonStr = execSync('npx jest tests/services/ai.service.test.js --json', { cwd: rootDir, encoding: 'utf8', stdio: 'pipe' });
    testResults = JSON.parse(jsonStr);
    console.log(`Pass ${pass}: All tests passed!`);
    break;
  } catch (err) {
    rawOutput = err.stdout || err.stderr || '';
    try {
      const jsonMatch = rawOutput.match(/\{[\s\S]*"testResults"[\s\S]*\}/);
      if (jsonMatch) testResults = JSON.parse(jsonMatch[0]);
    } catch {}
    console.log(`Pass ${pass}: Failed tests:`, testResults?.numFailedTests);
    const healed = autoHealTestFailures(rootDir, testFilesToRun, testResults, rawOutput);
    console.log(`Pass ${pass}: Healed:`, healed);
    if (!healed) break;
  }
}

// Final verify
try {
  const rerun = execSync('npx jest tests/services/ai.service.test.js --coverage --collectCoverageFrom=src/services/ai.service.js', { cwd: rootDir, encoding: 'utf8', stdio: 'pipe' });
  console.log('FINAL JEST WITH COVERAGE SUCCESS:\n', rerun);
} catch (rErr) {
  console.log('FINAL JEST FAILED:\n', rErr.stdout || rErr.stderr);
}
