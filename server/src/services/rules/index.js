import { ConsoleRule } from './console.rule.js';
import { DebuggerRule } from './debugger.rule.js';
import { TemporaryCommentRule } from './temporaryComment.rule.js';

export const registeredCodeHygieneRules = Object.freeze([
    ConsoleRule,
    DebuggerRule,
    TemporaryCommentRule
]);
