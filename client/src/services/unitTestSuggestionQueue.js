import { needsUnitTestSuggestion } from '../../../shared/unitTestCoverageGoal.js';
export { needsUnitTestSuggestion };

export async function loadSuggestionSourceFiles(loadPage, initialFiles = []) {
    const files = new Map(initialFiles.map(file => [file.filePath, file]));
    let page = 1;
    let totalPages = 1;
    do {
        const response = await loadPage(page);
        const data = response?.data || response;
        for (const file of data.files || []) files.set(file.filePath, file);
        totalPages = Math.max(1, data.pagination?.totalPages || 1);
        page += 1;
    } while (page <= totalPages);
    return [...files.values()];
}
