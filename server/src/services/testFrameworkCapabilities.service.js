import traverseModule from '@babel/traverse';

const traverse = traverseModule.default || traverseModule;
const shared = {
    spy: ['spyOn'], reset: ['resetModules', 'clearAllMocks', 'resetAllMocks', 'restoreAllMocks'],
    lifecycle: ['beforeEach', 'afterEach', 'beforeAll', 'afterAll'],
    asyncAssertions: ['resolves', 'rejects'],
    matchers: ['toBe', 'toEqual', 'toStrictEqual', 'toHaveBeenCalled', 'toHaveBeenCalledWith', 'toThrow'],
};
export const FRAMEWORK_CAPABILITIES = {
    jest: { ...shared, namespace: 'jest', module: '@jest/globals', mocks: ['fn', 'mock', 'doMock', 'unmock', 'dontMock', 'requireActual', 'requireMock', 'unstable_mockModule'] },
    vitest: { ...shared, namespace: 'vi', module: 'vitest', mocks: ['fn', 'mock', 'doMock', 'unmock', 'doUnmock', 'importActual', 'importMock', 'hoisted', 'stubEnv'], matchers: [...shared.matchers, 'toBeTypeOf', 'toSatisfy'] },
};

export function frameworkCompatibilityFindings(ast, framework) {
    const current = FRAMEWORK_CAPABILITIES[framework];
    if (!current) return [];
    const other = FRAMEWORK_CAPABILITIES[framework === 'jest' ? 'vitest' : 'jest'];
    const findings = [];
    const add = (node, api) => findings.push({ api, line: node.loc?.start.line });
    const bindingModule = binding => binding?.path.parentPath?.isImportDeclaration() ? binding.path.parentPath.node.source.value : null;
    traverse(ast, {
        ImportDeclaration(p) {
            if (p.node.source.value === other.module) add(p.node, other.module);
        },
        CallExpression(p) {
            const { callee, arguments: args } = p.node;
            if (callee.name === 'require' && !p.scope.getBinding('require') && args[0]?.value === other.module) add(p.node, other.module);
            if (callee.type !== 'MemberExpression' || callee.computed) return;
            const name = callee.object.name;
            const api = callee.property.name;
            const binding = p.scope.getBinding(name);
            const runner = bindingModule(binding) === current.module || (!binding && name === current.namespace);
            if (runner && ((other.mocks.includes(api) && !current.mocks.includes(api)) ||
                /^mock(?:ResolvedValue|RejectedValue|ReturnValue|Implementation)(?:Once)?$/.test(api))) add(p.node, name + '.' + api);
            if (!binding && name === other.namespace && [...other.mocks, ...other.spy, ...other.reset].includes(api)) add(p.node, name + '.' + api);
            let expectation = callee.object;
            while (expectation.type === 'MemberExpression' && !expectation.computed &&
                ['not', ...shared.asyncAssertions].includes(expectation.property.name)) expectation = expectation.object;
            if (expectation.callee?.name === 'expect' && other.matchers.includes(api) && !current.matchers.includes(api)) {
                const expect = p.scope.getBinding('expect');
                if (!expect || bindingModule(expect) === current.module) add(p.node, api);
            }
        },
    });
    return findings;
}
