import { codeHygieneConfig } from '../config/codeHygiene.config.js';

export const calculateHygieneScore = (severityCounts, scoring = codeHygieneConfig.scoring) => {
    const penalty = Object.entries(scoring.severityPenalties)
        .reduce((total, [severity, weight]) => total + (severityCounts[severity] ?? 0) * weight, 0);
    return Math.max(0, scoring.maximumScore - penalty);
};

export const calculateSummary = (issues, config = codeHygieneConfig) => {
    const severityCounts = { INFO: 0, WARNING: 0, HIGH: 0, CRITICAL: 0 };
    for (const issue of issues) severityCounts[issue.severity]++;

    return {
        totalIssues: issues.length,
        infoCount: severityCounts.INFO,
        warningCount: severityCounts.WARNING,
        highCount: severityCounts.HIGH,
        criticalCount: severityCounts.CRITICAL,
        hygieneScore: calculateHygieneScore(severityCounts, config.scoring)
    };
};
