import { calculatePerformance, detectSlowFunctions } from '../services/performance.service.js';

const cyclomatics = [
    { filePath: 'src/math.js', functionName: 'fast', value: 3 },
    { filePath: 'src/math.js', functionName: 'complex', value: 16 },
    { filePath: 'src/io.js', functionName: 'uncovered', value: 8 }
];
const coverageData = {
    summary: { linesPct: 80 },
    functions: [
        { filePath: 'src/math.js', functionName: 'fast', hit: 3 },
        { filePath: 'src/math.js', functionName: 'complex', hit: 1 },
        { filePath: 'src/io.js', functionName: 'uncovered', hit: 0 }
    ]
};

describe('Performance Analysis Service', () => {
    test('collects execution time and exposes a complete report payload', () => {
        const result = calculatePerformance({
            snapshotId: 'snapshot-1', cyclomatics, coverageData, executionTimeMs: 2_500
        });

        expect(result).toMatchObject({ executionTimeMs: 2500, executionScore: 100, pipelineExecutionScore: 100 });
        expect(result.slowFunctions.map((item) => item.functionName).sort()).toEqual(['complex', 'uncovered']);
    });

    test('marks complex or high-risk functions as slow-function candidates', () => {
        expect(detectSlowFunctions(cyclomatics, coverageData.functions)).toHaveLength(2);
    });
});
