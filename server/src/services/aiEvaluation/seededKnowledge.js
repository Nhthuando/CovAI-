import _traverse from '@babel/traverse';
import { parseJavaScriptCode } from '../babelParser.service.js';

const traverse = _traverse.default || _traverse;

// Seed/ingest scripts that write the chatbot's knowledge base straight from code.
export const SEED_SCRIPT_PATH = /(?:^|\/)(?:[\w.-]*seed[\w.-]*|[\w.-]*ingest[\w.-]*|[\w.-]*knowledge[\w.-]*)\.[cm]?[jt]s$|(?:^|\/)(?:seeds?|seeders?|knowledge)\/[^/]+\.[cm]?[jt]s$/i;
const KNOWLEDGE_HINT = /knowledge|faq|polic|chunk|article|document|answer|kb\b|help/i;
const TEXT_KEYS = ['content', 'answer', 'text', 'body'];
const TITLE_KEYS = ['title', 'name', 'question', 'section', 'heading'];
const MIN_TEXT = 40;

const keyOf = property => property.key?.name ?? property.key?.value;

function staticText(node) {
    if (!node) return null;
    if (node.type === 'StringLiteral') return node.value;
    if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis.map(quasi => quasi.value.cooked).join('');
    if (node.type === 'BinaryExpression' && node.operator === '+') {
        const left = staticText(node.left);
        const right = staticText(node.right);
        return left !== null && right !== null ? left + right : null;
    }
    return null;
}

function fieldOf(objectNode, keys) {
    for (const key of keys) {
        const property = objectNode.properties.find(item => item.type === 'ObjectProperty' && keyOf(item) === key);
        const text = staticText(property?.value);
        if (text?.trim()) return text.trim();
    }
    return null;
}

/**
 * Reads knowledge text that a seed script writes into the database
 * ({ title, chunks: [{ section, content }] }, { question, answer }, ...).
 * Returns Markdown grouped by document, or null when the file seeds no knowledge.
 */
export function extractSeededKnowledge(code, filePath = 'seed.js') {
    let ast;
    try {
        const parsed = parseJavaScriptCode(code, { filePath, allowRecoveredAst: true });
        ast = parsed?.ast;
    } catch (error) {
        console.warn(`[SeededKnowledge] Could not parse ${filePath}: ${error?.message || error}`);
        return null;
    }
    if (!ast) return null;
    const documents = new Map();
    let entries = 0;
    traverse(ast, {
        ObjectExpression(path) {
            const node = path.node;
            const text = fieldOf(node, TEXT_KEYS);
            if (!text || text.length < MIN_TEXT) return;
            // Only objects that sit inside knowledge-like data (variable, property or call names).
            const context = [];
            for (let current = path.parentPath; current && context.length < 8; current = current.parentPath) {
                if (current.isVariableDeclarator()) context.push(current.node.id?.name || '');
                if (current.isObjectProperty()) context.push(String(keyOf(current.node) || ''));
                if (current.isCallExpression()) context.push(code.slice(current.node.callee.start, current.node.callee.end));
            }
            const ownKeys = node.properties.map(keyOf).filter(Boolean).join(' ');
            if (!KNOWLEDGE_HINT.test(`${context.join(' ')} ${ownKeys}`)) return;
            const parentDocument = path.findParent(candidate => candidate.isObjectExpression() && candidate.node !== node && fieldOf(candidate.node, ['title', 'name', 'documentId']));
            const documentTitle = parentDocument ? fieldOf(parentDocument.node, ['title', 'name', 'documentId']) : 'Knowledge';
            const sectionTitle = fieldOf(node, TITLE_KEYS.filter(key => !(parentDocument && key === 'name')));
            if (!documents.has(documentTitle)) documents.set(documentTitle, []);
            documents.get(documentTitle).push({ sectionTitle: sectionTitle === documentTitle ? null : sectionTitle, text });
            entries += 1;
            path.skip();
        },
    });
    const totalLength = [...documents.values()].flat().reduce((sum, entry) => sum + entry.text.length, 0);
    if (entries < 2 || totalLength < 200) return null;
    return [...documents].map(([title, sections]) => [
        `# ${title}`,
        ...sections.map(section => (section.sectionTitle ? `## ${section.sectionTitle}\n\n${section.text}` : section.text)),
    ].join('\n\n')).join('\n\n');
}
