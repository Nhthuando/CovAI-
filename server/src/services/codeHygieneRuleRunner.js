import traverseModule from '@babel/traverse';
import { codeHygieneConfig } from '../config/codeHygiene.config.js';
import { registeredCodeHygieneRules } from './rules/index.js';

const traverse = traverseModule.default ?? traverseModule;

/**
 * Executes registered rule plugins during one Babel AST traversal.
 * It is intentionally unaware of individual rules and issue categories.
 */
export class CodeHygieneRuleRunner {
    constructor({ rules = registeredCodeHygieneRules, config = codeHygieneConfig } = {}) {
        const enabled = config.enabledRuleIds ? new Set(config.enabledRuleIds) : null;
        this.rules = enabled ? rules.filter((rule) => enabled.has(rule.id)) : rules;
    }

    run(ast, filePath) {
        const issues = [];
        const collect = (issue, rule, location) => {
            if (!issue) return;
            issues.push({
                ...issue,
                filePath,
                line: location?.start?.line ?? 0,
                column: location?.start?.column ?? 0,
                rule: rule.id
            });
        };

        traverse(ast, {
            enter: (nodePath) => {
                for (const rule of this.rules) collect(rule.check?.(nodePath.node), rule, nodePath.node.loc);
            }
        });

        for (const comment of ast.comments ?? []) {
            for (const rule of this.rules) collect(rule.checkComment?.(comment), rule, comment.loc);
        }
        return issues;
    }
}
