export const codeHygieneConfig = Object.freeze({
    // null enables every plugin exported by the registry. Set explicit IDs to opt in selectively.
    enabledRuleIds: null,
    scoring: Object.freeze({
        maximumScore: 100,
        severityPenalties: Object.freeze({
            INFO: 1,
            WARNING: 5,
            HIGH: 10,
            CRITICAL: 20
        })
    })
});
