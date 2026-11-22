import { parse } from '@babel/parser';

const literal = node => ['StringLiteral', 'NumericLiteral', 'BooleanLiteral'].includes(node?.type)
    ? node.value : node?.type === 'Literal' ? node.value : undefined;
const keyName = node => node?.name ?? literal(node);
const memberName = node => node?.type === 'MemberExpression' ? keyName(node.property) : null;
const fieldName = node => node?.type === 'Identifier' ? node.name
    : node?.type === 'MemberExpression' ? keyName(node.property)
        : node?.type === 'CallExpression' && memberName(node.callee) === 'trim' ? fieldName(node.callee.object) : null;
const children = node => Object.entries(node || {}).flatMap(([key, value]) => {
    if (['loc', 'start', 'end', 'extra', 'comments', 'tokens'].includes(key)) return [];
    return Array.isArray(value) ? value.filter(item => item?.type)
        : value?.type ? [value] : [];
});
const humanMessage = value => {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    const tokens = text.split(/\s+/);
    return text.length >= 3 && text.length <= 200 && /^[a-z]/i.test(text) && tokens.length >= 2
        && tokens.filter(token => /[-_]/.test(token)).length < tokens.length / 2
        && !/(?:https?:|www\.|[/\\]|(?:^|\s)[.#\[]|\s[>+~]\s)/i.test(text) ? text : null;
};
const textMessage = text => {
    for (const match of text.matchAll(/(['"])((?:\\.|(?!\1)[^\\])*)\1/g)) {
        const message = humanMessage(match[2]);
        if (message) return message;
    }
    return null;
};
const firstString = node => {
    if (!node) return null;
    if (typeof literal(node) === 'string') return humanMessage(literal(node));
    for (const child of children(node)) {
        const result = firstString(child);
        if (result !== null) return result;
    }
    return null;
};
const chainOf = node => {
    if (node?.type !== 'CallExpression') return [];
    if (node.callee.type === 'MemberExpression') {
        return [...chainOf(node.callee.object), { name: memberName(node.callee), args: node.arguments, node }];
    }
    return [{ name: keyName(node.callee), args: node.arguments, node }];
};
const limit = (value, fallback) => Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
const normalizedField = field => String(field).replace(/\s+/g, '').toLowerCase();
const skippedPath = path => /(^|\/)(node_modules|dist|build|tests|__tests__)(\/|$)|\.(test|spec)\./i.test(path)
    || /(?:^|\/)(?:[^/]+\.config\.(?:js|mjs|cjs|ts)|(?:playwright\.config|vite\.config|webpack|babel|jest)\.[^/]+|eslint[^/]*)$/i.test(path);
const errorText = text => /\b(error|invalid|required|must|missing|failed|cannot)\b|too (short|long)|at (least|most)/i.test(text);
const returnedError = node => !!node && (
    /error/i.test(fieldName(node) || '')
    || node.type === 'ObjectProperty' && /^(?:error|errors)$/i.test(keyName(node.key) || '')
    || node.type === 'NewExpression' && /error/i.test(keyName(node.callee) || '')
    || children(node).some(returnedError));
const rejects = node => {
    if (!node) return false;
    if (node.type === 'ThrowStatement') return true;
    if (node.type === 'ReturnStatement' && (literal(node.argument) === false || returnedError(node.argument))) return true;
    if (node.type === 'CallExpression') {
        const name = memberName(node.callee) || keyName(node.callee) || '';
        if (/set\w*Error|setMessage|alert|toast/i.test(name) || /^toast$/i.test(fieldName(node.callee.object) || '')) return true;
        if (name === 'status' && fieldName(node.callee.object) === 'res' && literal(node.arguments[0]) >= 400 && literal(node.arguments[0]) < 500) return true;
    }
    if (humanMessage(literal(node)) && errorText(literal(node))) return true;
    return children(node).some(rejects);
};
const lengthRule = (operator, value, rejection) => {
    if ((operator === '>' && value === 0) || (operator === '>=' && value === 1)
        || (['!==', '!='].includes(operator) && value === 0)
        || (['===', '=='].includes(operator) && value === 0 && rejection)) return ['required', null];
    if (operator === '<' && value >= 2) return ['minLength', value];
    if (operator === '<=' && value >= 1) return rejection ? ['minLength', value + 1] : ['maxLength', value];
    if (operator === '>=' && value >= 2) return rejection ? ['maxLength', value - 1] : ['minLength', value];
    if (operator === '>' && value >= 1 && rejection) return ['maxLength', value];
    return null;
};

const registerTextFields = (content, register) => {
    for (const tag of content.matchAll(/<(?:input|textarea|select)\b[^>]*>/gi)) {
        for (const attr of tag[0].matchAll(/\b(?:name|id|placeholder|aria-label)\s*=\s*(?:\{\s*)?(['"])(.*?)\1/gi)) register(attr[2]);
        for (const attr of tag[0].matchAll(/\bvalue\s*=\s*\{\s*([\w$]+(?:\.[\w$]+)*)\s*\}/g)) register(attr[1].split('.').at(-1));
    }
    for (const match of content.matchAll(/\breq\.body\.([\w$]+)/g)) register(match[1]);
    for (const match of content.matchAll(/\b(?:const|let|var)\s*\{([^}]+)\}\s*=\s*req\.body\b/g)) {
        for (const entry of match[1].split(',')) {
            const parts = entry.trim().match(/^([\w$]+)(?:\s*:\s*([\w$]+))?/);
            if (parts) { register(parts[1]); if (parts[2]) register(parts[2]); }
        }
    }
    for (const match of content.matchAll(/\b(?:body|check)\s*\(\s*(['"])(.*?)\1/g)) register(match[2]);
};

// HTML and incomplete source use the same conservative attribute/manual-check fallback.
const scanText = (content, add, manual = true, addManual = add) => {
    for (const match of content.matchAll(/<(?:input|textarea|select)\b[^>]*>/gi)) {
        const attrs = new Map();
        for (const attr of match[0].matchAll(/\b(name|id|placeholder|type|required|minLength|maxLength|pattern|min|max)\b(?:\s*=\s*(?:\{\s*([^}]+)\s*\}|"([^"]*)"|'([^']*)'|([^\s>]+)))?/gi)) {
            const raw = (attr[2] ?? attr[3] ?? attr[4] ?? attr[5] ?? '').trim();
            attrs.set(attr[1].toLowerCase(), raw.replace(/^(['"])(.*)\1$/, '$2'));
        }
        const field = attrs.get('name') || attrs.get('id') || attrs.get('placeholder')?.toLowerCase();
        if (!field) continue;
        for (const [attr, rule] of [['required', 'required'], ['minlength', 'minLength'], ['maxlength', 'maxLength'], ['pattern', 'pattern'], ['min', 'min'], ['max', 'max']]) {
            if (!attrs.has(attr) || (rule === 'required' && attrs.get(attr) === 'false')) continue;
            const value = rule === 'required' ? null : rule === 'pattern' ? attrs.get(attr) : Number(attrs.get(attr));
            if (rule === 'required' || rule === 'pattern' || Number.isFinite(value)) add(field, rule, value, null, match.index);
        }
        if (attrs.get('type') === 'email') add(field, 'email', 'email', null, match.index);
        if (attrs.get('type') === 'number') add(field, 'type', 'number', null, match.index);
    }
    if (!manual) return;
    const nearby = match => content.slice(match.index + match[0].length).split('\n').slice(0, 4).join('\n');
    for (const match of content.matchAll(/\b([\w$]+(?:\.[\w$]+)*)(?:\.trim\(\))?\.length\s*(!==|===|!=|==|<=|>=|<|>)\s*(\d+)/g)) {
        const tail = nearby(match);
        const rejection = /\bthrow\b|res\.status\(4\d\d\)|(?:set\w*Error|setMessage|alert|toast)\s*\(/i.test(tail)
            || errorText(textMessage(tail) || '');
        const rule = lengthRule(match[2], Number(match[3]), rejection);
        if (rule) addManual(match[1].split('.').at(-1), ...rule, textMessage(tail), match.index);
    }
    for (const match of content.matchAll(/!\s*([\w$]+(?:\.[\w$]+)*)(?:\.trim\(\))?(?![\w$.])|\b([\w$]+(?:\.[\w$]+)*)\s*===?\s*(['"])\3/g)) {
        const field = (match[1] || match[2]).replace(/\.trim$/, '').split('.').at(-1);
        addManual(field, 'required', null, textMessage(nearby(match)), match.index);
    }
};

export const extractValidationFacts = ({ files = [], maxFacts = 80 } = {}) => {
    const facts = [];
    const seen = new Set();
    const cap = limit(maxFacts, 80);
    const registry = new Set();
    const register = field => { if (field) registry.add(normalizedField(field)); };
    // Parse once, and gather fields across all eligible files before inspecting manual checks.
    const prepared = files.map(file => ({ path: String(file.path || '').replace(/\\/g, '/'), content: typeof file.content === 'string' ? file.content : '' }))
        .filter(file => !skippedPath(file.path)).map(file => {
            registerTextFields(file.content, register);
            let ast;
            if (/\.(?:[cm]?[jt]sx?)$/i.test(file.path)) {
                try {
                    ast = parse(file.content, { sourceType: 'unambiguous', plugins: ['jsx', 'typescript'] });
                } catch (error) {
                    console.warn(`Validation facts: unable to parse ${file.path}: ${error.message}`);
                }
            }
            const collect = node => {
                if (node.type === 'ObjectProperty' && /^(?:z|yup|Joi)\s*\./.test(file.content.slice(node.value.start, node.value.end))) register(keyName(node.key));
                for (const child of children(node)) collect(child);
            };
            if (ast) collect(ast);
            return { ...file, ast };
        });
    for (const { path, content, ast } of prepared) {
        const layer = /(^|\/)(server|api|backend|routes|controllers|validators)(\/|$)/i.test(path)
            || /\b(?:req|res)\.|express-validator|\bJoi\b/.test(content) ? 'server' : 'client';
        const pending = [];
        const add = (field, rule, value, message, offset) => {
            if (!field) return;
            pending.push({ field, rule, value, message: humanMessage(message), layer,
                source: `${path}:${content.slice(0, offset ?? 0).split('\n').length}`, offset: offset ?? 0 });
        };
        const addManual = (field, ...args) => {
            if (field && registry.has(normalizedField(field))) add(field, ...args);
        };
        if (/\.html?$/i.test(path)) {
            scanText(content, add, false);
        } else {
            if (!ast) scanText(content, add, true, addManual);
            if (ast) {
                const visit = (node, parent, property, condition) => {
                    const enclosing = node.type === 'ObjectProperty' ? keyName(node.key) : property;
                    const ifNode = node.type === 'IfStatement' ? node : condition;
                    const message = () => ifNode ? firstString(ifNode.consequent) : firstStringFromNextLines(node);
                    if (node.type === 'JSXOpeningElement' && ['input', 'textarea', 'select'].includes(node.name.name)) {
                        const attrs = new Map(node.attributes.filter(attr => attr.type === 'JSXAttribute').map(attr => [attr.name.name,
                            attr.value === null ? true : literal(attr.value.type === 'JSXExpressionContainer' ? attr.value.expression : attr.value)]));
                        const field = attrs.get('name') || attrs.get('id') || attrs.get('placeholder')?.toLowerCase();
                        for (const rule of ['required', 'minLength', 'maxLength', 'pattern', 'min', 'max']) {
                            if (!attrs.has(rule) || attrs.get(rule) === false || attrs.get(rule) === undefined) continue;
                            const value = rule === 'required' ? null : rule === 'pattern' ? attrs.get(rule) : Number(attrs.get(rule));
                            if (rule === 'required' || rule === 'pattern' || Number.isFinite(value)) add(field, rule, value, null, node.start);
                        }
                        if (attrs.get('type') === 'email') add(field, 'email', 'email', null, node.start);
                        if (attrs.get('type') === 'number') add(field, 'type', 'number', null, node.start);
                    }
                    if (node.type === 'BinaryExpression') {
                        if (memberName(node.left) === 'length' && typeof literal(node.right) === 'number') {
                            const rule = lengthRule(node.operator, literal(node.right), rejects(ifNode?.consequent));
                            if (rule) addManual(fieldName(node.left.object), ...rule, message(), node.start);
                        }
                        if (['===', '=='].includes(node.operator)) {
                            const checked = literal(node.right) === '' ? node.left : literal(node.left) === '' ? node.right : null;
                            if (checked) addManual(fieldName(checked), 'required', null, message(), node.start);
                        }
                    }
                    if (node.type === 'UnaryExpression' && node.operator === '!') addManual(fieldName(node.argument), 'required', null, message(), node.start);
                    if (node.type === 'CallExpression' && !(parent?.type === 'MemberExpression' && parent.object === node)) {
                        const chain = chainOf(node);
                        const express = ['body', 'check'].includes(chain[0]?.name) && typeof literal(chain[0]?.args[0]) === 'string';
                        const schema = chain.some(call => ['string', 'number'].includes(call.name))
                            && /^(?:z|yup|Joi)\s*\./.test(content.slice(node.start, node.end));
                        if (express || (schema && enclosing)) {
                            const field = express ? literal(chain[0].args[0]) : enclosing;
                            const numeric = chain.some(call => call.name === 'number');
                            const messages = chain.find(call => call.name === 'messages')?.args[0];
                            const customMessage = rule => {
                                if (messages?.type === 'ObjectExpression') {
                                    const aliases = { minLength: 'min', maxLength: 'max', pattern: 'pattern', required: 'required' };
                                    const entry = messages.properties.find(prop => String(keyName(prop.key)).split('.').includes(aliases[rule] || rule));
                                    return firstString(entry?.value);
                                }
                                return firstString(messages);
                            };
                            chain.forEach((call, index) => {
                                const emit = (rule, value) => add(field, rule, value,
                                    literal(call.args[1]) ?? firstString(chain[index + 1]?.name === 'withMessage' ? chain[index + 1].args[0] : null)
                                    ?? (['required', 'nonempty', 'notEmpty'].includes(call.name) ? firstString(call.args[0]) : null)
                                    ?? customMessage(rule), call.node.start);
                                if (['min', 'max'].includes(call.name) && typeof literal(call.args[0]) === 'number') emit(numeric ? call.name : `${call.name}Length`, literal(call.args[0]));
                                if (['email', 'isEmail'].includes(call.name)) emit('email', 'email');
                                if (['required', 'nonempty', 'notEmpty'].includes(call.name)) emit('required', null);
                                if (['regex', 'pattern'].includes(call.name) && call.args[0]?.type === 'RegExpLiteral') emit('pattern', call.args[0].pattern);
                                if (call.name === 'number') emit('type', 'number');
                                if (call.name === 'isLength') {
                                    for (const prop of call.args[0]?.properties || []) {
                                        if (['min', 'max'].includes(keyName(prop.key)) && typeof literal(prop.value) === 'number') emit(`${keyName(prop.key)}Length`, literal(prop.value));
                                    }
                                }
                            });
                        }
                    }
                    for (const child of children(node)) visit(child, node, enclosing, node.type === 'IfStatement' ? (child === node.test ? node : null) : ifNode);
                };
                const firstStringFromNextLines = node => {
                    const tail = content.slice(node.end).split('\n').slice(0, 4).join('\n');
                    return textMessage(tail);
                };
                visit(ast, null, null, null);
            }
        }
        pending.sort((a, b) => a.offset - b.offset);
        for (const { offset, ...fact } of pending) {
            const key = JSON.stringify([fact.field, fact.rule, fact.value, fact.layer]);
            if (seen.has(key)) continue;
            seen.add(key);
            if (facts.length < cap) facts.push(fact);
        }
    }
    return facts;
};

export const buildTestDesignChecklist = ({ facts = [], maxItems = 40 } = {}) => {
    const merged = new Map();
    for (const fact of facts) {
        const key = JSON.stringify([fact.field, fact.rule]);
        const previous = merged.get(key);
        if (!previous || fact.layer === 'server' && previous.layer !== 'server') {
            merged.set(key, { ...fact, message: fact.message ?? previous?.message ?? null });
        } else if (!previous.message && fact.message) previous.message = fact.message;
    }
    const items = [];
    for (const fact of merged.values()) {
        const { field, rule, value, message, source } = fact;
        const add = (suffix, input, expect, technique) => items.push({ id: `${field}-${rule}-${suffix}`, field, technique, input, expect, message, source });
        const boundary = (suffix, valueToTest, expect) => add(suffix, rule.endsWith('Length') ? { length: valueToTest } : { value: valueToTest }, expect, 'boundary');
        if (rule === 'required') add('empty', { value: '' }, 'reject', 'required');
        if (['minLength', 'min'].includes(rule)) {
            boundary('below', value - 1, 'reject');
            boundary('at', value, 'accept');
            if (rule === 'minLength' && !merged.has(JSON.stringify([field, 'maxLength']))) boundary('above', value + 1, 'accept');
        }
        if (['maxLength', 'max'].includes(rule)) {
            boundary('at', value, 'accept');
            boundary('above', value + 1, 'reject');
        }
        if (rule === 'email') {
            add('invalid', { value: 'not-an-email' }, 'reject', 'format');
            add('valid', { value: 'user@example.com' }, 'accept', 'format');
        }
        if (rule === 'pattern') add('invalid', { value: '!!!' }, 'reject', 'format');
    }
    const rank = { required: 0, boundary: 1, format: 2 };
    return items.sort((a, b) => rank[a.technique] - rank[b.technique]).slice(0, limit(maxItems, 40));
};

export const formatTestDesignForPrompt = ({ facts = [], checklist, maxChars = 6000 } = {}) => {
    if (!facts.length) return '';
    const items = checklist ?? buildTestDesignChecklist({ facts });
    const lines = ['Validation facts found in source:', ...facts.map(fact =>
        `- ${fact.field}: ${fact.rule}${fact.value === null ? '' : ` ${fact.value}`} (${fact.layer}, ${fact.source})${fact.message ? ` message ${JSON.stringify(fact.message)}` : ''}`),
    'Required test design checklist (boundary values / equivalence classes):', ...items.map(item => {
        const input = item.input && typeof item.input === 'object' ? item.input : { value: item.input ?? null };
        const shown = Number.isInteger(input.length) ? `${input.length} characters` : JSON.stringify(input.value ?? null);
        const field = item.field ?? item.id;
        const expect = item.expect ?? 'reject';
        return `- [${item.id}] ${field} with ${shown} -> ${expect}${item.message && expect === 'reject' ? ` (expect message ${JSON.stringify(item.message)} if shown in UI)` : ''}`;
    })];
    // Escape embedded line breaks so truncation always preserves complete output lines.
    const safeLines = lines.map(line => line.replace(/[\r\n]/g, ' '));
    const cap = limit(maxChars, 6000);
    if (safeLines.join('\n').length <= cap) return safeLines.join('\n');
    let kept = safeLines.length;
    while (kept >= 0) {
        const omitted = safeLines.slice(kept).filter(line => line.startsWith('- ')).length;
        const result = [...safeLines.slice(0, kept), `- ... ${omitted} more items omitted`].join('\n');
        if (result.length <= cap) return result;
        kept -= 1;
    }
    return ''; // A cap smaller than the omission marker cannot hold a complete line.
};
