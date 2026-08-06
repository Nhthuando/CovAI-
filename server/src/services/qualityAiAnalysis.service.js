import { generateText } from "./gemini.service.js";
import { parseAiResponse } from "./aiSuggestionParser.service.js";

/**
 * Builds a structured prompt for Gemini to analyze code quality,
 * focusing on security issues and debug reports.
 */
export const buildQualityPrompt = ({
    sourceFiles,
    cyclomatics,
    coverageSummary,
    coverageFunctions,
    structureResult,
}) => {
    let prompt = `You are a senior code quality analyst. Analyze the following JavaScript/TypeScript project and provide a JSON response.

## Analysis Data

### Coverage Summary
`;

    if (coverageSummary) {
        prompt += `- Lines: ${coverageSummary.linesPct}%\n`;
        prompt += `- Branches: ${coverageSummary.branchesPct}%\n`;
        prompt += `- Functions: ${coverageSummary.funcsPct}%\n`;
        prompt += `- Statements: ${coverageSummary.stmtsPct}%\n\n`;
    } else {
        prompt += "No coverage data available.\n\n";
    }

    prompt += "### High Complexity Functions (CC > 5)\n";
    const highCC = (cyclomatics || [])
        .filter((c) => c.value > 5)
        .sort((a, b) => b.value - a.value)
        .slice(0, 20);
    if (highCC.length > 0) {
        highCC.forEach((c) => {
            prompt += `- ${c.functionName} (${c.filePath}) — CC=${c.value}\n`;
        });
    } else {
        prompt += "No high complexity functions found.\n";
    }
    prompt += "\n";

    prompt += "### Uncovered Functions\n";
    const uncovered = (coverageFunctions || []).filter((f) => f.hit === 0).slice(0, 20);
    if (uncovered.length > 0) {
        uncovered.forEach((f) => {
            prompt += `- ${f.functionName} (${f.filePath}:${f.startLine || "?"})\n`;
        });
    } else {
        prompt += "All functions have test coverage.\n";
    }
    prompt += "\n";

    if (structureResult?.graph?.externalDependencies) {
        prompt += "### External Dependencies\n";
        structureResult.graph.externalDependencies.slice(0, 30).forEach((dep) => {
            prompt += `- ${dep.name}${dep.isDev ? " (dev)" : ""}\n`;
        });
        prompt += "\n";
    }

    prompt += "### Source Code Samples (Top Risk Files)\n";
    if (sourceFiles && sourceFiles.length > 0) {
        sourceFiles.slice(0, 15).forEach((file) => {
            prompt += `#### ${file.path}\n\`\`\`javascript\n${file.content.slice(0, 3000)}\n\`\`\`\n\n`;
        });
    } else {
        prompt += "No source code available.\n\n";
    }

    prompt += `## Required JSON Response Format

Return ONLY a JSON block with this exact structure:

\`\`\`json
{
  "securityScore": <number 0-100>,
  "securityFindings": [
    {
      "severity": "Critical" | "Warning" | "Info",
      "title": "<short title>",
      "description": "<what the issue is and why it matters>",
      "filePath": "<affected file path>",
      "line": <line number or null>
    }
  ],
  "debugEntries": [
    {
      "severity": "Critical" | "Warning" | "Info",
      "functionName": "<function name>",
      "filePath": "<file path>",
      "reason": "<why this is risky>",
      "cc": <cyclomatic complexity or null>,
      "coveragePct": <coverage percentage or null>
    }
  ],
  "recommendations": [
    {
      "title": "<short action title>",
      "description": "<detailed actionable description>",
      "impact": "high" | "medium" | "low",
      "relatedFiles": ["<file paths>"]
    }
  ]
}
\`\`\`

Security scoring guidelines:
- 90-100: No unsafe patterns, minimal dependencies, good separation
- 70-89: Minor issues (unused exports, large dep count)
- 50-69: Moderate issues (eval usage, missing input validation)
- 0-49: Critical issues (hardcoded secrets, SQL injection patterns, command injection)

Provide 3-10 recommendations ordered by impact. Focus on actionable improvements.
For debugEntries, prioritize functions with HIGH CC AND LOW/ZERO coverage.`;

    return prompt;
};

/**
 * Parses and validates the AI response for quality analysis.
 * @param {string} responseText
 * @returns {{ securityScore: number, securityDetails: object, debugReport: object, recommendations: Array }}
 */
export const parseQualityAiResponse = (responseText) => {
    const parsed = parseAiResponse(responseText);

    const securityScore = typeof parsed.securityScore === "number"
        ? Math.max(0, Math.min(100, Math.round(parsed.securityScore * 10) / 10))
        : 50;

    const validSeverities = new Set(["Critical", "Warning", "Info"]);

    const securityFindings = Array.isArray(parsed.securityFindings)
        ? parsed.securityFindings.filter((f) => f && f.title && f.description).map((f) => ({
            severity: validSeverities.has(f.severity) ? f.severity : "Info",
            title: String(f.title).slice(0, 200),
            description: String(f.description).slice(0, 500),
            filePath: f.filePath || null,
            line: typeof f.line === "number" ? f.line : null,
        }))
        : [];

    const debugEntries = Array.isArray(parsed.debugEntries)
        ? parsed.debugEntries.filter((e) => e && e.functionName && e.reason).map((e) => ({
            severity: validSeverities.has(e.severity) ? e.severity : "Warning",
            functionName: String(e.functionName).slice(0, 200),
            filePath: e.filePath || null,
            reason: String(e.reason).slice(0, 500),
            cc: typeof e.cc === "number" ? e.cc : null,
            coveragePct: typeof e.coveragePct === "number" ? e.coveragePct : null,
        }))
        : [];

    const validImpacts = new Set(["high", "medium", "low"]);

    const recommendations = Array.isArray(parsed.recommendations)
        ? parsed.recommendations.filter((r) => r && r.title && r.description).slice(0, 10).map((r) => ({
            title: String(r.title).slice(0, 200),
            description: String(r.description).slice(0, 500),
            impact: validImpacts.has(r.impact) ? r.impact : "medium",
            relatedFiles: Array.isArray(r.relatedFiles) ? r.relatedFiles.map(String).slice(0, 5) : [],
        }))
        : [];

    return {
        securityScore,
        securityDetails: {
            findings: securityFindings,
            totalFindings: securityFindings.length,
            criticalCount: securityFindings.filter((f) => f.severity === "Critical").length,
            warningCount: securityFindings.filter((f) => f.severity === "Warning").length,
        },
        debugReport: {
            entries: debugEntries,
            totalEntries: debugEntries.length,
            criticalCount: debugEntries.filter((e) => e.severity === "Critical").length,
        },
        recommendations,
    };
};

/**
 * Orchestrates the AI quality analysis call.
 * Returns partial result with aiAvailable: false if Gemini fails.
 */
export const runQualityAiAnalysis = async (context) => {
    try {
        const prompt = buildQualityPrompt(context);

        const systemInstruction = "You are a code quality analyst. Respond ONLY with valid JSON. Do not include any text outside the JSON block.";
        const responseText = await generateText(prompt, systemInstruction);

        if (!responseText) {
            return {
                securityScore: 50,
                securityDetails: { findings: [], totalFindings: 0, criticalCount: 0, warningCount: 0 },
                debugReport: { entries: [], totalEntries: 0, criticalCount: 0 },
                recommendations: [],
                aiAvailable: false,
                aiError: "Gemini returned an empty response",
            };
        }

        const result = parseQualityAiResponse(responseText);
        return { ...result, aiAvailable: true, aiError: null };
    } catch (error) {
        console.error("[QualityAiAnalysis] Gemini call failed:", error.message);
        return {
            securityScore: 50,
            securityDetails: { findings: [], totalFindings: 0, criticalCount: 0, warningCount: 0 },
            debugReport: { entries: [], totalEntries: 0, criticalCount: 0 },
            recommendations: [],
            aiAvailable: false,
            aiError: error.message,
        };
    }
};
