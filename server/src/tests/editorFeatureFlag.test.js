import { test, expect, afterEach } from '@jest/globals';
import { editorEnabled } from '../../../shared/editorProtocol.js';

const originalEditorFlag = process.env.PROJECT_EDITOR_ENABLED;

afterEach(() => {
    if (originalEditorFlag === undefined) delete process.env.PROJECT_EDITOR_ENABLED;
    else process.env.PROJECT_EDITOR_ENABLED = originalEditorFlag;
});

test('enables live editing when the flag is unset', () => {
    delete process.env.PROJECT_EDITOR_ENABLED;
    expect(editorEnabled()).toBe(true);
});

test.each([
    ['empty string', '', true],
    ['true', 'true', true],
    ['false', 'false', false],
    ['padded uppercase FALSE', ' FALSE ', false],
    ['0 stays enabled because only the word false disables live editing', '0', true],
])('handles PROJECT_EDITOR_ENABLED set to %s', (_label, value, expected) => {
    process.env.PROJECT_EDITOR_ENABLED = value;
    expect(editorEnabled()).toBe(expected);
});
