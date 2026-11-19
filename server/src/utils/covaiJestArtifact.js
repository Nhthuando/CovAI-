const scriptName = String.raw`covai-(?:jest-(?:resolver(?:-[\w-]+)?|setup(?:-after-env)?)|setup-[\w-]+)`;
const configName = String.raw`covai-jest-[\w-]+\.json`;
const runtimePattern = String.raw`(?:${scriptName}\.cjs|${configName})`;
const derivedSuite = String.raw`${scriptName}\.(?:test|spec)\.[cm]?[jt]sx?`;

const runtime = new RegExp(String.raw`(?:^|[/\\])${runtimePattern}$`, "i");
export const covaiJestDerivedSuitePattern = String.raw`(?:^|[/\\])${derivedSuite}$`;
const derived = new RegExp(covaiJestDerivedSuitePattern, "i");

export const isCovaiJestRuntimeFile = file => typeof file === "string" && runtime.test(file);
export const isCovaiJestArtifact = file => isCovaiJestRuntimeFile(file) ||
    (typeof file === "string" && derived.test(file));
