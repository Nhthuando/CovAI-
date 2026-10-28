import fs from 'node:fs';
import coverage from 'istanbul-lib-coverage';
import { counter, unknownMeasurement, validateMeasurement } from './systemAssessmentContract.service.js';
import { digest } from './systemTestStaticAnalysis.service.js';
import { containedPath } from './fullSystemConfig.service.js';

export const collectSystemCoverage = ({ preparation, runtimeArtifacts = [], testRunId }) => {
    const tiers = {};
    for (const tier of ['frontend', 'backend']) {
        const prepared = preparation.tiers[tier];
        if (prepared.status) { tiers[tier] = unknownMeasurement(prepared.status, prepared.reasonCodes[0]); continue; }
        try {
            const map = coverage.createCoverageMap(prepared.zeroMaps);
            const observed = runtimeArtifacts.filter(artifact => artifact.tier === tier);
            if (!observed.length) { tiers[tier] = unknownMeasurement('NOT_MEASURED', 'NO_RUNTIME_COVERAGE'); continue; }
            for (const artifact of observed) {
                if (artifact.incompleteReasons?.length) throw new Error(artifact.incompleteReasons.join(','));
                if (artifact.measurementId !== preparation.manifest.measurementId || artifact.sourceHash !== preparation.manifest.sourceHash) throw new Error('RUN_ID_MISMATCH');
                for (const [file, data] of Object.entries(artifact.coverage || {})) {
                    const initial = prepared.zeroMaps[file];
                    if (!prepared.inventory.includes(file) || !initial || digest({ statementMap: data.statementMap, fnMap: data.fnMap, branchMap: data.branchMap }) !== digest({ statementMap: initial.statementMap, fnMap: initial.fnMap, branchMap: initial.branchMap })) throw new Error('SOURCE_MAP_MISMATCH');
                    for (const kind of ['s', 'f', 'b']) {
                        if (digest(Object.keys(data[kind] || {})) !== digest(Object.keys(initial[kind]))) throw new Error('INVALID_HIT_COUNTER_KEYS');
                        for (const [key, hits] of Object.entries(data[kind])) {
                            const values = kind === 'b' ? hits : [hits];
                            if (!Array.isArray(values) || kind === 'b' && values.length !== initial.b[key].length || !values.every(hit => Number.isSafeInteger(hit) && hit >= 0)) throw new Error('INVALID_HIT_COUNTER');
                        }
                    }
                }
                map.merge(artifact.coverage);
            }
            const omittedFiles = [...prepared.omittedFiles, ...prepared.inventory.filter(file => !prepared.zeroMaps[file]).map(file => ({ file, reason: 'NOT_INSTRUMENTED' }))];
            const summary = map.getCoverageSummary().data;
            const measurement = { schemaVersion: 1, status: omittedFiles.length ? 'PARTIAL' : 'MEASURED', provider: 'istanbul', tier,
                measurementId: preparation.manifest.measurementId, testRunId, sourceHash: preparation.manifest.sourceHash, testHash: preparation.manifest.testHash, scopeHash: preparation.manifest.scopeHash,
                artifactManifestHash: digest({ ...preparation.manifest, directory: undefined, runtimeArtifacts: observed }),
                scope: { ...preparation.manifest.coverageScope[tier], eligibleFiles: prepared.inventory.length, instrumentedFiles: Object.keys(prepared.zeroMaps).length, omittedFiles, window: 'AUT_LIFECYCLE', startupIncluded: true },
                counters: Object.fromEntries(['lines', 'branches', 'functions', 'statements'].map(key => [key, counter(summary[key].covered, summary[key].total)])),
                files: map.files().map(file => {
                    const coverage=map.fileCoverageFor(file),data=coverage.data,summary=coverage.toSummary().data;
                    return {filePath:file,counters:Object.fromEntries(['lines','branches','functions','statements'].map(key=>[key,counter(summary[key].covered,summary[key].total)])),uncoveredLines:coverage.getUncoveredLines(),
                        uncoveredBranches:Object.entries(data.b).flatMap(([id,hits])=>hits.flatMap((hit,index)=>hit===0?[{id,index,line:data.branchMap[id].locations?.[index]?.start.line || data.branchMap[id].loc.start.line}]:[])),
                        uncoveredFunctions:Object.entries(data.f).filter(([,hit])=>hit===0).map(([id])=>({id,line:data.fnMap[id].loc.start.line})),
                        uncoveredStatements:Object.entries(data.s).filter(([,hit])=>hit===0).map(([id])=>({id,line:data.statementMap[id].start.line}))};
                }), reasonCodes: omittedFiles.length ? ['INCOMPLETE_SOURCE_SCOPE'] : [],
            };
            tiers[tier] = validateMeasurement(measurement);
        } catch (error) { tiers[tier] = unknownMeasurement('INVALID', error.message); }
    }
    return { schemaVersion: 1, status: Object.values(tiers).every(tier => tier.status === 'MEASURED') ? 'MEASURED' : 'PARTIAL', tiers };
};

export const readRuntimeCoverage = preparation => {
    const result = [];
    let bytes = 0;
    for (const entry of fs.readdirSync(preparation.directory)) if (/^runtime-.*\.json$/.test(entry)) {
        const file = containedPath(preparation.directory, entry);
        if(fs.lstatSync(file).isSymbolicLink()) throw new Error('Coverage artifact symlink is invalid');
        bytes += fs.statSync(file).size;
        if (bytes > 50 * 1024 * 1024) throw new Error('Coverage artifacts exceed total size limit');
        result.push(JSON.parse(fs.readFileSync(file, 'utf8')));
    }
    return result;
};
