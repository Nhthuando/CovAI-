import { IssueType, Severity } from '../../constants/codeHygiene.constants.js';

const COMMENT_TYPES = Object.freeze({
    TODO: Object.freeze({ type: IssueType.TODO, severity: Severity.INFO }),
    FIXME: Object.freeze({ type: IssueType.FIXME, severity: Severity.WARNING }),
    HACK: Object.freeze({ type: IssueType.HACK, severity: Severity.HIGH })
});

export const TemporaryCommentRule = Object.freeze({
    id: 'temporary-comments',
    name: 'Temporary comments',
    description: 'Finds TODO, FIXME, and HACK comments that require follow-up.',
    category: 'maintainability',
    defaultSeverity: Severity.INFO,
    version: '1.0.0',
    tags: Object.freeze(['comments', 'technical-debt', 'maintainability']),
    checkComment(comment) {
        for (const [keyword, metadata] of Object.entries(COMMENT_TYPES)) {
            if (new RegExp(`\\b${keyword}\\b`, 'i').test(comment.value)) {
                return { ...metadata, message: `Resolve ${keyword} comment.` };
            }
        }
        return null;
    }
});
