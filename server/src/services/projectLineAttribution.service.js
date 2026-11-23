import { diffLines } from 'diff';

export const logicalLines = text => text ? text.match(/[^\n]*\n|[^\n]+$/g) || [] : [];
export function advanceLineAttribution({ before, after, ranges = [], changeId }) {
    if (before === after) return ranges;
    const previous = [];
    for (const range of ranges) for (let line = range.start; line <= range.end; line++) previous[line - 1] = range.changeId;
    const diff = diffLines(before, after, { timeout: 50 });
    if (!diff) return [];
    const authors = [];
    let offset = 0;
    for (const part of diff) {
        const count = logicalLines(part.value).length;
        if (part.removed) offset += count;
        else if (part.added) for (let i = 0; i < count; i++) authors.push(changeId);
        else for (let i = 0; i < count; i++) authors.push(previous[offset++] ?? null);
    }
    const result = [];
    authors.forEach((id, index) => {
        if (!id) return;
        const last = result.at(-1);
        if (last?.changeId === id && last.end === index) last.end++;
        else result.push({ start: index + 1, end: index + 1, changeId: id });
    });
    return result;
}
