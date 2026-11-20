// Unknown coverage is eligible for measurement/generation, never proof of completion.
export function needsUnitTestSuggestion(file = {}) {
    return ['stmtsPct', 'branchesPct', 'funcsPct', 'linesPct'].some(key => {
        const value = file[key];
        return value == null || value === '' || !Number.isFinite(Number(value)) || Number(value) < 100;
    });
}
