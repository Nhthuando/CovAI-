import traverseModule from "@babel/traverse";
import { parseJavaScriptCode } from "./babelParser.service.js";

const traverse = traverseModule.default || traverseModule;
const runnerModule = node => node?.type === "CallExpression" &&
    node.callee?.type === "Identifier" && node.callee.name === "require" &&
    node.arguments?.length === 1 ? node.arguments[0]?.value : null;

export function isVitestTestCode(code, { framework, filePath = "" } = {}) {
    if (framework?.toLowerCase() === "vitest" || /\.vitest\./i.test(filePath)) return true;
    if (!/(?:from\s*|require\s*\(\s*|import\s*\(\s*)['"]vitest['"]/.test(code)) return false;
    const parsed = parseJavaScriptCode(code);
    if (!parsed.success) return true; // Protect runner imports while syntax repairs are pending.
    let found = false;
    traverse(parsed.ast, {
        ImportDeclaration(p) { if (p.node.source.value === "vitest") found = true; },
        ImportExpression(p) { if (p.node.source.value === "vitest") found = true; },
        CallExpression(p) { if (runnerModule(p.node) === "vitest" && !p.scope.getBinding("require")) found = true; }
    });
    return found;
}

/** Normalize runner APIs only. Never replace assertions, source imports or local mocks. */
export function normalizeTestFrameworkCode(code, options = {}) {
    if (!code || typeof code !== "string") return code;
    const parsed = parseJavaScriptCode(code);
    if (!parsed.success) return code;
    const isVitest = isVitestTestCode(code, options);
    const isEsm = isVitest || /\.m[jt]s$/i.test(options.filePath || "") ||
        options.moduleType === "module" || parsed.ast.program.sourceType === "module";
    if (!isVitest && !isEsm) return code;

    const edits = [];
    const imports = new Set();
    const replace = (node, text) => edits.push({ start: node.start, end: node.end, text });
    let program;
    traverse(parsed.ast, { Program(p) { program = p; } });
    const viBinding = program.scope.getBinding("vi");
    const viIsRunner = (viBinding?.path.isImportSpecifier() &&
        viBinding.path.parent.source.value === "vitest" && viBinding.path.node.imported.name === "vi") ||
        (viBinding?.path.isVariableDeclarator() && runnerModule(viBinding.path.node.init) === "vitest" &&
            viBinding.path.node.id.type === "ObjectPattern" && viBinding.path.node.id.properties.some(prop =>
                prop.key?.name === "vi" && prop.value?.name === "vi"));
    const viName = !viBinding || viIsRunner ? "vi" : program.scope.generateUidIdentifier("vitestMock").name;
    const namespace = program.scope.generateUidIdentifier("vitestApi").name;
    const importVi = () => imports.add(`import { vi${viName === "vi" ? "" : ` as ${viName}`} } from 'vitest';`);

    traverse(parsed.ast, {
        ImportDeclaration(p) {
            if (!isVitest || p.node.source.value !== "@jest/globals") return;
            const names = p.node.specifiers.map(s => {
                if (s.type === "ImportNamespaceSpecifier") return `* as ${s.local.name}`;
                const imported = s.imported?.name;
                return `${imported === "jest" ? "vi" : imported}${s.local.name !== (imported === "jest" ? "vi" : imported) ? ` as ${s.local.name}` : ""}`;
            });
            replace(p.node, `import ${names[0]?.startsWith("*") ? names[0] : `{ ${names.join(", ")} }`} from 'vitest';`);
        },
        VariableDeclaration(p) {
            if (!isVitest || !p.parentPath.isProgram()) return;
            const parts = [];
            let changed = false;
            for (const decl of p.node.declarations) {
                const mod = runnerModule(decl.init);
                if (!["vitest", "@jest/globals"].includes(mod) || p.scope.getBinding("require")) {
                    parts.push(`${p.node.kind} ${code.slice(decl.start, decl.end)};`);
                    continue;
                }
                if (decl.id.type === "Identifier") {
                    parts.push(`import * as ${decl.id.name} from 'vitest';`);
                } else if (decl.id.type === "ObjectPattern" && decl.id.properties.every(prop =>
                    prop.type === "ObjectProperty" && !prop.computed && prop.value.type === "Identifier")) {
                    const names = decl.id.properties.map(prop => {
                        const imported = prop.key.name === "jest" ? "vi" : prop.key.name;
                        return `${imported}${imported !== prop.value.name ? ` as ${prop.value.name}` : ""}`;
                    });
                    parts.push(`import { ${names.join(", ")} } from 'vitest';`);
                } else {
                    parts.push(`${p.node.kind} ${code.slice(decl.start, decl.end)};`);
                    continue;
                }
                changed = true;
            }
            if (changed) replace(p.node, parts.join("\n"));
        },
        CallExpression(p) {
            if (!isVitest || runnerModule(p.node) !== "vitest" || p.scope.getBinding("require")) return;
            // Non-declaration uses still receive the real ESM module, never require('vitest').
            if (edits.some(edit => edit.start <= p.node.start && edit.end >= p.node.end)) return;
            imports.add(`import * as ${namespace} from 'vitest';`);
            replace(p.node, namespace);
        },
        ReferencedIdentifier(p) {
            if (isVitest && ["describe", "test", "it", "expect", "beforeEach", "afterEach", "beforeAll", "afterAll", "vi"].includes(p.node.name) && !p.scope.getBinding(p.node.name)) {
                imports.add(`import { ${p.node.name} } from 'vitest';`);
            }
            const binding = p.scope.getBinding(p.node.name);
            const importedJest = binding?.path.isImportSpecifier() && binding.path.parent.source.value === "@jest/globals" && binding.path.node.imported.name === "jest";
            const requiredJest = binding?.path.isVariableDeclarator() && runnerModule(binding.path.node.init) === "@jest/globals" &&
                binding.path.node.id.type === "ObjectPattern" && binding.path.node.id.properties.some(prop =>
                    prop.key?.name === "jest" && prop.value?.name === p.node.name);
            if (p.node.name !== "jest" && !importedJest && !requiredJest) return;
            if (binding && !importedJest && !requiredJest) return;
            if (isVitest) {
                if (!viIsRunner) importVi();
                replace(p.node, p.parentPath.isObjectProperty() && p.parent.shorthand ? `${p.node.name}: ${viName}` : viName);
            } else if (!binding) {
                imports.add("import { jest } from '@jest/globals';");
            }
        }
    });
    // Declarations consume their children; apply source edits without reprinting user code.
    const outerEdits = edits.filter(edit => !edits.some(other => other !== edit &&
        other.start <= edit.start && other.end >= edit.end && (other.start !== edit.start || other.end !== edit.end)));
    let result = code;
    for (const edit of outerEdits.sort((a, b) => b.start - a.start)) {
        result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
    }
    return imports.size ? `${[...imports].join("\n")}\n${result}` : result;
}
