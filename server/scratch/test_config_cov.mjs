import fs from "fs";
import { runJestCoverage } from "../src/services/runTestsJob.service.js";

const snapDir = "/app/storage/projects/cmus894xa00002ho2fwzkckq2/github/1791021997106/repo";
const fullUpdated = `import { defaultErrorSettings, defaultConfiguration, getJestCucumberConfiguration, setJestCucumberConfiguration } from '../src/configuration';

describe('configuration unit tests', () => {
    beforeEach(() => {
        setJestCucumberConfiguration({} as any);
    });

    test('defaultErrorSettings should match expected structure', () => {
        expect(defaultErrorSettings).toEqual({
            scenariosMustMatchFeatureFile: true,
            stepsMustMatchFeatureFile: true,
            allowScenariosNotInFeatureFile: false,
        });
    });

    test('defaultConfiguration should have expected default values', () => {
        expect(defaultConfiguration).toEqual({
            tagFilter: undefined,
            scenarioNameTemplate: undefined,
            errors: defaultErrorSettings,
        });
    });

    test('getJestCucumberConfiguration should return defaults when no options provided', () => {
        const config = getJestCucumberConfiguration();
        expect(config.errors).toEqual(defaultErrorSettings);
    });

    test('getJestCucumberConfiguration should convert true to defaultErrorSettings', () => {
        const config = getJestCucumberConfiguration({ errors: true });
        expect(config.errors).toEqual(defaultErrorSettings);
    });

    test('getJestCucumberConfiguration should use globalConfiguration', () => {
        setJestCucumberConfiguration({ tagFilter: '@smoke' });
        const config = getJestCucumberConfiguration();
        expect(config.tagFilter).toBe('@smoke');
    });

    test('getJestCucumberConfiguration should merge user options over global and defaults', () => {
        setJestCucumberConfiguration({ tagFilter: '@global' });
        const config = getJestCucumberConfiguration({ tagFilter: '@local' });
        expect(config.tagFilter).toBe('@local');
    });

    test('setJestCucumberConfiguration should update global configuration', () => {
        const custom = { tagFilter: '@test' };
        setJestCucumberConfiguration(custom);
        expect(getJestCucumberConfiguration()).toMatchObject(custom);
    });
});
`;

fs.writeFileSync(snapDir + "/tests/configuration.test.ts", fullUpdated, "utf8");
console.log("Updated configuration.test.ts");

const res = await runJestCoverage(null, snapDir, null, ["tests/configuration.test.ts"]);
console.log("Exit code:", res.exitCode);
const covSummary = JSON.parse(fs.readFileSync(snapDir + "/coverage/coverage-summary.json", "utf8"));
console.log("New coverage for configuration.ts:", covSummary[snapDir + "/src/configuration.ts"] || covSummary["src/configuration.ts"] || covSummary.total);
