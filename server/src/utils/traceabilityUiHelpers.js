/**
 * Pure state machine and contract helpers representing the UI/UX logic
 * in FileCodeExecutionView.jsx and TestFileViewerPanel.jsx
 */

// 1. Smart Badge State Machine Resolver (Section 5.2)
export const resolveSmartBadgeState = (linkedTestFiles = [], summary = {}) => {
    const stmtsCovered = summary?.statements?.covered || 0;

    if (linkedTestFiles && linkedTestFiles.length > 1) {
        return {
            type: "MULTI_LINKED",
            count: linkedTestFiles.length,
            options: linkedTestFiles.map(tf => ({
                filePath: tf.filePath,
                fileName: tf.fileName,
                label: `${tf.fileName} (${tf.relationType === "DIRECT_IMPORT" ? "Import" : "Linked"})`
            }))
        };
    }

    if (linkedTestFiles && linkedTestFiles.length === 1 && linkedTestFiles[0].found) {
        return {
            type: "SINGLE_LINKED",
            testFile: linkedTestFiles[0],
            label: `Test: ${linkedTestFiles[0].fileName}`,
            relation: linkedTestFiles[0].relationType
        };
    }

    if (stmtsCovered > 0) {
        return {
            type: "INTEGRATION_COVERED",
            label: "⚡ Covered via integration suite",
            coveragePct: summary?.statements?.pct || 0
        };
    }

    return {
        type: "GREENFIELD_UNTESTED",
        label: "⚠️ No linked test file",
        readyForAi: true
    };
};

// 2. Tabs Bar Generation Logic (Section 5.3)
export const generateLinkedTestTabs = (linkedTestFiles = [], selectedPath = null) => {
    if (!linkedTestFiles || linkedTestFiles.length <= 1) {
        return { showTabsBar: false, tabs: [] };
    }

    const effectiveSelected = selectedPath || linkedTestFiles[0].filePath;

    const tabs = linkedTestFiles.map(tf => ({
        filePath: tf.filePath,
        fileName: tf.fileName,
        isSelected: tf.filePath === effectiveSelected,
        badgeText: tf.relationType === "DIRECT_IMPORT" ? "Import" : "Trace",
        framework: (tf.framework || "jest").toUpperCase()
    }));

    return { showTabsBar: true, tabs };
};

// 3. AI Suggestion Status Badge Machine (Section 5.4)
export const resolveSuggestionStatusBadge = (status) => {
    switch (status) {
        case "APPLYING":
            return { label: "Applying...", color: "blue", spin: true };
        case "PASSED":
        case "APPLIED":
            return { label: "✓ Applied & Passed", color: "green", spin: false };
        case "FAILED":
            return { label: "✗ Test Failed", color: "red", spin: false };
        case "EDITED":
            return { label: "Edited", color: "purple", spin: false };
        case "REJECTED":
            return { label: "Rejected", color: "gray", spin: false };
        default:
            return { label: "Ready to Apply", color: "cyan", spin: false };
    }
};
