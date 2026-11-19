/** Load one CommonJS subject with test-owned dependency exports, then restore Node's cache. */
export function renderNativeCommonJsMockHarness(source, dependencies, { binding = 'subject' } = {}) {
    return `const subjectPath = require.resolve(${source});
const replacements = [
${dependencies.map(({ module, binding }) => `    [require.resolve(${module}), ${binding}],`).join('\n')}
];
const previous = [subjectPath, ...replacements.map(([id]) => id)].map(id => [id, require.cache[id]]);
let ${binding};
try {
    for (const [id, exports] of replacements) require.cache[id] = { id, filename: id, loaded: true, exports };
    delete require.cache[subjectPath];
    ${binding} = require(${source});
} finally {
    for (const [id, module] of previous) {
        if (module) require.cache[id] = module;
        else delete require.cache[id];
    }
}`;
}
