import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import _traverse from '@babel/traverse';
import { parseJavaScriptCode } from '../babelParser.service.js';
import { extractValidEndpoints } from '../apiEndpointParser.service.js';
import { referencedEnvironment, requiredStartupEnvironment } from '../fullSystemEnvironment.service.js';
import { snapshotWorkspaceRoot, normalizeDiskPath } from '../../utils/snapshotWorkspace.js';
import { DEFAULT_EVALUATION_CONFIG, fail, hash, VERSIONS } from './common.js';
import { inferChatContract, resolveFunction, resolveModuleFunction, resolveRelativeSource, resolveValue } from './chatContractInference.js';

const traverse = _traverse.default || _traverse;

export const MAX_AUDIT_SCAN_BYTES = 20 * 1024 * 1024;

const IGNORED_DIRS = new Set([
    'node_modules', '.git', 'dist', 'build', '.next', 'coverage',
    '.covai', '.covai-temp', '.covai-system-test', '__pycache__', '.venv', 'venv', 'vendor',
]);

const NODE_AI_PACKAGES = new Map([
    ['openai', { provider: 'OpenAI', defaultEnvVars: ['OPENAI_API_KEY'] }],
    ['@google/generative-ai', { provider: 'Google Gemini', defaultEnvVars: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'] }],
    ['@google/genai', { provider: 'Google Gemini', defaultEnvVars: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'] }],
    ['@anthropic-ai/sdk', { provider: 'Anthropic', defaultEnvVars: ['ANTHROPIC_API_KEY'] }],
    ['langchain', { provider: 'LangChain', defaultEnvVars: ['OPENAI_API_KEY'] }],
    ['@langchain/core', { provider: 'LangChain', defaultEnvVars: [] }],
    ['@langchain/openai', { provider: 'LangChain OpenAI', defaultEnvVars: ['OPENAI_API_KEY'] }],
    ['@langchain/google-genai', { provider: 'LangChain Gemini', defaultEnvVars: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'] }],
    ['@langchain/anthropic', { provider: 'LangChain Anthropic', defaultEnvVars: ['ANTHROPIC_API_KEY'] }],
    ['llamaindex', { provider: 'LlamaIndex', defaultEnvVars: ['OPENAI_API_KEY'] }],
    ['ai', { provider: 'Vercel AI SDK', defaultEnvVars: [] }],
    ['@ai-sdk/openai', { provider: 'Vercel AI OpenAI', defaultEnvVars: ['OPENAI_API_KEY'] }],
    ['@ai-sdk/google', { provider: 'Vercel AI Google', defaultEnvVars: ['GOOGLE_GENERATIVE_AI_API_KEY', 'GEMINI_API_KEY'] }],
    ['@ai-sdk/anthropic', { provider: 'Vercel AI Anthropic', defaultEnvVars: ['ANTHROPIC_API_KEY'] }],
    ['ollama', { provider: 'Ollama', defaultEnvVars: [] }],
    ['cohere-ai', { provider: 'Cohere', defaultEnvVars: ['COHERE_API_KEY'] }],
    ['groq-sdk', { provider: 'Groq', defaultEnvVars: ['GROQ_API_KEY'] }],
    ['@mistralai/mistralai', { provider: 'Mistral', defaultEnvVars: ['MISTRAL_API_KEY'] }],
    ['@huggingface/inference', { provider: 'HuggingFace', defaultEnvVars: ['HF_TOKEN', 'HUGGINGFACEHUB_API_TOKEN'] }],
]);

const PYTHON_AI_PACKAGES = new Map([
    ['openai', 'OpenAI'],
    ['google-generativeai', 'Google Gemini'],
    ['google-genai', 'Google Gemini'],
    ['anthropic', 'Anthropic'],
    ['langchain', 'LangChain'],
    ['langchain-openai', 'LangChain OpenAI'],
    ['llama-index', 'LlamaIndex'],
    ['transformers', 'HuggingFace Transformers'],
    ['vllm', 'vLLM'],
    ['ollama', 'Ollama'],
]);

const LLM_HTTP_HOST_RE = /https?:\/\/(?:api\.openai\.com|generativelanguage\.googleapis\.com|api\.anthropic\.com|api\.groq\.com|openrouter\.ai|api\.cohere\.ai|api\.mistral\.ai|(?:localhost|127\.0\.0\.1):11434\/api\/(?:chat|generate))/i;

const HARDCODED_KEY_PATTERNS = [
    { label: 'OpenAI / Anthropic Secret Key', regex: /(?:(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{16,200}|sk-(?:proj-|ant-)[A-Za-z0-9_-]{16,200})\b/ },
    { label: 'Google Gemini API Key', regex: /(?:(?<![A-Za-z0-9])AIza[0-9A-Za-z_-]{20,80}|AIzaSy[0-9A-Za-z_-]{20,80})\b/ },
    { label: 'Groq API Key', regex: /\bgsk_[A-Za-z0-9]{16,120}\b/ },
    { label: 'HuggingFace Access Token', regex: /\bhf_[A-Za-z0-9]{16,120}\b/ },
];

const GROUNDING_REFUSAL_RE = /(?:only\s+(?:use|answer|rely)|based\s+(?:solely\s+|strictly\s+|only\s+)?on|provided\s+(?:context|document|knowledge|information)|do\s+not\s+(?:invent|make\s+up|hallucinate|fabricate|guess|assume)|if\s+.*\bnot\b.*(?:know|in\s+the\s+context|found|provided)|refuse|out[\s-]of[\s-]scope|cannot\s+answer|chỉ\s+(?:dựa\s+trên|sử\s+dụng|trả\s+lời\s+theo)|tài\s+liệu\s+(?:được\s+)?cung\s+cấp|không\s+(?:được\s+)?(?:bịa|tự\s+ý\s+suy\s+diễn|đoán)|từ\s+chối|ngoài\s+phạm\s+vi|không\s+(?:có|tìm\s+thấy)\s+thông\s+tin)/i;

const CHAT_ROUTE_HINT_RE = /(?:^|\/)(?:chat|chatbot|bot|ask|assistant|completions|converse|message|messages|qa|rag|ai)(?:\/|$|-|_)/i;
const QUESTION_FIELDS = ['message', 'question', 'prompt', 'query', 'input', 'text', 'userMessage', 'user_message', 'userInput', 'msg', 'content', 'q', 'chatInput', 'userQuery', 'user_input', 'userPrompt', 'ask'];
const LEGACY_QUESTION_FIELDS = QUESTION_FIELDS.slice(0, 13);
const HISTORY_FIELDS = ['history', 'conversationHistory', 'chatHistory', 'chat_history', 'previousMessages', 'pastMessages', 'conversation'];
const SESSION_FIELDS = ['sessionId', 'session_id', 'conversationId', 'conversation_id', 'threadId', 'thread_id', 'chatId', 'chat_id'];
const DOC_SKIP_NAMES = /^(?:package(?:-lock)?\.json|tsconfig(?:\..+)?\.json|jsconfig\.json|composer\.json|manifest\.json|vercel\.json|railway\.json|nodemon\.json|renovate\.json|\.eslintrc.*|pnpm-lock\.yaml|docker-compose.*\.ya?ml)$/i;
const SEVERITY_WEIGHT = { CRITICAL: 30, HIGH: 18, MEDIUM: 10, LOW: 5 };

const MASK_INPUT_WINDOW = 1024;
const SECRET_KEYWORD = '(?:api[_-]?key|secret|token|password|passwd|credential|authorization|(?:auth|private|access|client|llm|openai|gemini|google|anthropic)[_-]?key|[A-Za-z0-9][_-]key(?![A-Za-z0-9]))';
const SECRET_KEY_NAME = `(?<![A-Za-z0-9_.-])(?=[A-Za-z0-9_.-]{0,64}?${SECRET_KEYWORD})[A-Za-z0-9_.-]{1,64}(?![A-Za-z0-9_.-])`;
const QUOTED_SECRET_RE = new RegExp(`(${SECRET_KEY_NAME}['"\`]?\\s{0,16}[:=]\\s{0,16}['"\`])([^'"\`\\r\\n]{1,1024})(['"\`])`, 'gi');
const ESCAPED_QUOTED_SECRET_RE = new RegExp(`(${SECRET_KEY_NAME}(?:\\\\['"])?\\s{0,16}[:=]\\s{0,16}\\\\['"])([^\\\\'"\\r\\n]{1,1024})(\\\\['"])`, 'gi');
const UNQUOTED_SECRET_RE = new RegExp(
    `(${SECRET_KEY_NAME}(?:\\\\?['"\`])?\\s{0,16}[:=]\\s{0,16})(?!(?:\\\\?['"\`])?\\[REDACTED\\]|''|""|\`\`|[{\\[]|(?:process\\.env|import\\.meta\\.env|os\\.environ|os\\.getenv|Deno\\.env|Bun\\.env|null|undefined|true|false)\\b)([^\\s,;\\r\\n})\\]]{1,1024})`,
    'gi',
);

export function maskSecretsInSnippet(line = '', explicitSecrets = [], { maxLength = 220 } = {}) {
    const rawLine = String(line ?? '');
    const firstNonWs = rawLine.search(/\S/);
    if (firstNonWs === -1) return '';
    return maskSecretValues(rawLine.slice(firstNonWs, firstNonWs + MASK_INPUT_WINDOW), explicitSecrets).trim().slice(0, maxLength);
}

function maskSecretValues(masked, explicitSecrets) {
    for (const raw of explicitSecrets) {
        if (typeof raw === 'string' && raw.trim().length > 0) {
            masked = masked.split(raw).join('[REDACTED]');
            const trimmed = raw.trim();
            if (trimmed !== raw) masked = masked.split(trimmed).join('[REDACTED]');
        }
    }
    masked = masked.replace(/(\bBearer\s{1,16})[^\s,;'"`)\]}]{1,1024}/gi, '$1[REDACTED]');
    for (const { regex } of HARDCODED_KEY_PATTERNS) {
        masked = masked.replace(new RegExp(regex.source, 'g'), '[REDACTED]');
    }
    masked = masked.replace(ESCAPED_QUOTED_SECRET_RE, '$1[REDACTED]$3');
    masked = masked.replace(QUOTED_SECRET_RE, '$1[REDACTED]$3');
    masked = masked.replace(UNQUOTED_SECRET_RE, '$1[REDACTED]');
    return masked;
}

export function maskSecretsInText(text, explicitSecrets = [], maxLength = 6000) {
    let input = String(text ?? '');
    for (const secret of explicitSecrets) {
        if (typeof secret === 'string' && secret.trim() && /[\r\n]/.test(secret)) {
            const replacement = secret.split(/(\r\n|\r|\n)/)
                .map((part, index) => index % 2 === 0 && part ? '[REDACTED]' : part)
                .join('');
            input = input.split(secret).join(replacement);
        }
    }
    return input.split(/(\r\n|\r|\n)/).map((line, index) => {
        if (index % 2 === 1) return line;
        // Mask across chunk boundaries before passing long lines to the snippet masker.
        const chunks = line.length > MASK_INPUT_WINDOW
            ? maskSecretValues(line, explicitSecrets).match(/.{1,1000}/gs) || []
            : [line];
        return chunks.map(chunk => {
            if (!chunk.trim()) return chunk;
            return chunk.match(/^\s*/)[0]
                + maskSecretsInSnippet(chunk, explicitSecrets, { maxLength: MASK_INPUT_WINDOW })
                + chunk.match(/\s*$/)[0];
        }).join('');
    }).join('').slice(0, maxLength);
}

function safeWarnMessage(err) {
    return maskSecretsInSnippet(err?.message || String(err || 'Unknown error'), [], { maxLength: 220 });
}

const PROMPT_CREDENTIAL_RE = /(?:mật\s*khẩu|\bpassword\b|\bpasscode\b|\bpassphrase\b|\bsecret(?:\s+(?:key|code|token))?\b|(?:\badmin\b|\binternal\b|quản\s*trị)\s*(?:password|passcode|token|key|secret)|\btoken\s+nội\s+bộ)(?=$|[\s:=\r\n,;])[^:=\r\n,;]{0,48}?(?:(?:^|\s)là(?=\s)|(?:^|\s)is(?=\s)|=|:)\s*['"`]?([^\s'"`,;.)]{4,128})['"`]?/gi;
const PROMPT_INTERNAL_CODE_RE = /(?:mã\s+(?:giảm\s+giá|khuyến\s+mãi|ưu\s+đãi|nội\s+bộ|nhân\s+viên|admin|bí\s+mật)(?:\s+(?:nhân\s+viên|nội\s+bộ|admin|vip))?|(?:\bemployee\b|\binternal\b|\bstaff\b|\badmin\b|\bsecret\b)\s+(?:discount|promo|coupon|voucher|access)\s+code)(?=$|[\s:=\r\n,;])[^:=\r\n,;]{0,36}?(?:(?:^|\s)là(?=\s)|(?:^|\s)is(?=\s)|=|:|\s)\s*['"`]?([A-Za-z0-9][A-Za-z0-9_-]{3,64})['"`]?/gi;
const PROMPT_CONTEXT_TOKEN_RE = /(?:\b(?:internal|admin|secret|staff)\b|nội\s+bộ|nhân\s+viên|quản\s+trị)[^\r\n]{0,60}?(?:\b(?:token|key|secret|code|pass(?:word)?)\b|mã|mật\s*khẩu)[^:=\r\n,;]{0,24}?(?:=|:|(?:^|\s)là(?=\s)|(?:^|\s)is(?=\s))\s*['"`]?([^\s'"`,;.)]{4,128})['"`]?/gi;
const NON_SECRET_STOPWORDS = new Set([
    'null', 'undefined', 'true', 'false', 'none', 'required', 'missing', 'empty',
    'không', 'được', 'phải', 'chưa', 'hoặc', 'này', 'theo', 'trong',
]);

function detectSensitiveLiteralsInSystemPrompt(rawPromptText = '') {
    if (typeof rawPromptText !== 'string' || !rawPromptText.trim()) {
        return { matched: false, secrets: [], lineOffset: 0, matchedLine: '' };
    }
    const secrets = [];
    let firstMatchOffset = 0;
    let firstMatchedLine = '';
    const promptLines = rawPromptText.split(/\r?\n/);

    for (let idx = 0; idx < promptLines.length; idx++) {
        const boundedLine = promptLines[idx].slice(0, MASK_INPUT_WINDOW).replace(/\{\{expr\}\}/g, '');
        if (!boundedLine.trim()) continue;
        const lineSecrets = [];

        for (const match of boundedLine.matchAll(PROMPT_CREDENTIAL_RE)) {
            const candidate = (match[1] || '').trim();
            if (candidate && !NON_SECRET_STOPWORDS.has(candidate.toLowerCase())) {
                lineSecrets.push(candidate);
            }
        }
        for (const match of boundedLine.matchAll(PROMPT_INTERNAL_CODE_RE)) {
            const candidate = (match[1] || '').trim();
            if (candidate && /(?:\d|[-_]|^[A-Z]{4,}$)/.test(candidate) && !NON_SECRET_STOPWORDS.has(candidate.toLowerCase())) {
                lineSecrets.push(candidate);
            }
        }
        for (const match of boundedLine.matchAll(PROMPT_CONTEXT_TOKEN_RE)) {
            const candidate = (match[1] || '').trim();
            if (candidate && !NON_SECRET_STOPWORDS.has(candidate.toLowerCase())) {
                lineSecrets.push(candidate);
            }
        }
        for (const { regex } of HARDCODED_KEY_PATTERNS) {
            for (const match of boundedLine.matchAll(new RegExp(regex.source, 'g'))) {
                if (match[0]) lineSecrets.push(match[0]);
            }
        }

        if (lineSecrets.length > 0) {
            if (!firstMatchedLine) {
                firstMatchOffset = idx;
                firstMatchedLine = boundedLine;
            }
            secrets.push(...lineSecrets);
        }
    }

    const uniqueSecrets = [...new Set(secrets)];
    return {
        matched: uniqueSecrets.length > 0,
        secrets: uniqueSecrets,
        lineOffset: firstMatchOffset,
        matchedLine: firstMatchedLine,
    };
}

function isNodeEnvCheck(node) {
    if (!node || typeof node !== 'object') return false;
    if (node.type === 'MemberExpression' && (node.property?.name === 'NODE_ENV' || node.property?.value === 'NODE_ENV')) return true;
    return ['left', 'right', 'argument', 'object'].some(key => isNodeEnvCheck(node[key]));
}

function astNodeReferencesIdentifier(node, namesSet, depth = 0) {
    if (!node || typeof node !== 'object' || depth > 8 || namesSet.size === 0) return false;
    if (node.type === 'Identifier') {
        return namesSet.has(node.name);
    }
    if (node.type === 'MemberExpression') {
        return astNodeReferencesIdentifier(node.object, namesSet, depth + 1) ||
            (node.computed ? astNodeReferencesIdentifier(node.property, namesSet, depth + 1) : false);
    }
    // A plain object key such as { error: friendlyText } is a label, not a reference to the caught error.
    if (node.type === 'ObjectProperty' && !node.computed) {
        return astNodeReferencesIdentifier(node.value, namesSet, depth + 1);
    }
    // Error details shown only outside production (e.g. NODE_ENV === 'development' ? err.message : undefined) do not leak in production.
    if ((node.type === 'ConditionalExpression' && isNodeEnvCheck(node.test)) ||
        (node.type === 'LogicalExpression' && node.operator === '&&' && isNodeEnvCheck(node.left))) {
        return false;
    }
    for (const value of Object.values(node)) {
        if (Array.isArray(value)) {
            if (value.some(child => astNodeReferencesIdentifier(child, namesSet, depth + 1))) return true;
        } else if (value && typeof value === 'object' && typeof value.type === 'string') {
            if (astNodeReferencesIdentifier(value, namesSet, depth + 1)) return true;
        }
    }
    return false;
}

function isInsideTryBlockWithCatch(path) {
    let child = path;
    return Boolean(path.findParent(parent => {
        const protectedCall = parent.node.type === 'TryStatement' && parent.node.handler &&
            child.key === 'block' && child.parentPath === parent;
        child = parent;
        return protectedCall;
    }));
}

function isResponseSendOrJsonCall(calleeNode) {
    if (!calleeNode || calleeNode.type !== 'MemberExpression') return false;
    const propName = calleeNode.property?.name || calleeNode.property?.value;
    if (!['json', 'send'].includes(propName)) return false;
    let current = calleeNode.object;
    let hops = 0;
    while (current && hops++ < 5) {
        if (current.type === 'Identifier') {
            return /^(?:res|response|reply)$/i.test(current.name);
        }
        if (current.type === 'CallExpression' && current.callee?.type === 'MemberExpression') {
            current = current.callee.object;
            continue;
        }
        break;
    }
    return false;
}

async function scanWorkspaceTree(workspaceRoot, { maxTotalBytes = MAX_AUDIT_SCAN_BYTES } = {}) {
    const jsFiles = [];
    const packageManifests = [];
    const pythonManifests = [];
    const pythonSourceFiles = [];
    const candidateDocs = [];
    let visited = 0;
    let totalBytesRead = 0;
    let budgetExceeded = false;

    const readUtf8WithinBudget = async (fullPath, statSize) => {
        if (totalBytesRead + statSize > maxTotalBytes) {
            budgetExceeded = true;
            return null;
        }
        const buf = await fs.readFile(fullPath);
        if (totalBytesRead + buf.byteLength > maxTotalBytes) {
            budgetExceeded = true;
            return null;
        }
        totalBytesRead += buf.byteLength;
        return buf.toString('utf8');
    };

    const walk = async (dir, depth = 0) => {
        if (depth > 9 || visited > 2500 || budgetExceeded) return;
        let entries = [];
        try {
            const rawEntries = await fs.readdir(dir, { withFileTypes: true });
            entries = rawEntries.sort((a, b) => a.name.localeCompare(b.name));
        } catch (err) {
            console.warn(`[DesignAudit] Skipping unreadable directory ${dir}: ${safeWarnMessage(err)}`);
            return;
        }
        for (const entry of entries) {
            if (++visited > 2500 || budgetExceeded) break;
            if (entry.isSymbolicLink() || IGNORED_DIRS.has(entry.name)) continue;
            if (/^\.env(?:\.|$)/i.test(entry.name) || /\.(?:pem|key|p12)$/i.test(entry.name)) continue;

            const fullPath = path.join(dir, entry.name);
            const relPath = path.relative(workspaceRoot, fullPath).replace(/\\/g, '/');

            if (entry.isDirectory()) {
                await walk(fullPath, depth + 1);
                continue;
            }
            if (!entry.isFile()) continue;

            let stat;
            try { stat = await fs.stat(fullPath); } catch { continue; }
            if (stat.size > 10 * 1024 * 1024) continue;

            const lowerName = entry.name.toLowerCase();
            const ext = path.extname(lowerName).slice(1);

            if (lowerName === 'package.json' && stat.size <= 512 * 1024) {
                try {
                    const raw = await readUtf8WithinBudget(fullPath, stat.size);
                    if (raw === null) break;
                    const pkg = JSON.parse(raw);
                    packageManifests.push({ path: relPath, dir: path.dirname(relPath) === '.' ? '' : path.dirname(relPath), pkg });
                } catch (err) {
                    console.warn(`[DesignAudit] Invalid package.json at ${relPath}: ${safeWarnMessage(err)}`);
                }
                continue;
            }

            if (['requirements.txt', 'pyproject.toml', 'pipfile'].includes(lowerName) && stat.size <= 512 * 1024) {
                try {
                    const content = await readUtf8WithinBudget(fullPath, stat.size);
                    if (content === null) break;
                    pythonManifests.push({ path: relPath, content });
                } catch (err) {
                    console.warn(`[DesignAudit] Could not read Python manifest ${relPath}: ${safeWarnMessage(err)}`);
                }
                continue;
            }

            const isTestFile = /(?:^|\/)(?:__tests__|tests?|specs?|e2e|cypress|playwright|fixtures|mocks)\/|\.(?:test|spec|cy)\.[^.]+$/i.test(relPath);

            if (['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'].includes(ext) && !isTestFile && stat.size <= 512 * 1024) {
                try {
                    const content = await readUtf8WithinBudget(fullPath, stat.size);
                    if (content === null) break;
                    jsFiles.push({ path: relPath, fullPath, content });
                } catch (err) {
                    console.warn(`[DesignAudit] Could not read source file ${relPath}: ${safeWarnMessage(err)}`);
                }
                continue;
            }

            if (ext === 'py' && !isTestFile && stat.size <= 512 * 1024) {
                try {
                    const content = await readUtf8WithinBudget(fullPath, stat.size);
                    if (content === null) break;
                    pythonSourceFiles.push({ path: relPath, content });
                } catch (err) {
                    console.warn(`[DesignAudit] Could not read Python file ${relPath}: ${safeWarnMessage(err)}`);
                }
                continue;
            }

            if (['md', 'txt', 'pdf', 'docx', 'json', 'yaml', 'yml'].includes(ext) && !isTestFile && !DOC_SKIP_NAMES.test(entry.name)) {
                const isFrontendPublicAsset = /(?:^|\/)(?:public|assets)\//i.test(relPath) && !/(?:faq|policy|doc|guide|knowledge|terms|manual)/i.test(relPath);
                if (!isFrontendPublicAsset) {
                    const priority = /(?:^|\/)(?:docs?|knowledge|data|kb|policies|manuals?|prompts?)\b|(?:faq|policy|guide|manual|rule|sop|handbook)/i.test(relPath) ? 'HIGH' : 'NORMAL';
                    candidateDocs.push({
                        path: relPath,
                        name: entry.name,
                        format: ext,
                        sizeBytes: stat.size,
                        priority,
                    });
                }
            }
        }
    };

    await walk(workspaceRoot);
    candidateDocs.sort((a, b) => (a.priority === b.priority ? a.path.localeCompare(b.path) : a.priority === 'HIGH' ? -1 : 1));
    return {
        jsFiles,
        packageManifests,
        pythonManifests,
        pythonSourceFiles,
        candidateDocs: candidateDocs.slice(0, 40),
        scanBudget: {
            maxBytes: maxTotalBytes,
            bytesRead: totalBytesRead,
            truncated: budgetExceeded,
        },
    };
}

function extractNodeStringValue(node, scope, depth = 0, ctx = null) {
    if (!node || depth > 4) return { text: null, containsDynamicUserVar: false, dynamicNames: [] };
    if (node.type === 'StringLiteral') return { text: node.value, containsDynamicUserVar: false, dynamicNames: [] };
    if (node.type === 'TemplateLiteral') {
        const text = node.quasis.map(q => q.value.cooked ?? q.value.raw ?? '').join('{{expr}}');
        const dynamicNames = [];
        for (const expr of node.expressions) {
            const code = extractExpressionHint(expr);
            if (code) dynamicNames.push(code);
        }
        const containsDynamicUserVar = dynamicNames.some(name => /(?:req\.body|req\.query|req\.params|userMessage|userInput|question|query|message|prompt|input)/i.test(name));
        return { text, containsDynamicUserVar, dynamicNames };
    }
    if (node.type === 'BinaryExpression' && node.operator === '+') {
        const left = extractNodeStringValue(node.left, scope, depth + 1, ctx);
        const right = extractNodeStringValue(node.right, scope, depth + 1, ctx);
        const dynamicNames = [...left.dynamicNames, ...right.dynamicNames];
        const exprHint = (!left.text ? extractExpressionHint(node.left) : '') || (!right.text ? extractExpressionHint(node.right) : '');
        if (exprHint) dynamicNames.push(exprHint);
        const combined = [left.text, right.text].filter(Boolean).join(' ');
        const containsDynamicUserVar = left.containsDynamicUserVar || right.containsDynamicUserVar || dynamicNames.some(name => /(?:req\.body|req\.query|req\.params|userMessage|userInput|question|query|message|prompt|input)/i.test(name));
        return { text: combined || null, containsDynamicUserVar, dynamicNames };
    }
    if (node.type === 'Identifier' && scope) {
        const binding = scope.getBinding(node.name);
        if (binding?.kind === 'module') {
            const text = ctx?.moduleConstants?.get(binding.path.node.imported?.name ?? node.name);
            if (text) return { text, containsDynamicUserVar: false, dynamicNames: [] };
        }
        if (binding?.path?.node?.type === 'VariableDeclarator' && binding.path.node.init) {
            return extractNodeStringValue(binding.path.node.init, binding.path.scope, depth + 1, ctx);
        }
    }
    if (node.type === 'AwaitExpression') return extractNodeStringValue(node.argument, scope, depth + 1, ctx);
    if (node.type === 'CallExpression') {
        if (node.callee?.type === 'MemberExpression' && ['trim', 'toString'].includes(node.callee.property?.name)) {
            return extractNodeStringValue(node.callee.object, scope, depth + 1, ctx);
        }
        if (/(?:readFileSync|readFile)$/.test(extractExpressionHint(node.callee)) && ctx?.readText) {
            const arg = node.arguments[0];
            const rel = arg?.type === 'StringLiteral' ? arg.value
                : arg?.type === 'CallExpression' && /^path\.(?:join|resolve)$/.test(extractExpressionHint(arg.callee))
                    ? arg.arguments.filter(item => item.type === 'StringLiteral').map(item => item.value).join('/') : null;
            const text = rel ? ctx.readText(rel) : null;
            if (text) return { text, containsDynamicUserVar: false, dynamicNames: [] };
        }
    }
    if (node.type === 'CallExpression' && node.callee?.type === 'Identifier' && scope) {
        const returned = resolveLocalFunctionReturn(scope.getBinding(node.callee.name));
        if (returned) return extractNodeStringValue(returned.node, returned.scope, depth + 1, ctx);
    }
    return { text: null, containsDynamicUserVar: false, dynamicNames: [extractExpressionHint(node)].filter(Boolean) };
}

// Returns the string-like expression a local helper returns, e.g. function buildPrompt(kb) { return `...`; }
function resolveLocalFunctionReturn(binding) {
    const bindingPath = binding?.path;
    if (!bindingPath) return null;
    let fnPath = null;
    if (bindingPath.isFunctionDeclaration()) fnPath = bindingPath;
    else if (bindingPath.isVariableDeclarator()) {
        const init = bindingPath.get('init');
        if (init?.isArrowFunctionExpression() || init?.isFunctionExpression()) fnPath = init;
    }
    if (!fnPath) return null;
    const body = fnPath.get('body');
    if (!body.isBlockStatement()) return { node: body.node, scope: fnPath.scope };
    const statement = body.get('body').find(item => item.isReturnStatement() && item.node.argument);
    return statement ? { node: statement.node.argument, scope: fnPath.scope } : null;
}

function extractExpressionHint(node) {
    if (!node) return '';
    if (node.type === 'Identifier') return node.name;
    if (node.type === 'MemberExpression') {
        const obj = extractExpressionHint(node.object);
        const prop = node.property?.name || node.property?.value || '';
        return obj && prop ? `${obj}.${prop}` : obj || prop;
    }
    if (node.type === 'CallExpression') return extractExpressionHint(node.callee);
    return '';
}

function visitAst(ast, visitors) {
    if (typeof ast.traverse === 'function') ast.traverse(visitors);
    else traverse(ast, visitors);
}

function collectModuleImports(ast) {
    const imports = new Map();
    traverse(ast, {
        ImportDeclaration(p) {
            for (const spec of p.node.specifiers) {
                imports.set(spec.local.name, { source: p.node.source.value, imported: spec.type === 'ImportNamespaceSpecifier' ? '*' : spec.imported?.name || spec.imported?.value || 'default' });
            }
        },
        VariableDeclarator(p) {
            const init = p.node.init;
            if (init?.type !== 'CallExpression' || init.callee?.name !== 'require' || init.arguments[0]?.type !== 'StringLiteral') return;
            const source = init.arguments[0].value;
            if (p.node.id.type === 'Identifier') imports.set(p.node.id.name, { source, imported: 'default' });
            else if (p.node.id.type === 'ObjectPattern') {
                for (const prop of p.node.id.properties) {
                    if (prop.type === 'ObjectProperty' && prop.value.type === 'Identifier') {
                        imports.set(prop.value.name, { source, imported: prop.key.name || prop.key.value });
                    }
                }
            }
        },
    });
    return imports;
}

function collectRequestBodyFields(ast) {
    const fields = new Set();
    const isBody = node => {
        if (!node) return false;
        if (['TSAsExpression', 'TSTypeAssertion', 'TSNonNullExpression'].includes(node.type)) return isBody(node.expression);
        if (node.type === 'LogicalExpression' && node.operator === '||' && node.right?.type === 'ObjectExpression' && !node.right.properties.length) return isBody(node.left);
        if (node.type === 'Identifier') return node.name === 'body';
        if (node.type === 'MemberExpression') return !node.computed && node.property?.name === 'body';
        return node.type === 'AwaitExpression' && node.argument?.type === 'CallExpression'
            && node.argument.callee?.type === 'MemberExpression' && node.argument.callee.property?.name === 'json';
    };
    const member = p => {
        if (!p.node.computed && isBody(p.node.object) && p.node.property?.name) fields.add(p.node.property.name);
    };
    visitAst(ast, {
        VariableDeclarator(p) {
            if (p.node.id?.type !== 'ObjectPattern' || !isBody(p.node.init)) return;
            for (const prop of p.node.id.properties) {
                if (prop.type === 'ObjectProperty' && !prop.computed) fields.add(prop.key.name ?? prop.key.value);
            }
        },
        MemberExpression: member,
        OptionalMemberExpression: member,
    });
    return fields;
}

function inferResponseJsonPointerFromAst(ast) {
    const pointers = [];
    const collectObjectReplyPaths = (objNode, prefix = '') => {
        if (!objNode || objNode.type !== 'ObjectExpression') return;
        for (const prop of objNode.properties) {
            if (prop.type !== 'ObjectProperty') continue;
            const key = prop.key?.name || prop.key?.value;
            if (!key) continue;
            const nextPath = `${prefix}/${key}`;
            if (/^(?:reply|answer|response|message|output|text|content)$/i.test(key)) {
                pointers.push(nextPath);
            } else if (prop.value?.type === 'ObjectExpression' && /^(?:data|result|payload|bot)$/i.test(key)) {
                collectObjectReplyPaths(prop.value, nextPath);
            }
        }
    };

    visitAst(ast, {
        CallExpression(p) {
            const callee = p.node.callee;
            if (callee?.type === 'MemberExpression' && ['json', 'send'].includes(callee.property?.name)) {
                const arg = p.node.arguments[0];
                collectObjectReplyPaths(arg, '');
            } else if (
                callee?.type === 'MemberExpression' &&
                ['end', 'write'].includes(callee.property?.name) &&
                p.node.arguments[0]?.type === 'CallExpression' &&
                extractExpressionHint(p.node.arguments[0].callee) === 'JSON.stringify'
            ) {
                collectObjectReplyPaths(p.node.arguments[0].arguments[0], '');
            }
        },
    });
    return pointers[0] || null;
}

function detectDirectExpressRoutes(jsFiles, aiCallingFiles, routeContracts) {
    const routes = [];
    const nextRoutes = [];
    const modules = new Map(jsFiles.map(file => {
        const parsed = parseJavaScriptCode(file.content);
        return [file.path, { ...file, ast: parsed.success ? parsed.ast : null, imports: parsed.success ? collectModuleImports(parsed.ast) : new Map() }];
    }));
    const mounts = new Map();
    const routerKey = (p, file) => {
        if (p.isIdentifier()) {
            const imported = file.imports.get(p.node.name);
            if (imported?.source.startsWith('.') && !resolveRelativeSource(file.path, imported.source, modules)) return null;
        }
        const resolved = resolveValue(p, file, modules);
        return resolved?.path.node || (p.isIdentifier() ? p.scope.getBinding(p.node.name)?.identifier : null);
    };
    const prefixesFor = (router, seen = new Set(), depth = 0) => {
        if (seen.has(router)) return [];
        const parents = mounts.get(router);
        if (!parents || depth >= 5) return [''];
        const visited = new Set([...seen, router]);
        return parents.flatMap(({ parent, prefix }) => prefixesFor(parent, visited, depth + 1).map(base => `${base}/${prefix}`));
    };
    const followsAiCall = contract => contract && QUESTION_FIELDS.some(field => contract.fields.has(field))
        && [...contract.visitedFiles].some(file => aiCallingFiles.has(file));
    for (const file of modules.values()) {
        if (!file.ast) continue;
        traverse(file.ast, {
            CallExpression(p) {
                if (p.node.callee?.type !== 'MemberExpression' || p.node.callee.property?.name !== 'use') return;
                const [prefix, ...routers] = p.get('arguments');
                if (!prefix?.isStringLiteral()) return;
                const parent = routerKey(p.get('callee.object'), file);
                for (const router of routers) {
                    if (!router.isIdentifier() && !router.isMemberExpression()) continue;
                    const key = routerKey(router, file);
                    if (key) mounts.set(key, [...(mounts.get(key) || []), { parent, prefix: prefix.node.value }]);
                }
            },
        });
    }
    for (const file of modules.values()) {
        if (!file.ast) continue;

        const appRoute = file.path.match(/^(?:src\/)?app\/(.*\/)?route\.(?:js|ts|mjs|jsx|tsx)$/);
        const pagesRoute = file.path.match(/^(?:src\/)?pages\/api\/(.+)\.(?:js|ts|mjs|jsx|tsx)$/);
        const nextHandler = appRoute || pagesRoute ? resolveModuleFunction(file, appRoute ? 'POST' : 'default', modules) : null;
        if (nextHandler) {
            const nextPath = appRoute
                ? '/' + (appRoute[1] || '').split('/').filter(segment => segment && !/^\(.*\)$/.test(segment)).join('/')
                : '/api/' + pagesRoute[1].replace(/(?:^|\/)index$/, '');
            const endpointPath = nextPath.replace(/\/$/, '') || '/';
            const contract = inferChatContract(nextHandler, modules);
            if (aiCallingFiles.has(file.path) || CHAT_ROUTE_HINT_RE.test(file.path) || followsAiCall(contract)) {
                routeContracts.set(`POST:${endpointPath}`, contract);
                nextRoutes.push({ method: 'POST', endpointPath, sourceFile: file.path,
                    line: nextHandler.file === file ? nextHandler.path.node.loc?.start?.line || 1 : 1, requiresRouteAuth: false, hasRateLimitMiddleware: false });
            }
        }

        traverse(file.ast, {
            CallExpression(p) {
                const callee = p.node.callee;
                if (callee?.type !== 'MemberExpression') return;
                const method = callee.property?.name;
                if (!['post', 'get'].includes(method)) return;
                const firstArg = p.node.arguments[0];
                if (firstArg?.type !== 'StringLiteral') return;
                const routePath = firstArg.value;
                const handler = method === 'post' ? resolveFunction(p.get('arguments').at(-1), file, modules) : null;
                const contract = handler ? inferChatContract(handler, modules) : null;
                const prefixes = prefixesFor(routerKey(p.get('callee.object'), file));
                const endpointPaths = new Set((prefixes.length ? prefixes : ['']).map(prefix => `${prefix}/${routePath}`.replace(/\/+/g, '/').replace(/\/$/, '') || '/'));
                const isAiFile = aiCallingFiles.has(file.path);
                if (![...endpointPaths].some(endpoint => CHAT_ROUTE_HINT_RE.test(endpoint)) && !isAiFile && !followsAiCall(contract)) return;

                const argNames = p.node.arguments.slice(1).map(arg => extractExpressionHint(arg)).filter(Boolean);
                const hasAuthMiddleware = argNames.some(name => /(?:auth|token|jwt|protect|guard|session)/i.test(name));
                const hasRateLimitMiddleware = argNames.some(name => /(?:limit|rate|throttle)/i.test(name));
                for (const endpointPath of endpointPaths) {
                    if (contract) routeContracts.set(`POST:${endpointPath}`, contract);
                    routes.push({
                        method: method.toUpperCase(),
                        endpointPath,
                        sourceFile: file.path,
                        line: p.node.loc?.start?.line || 1,
                        requiresRouteAuth: hasAuthMiddleware,
                        hasRateLimitMiddleware,
                    });
                }
            },
            BinaryExpression(p) {
                if (!['===', '=='].includes(p.node.operator)) return;
                const leftHint = extractExpressionHint(p.node.left);
                const rightHint = extractExpressionHint(p.node.right);
                const literal = p.node.right?.type === 'StringLiteral' && /(?:^|\.)(?:url|pathname)$/i.test(leftHint)
                    ? p.node.right.value
                    : p.node.left?.type === 'StringLiteral' && /(?:^|\.)(?:url|pathname)$/i.test(rightHint)
                        ? p.node.left.value
                        : null;
                if (literal && literal.startsWith('/') && (CHAT_ROUTE_HINT_RE.test(literal) || aiCallingFiles.has(file.path))) {
                    routes.push({
                        method: 'POST',
                        endpointPath: literal,
                        sourceFile: file.path,
                        line: p.node.loc?.start?.line || 1,
                        requiresRouteAuth: /headers\[['"]authorization['"]\]|headers\.authorization/i.test(file.content),
                        hasRateLimitMiddleware: false,
                    });
                }
            },
        });
    }
    return [...routes, ...nextRoutes];
}

export async function analyzeChatbotWorkspace(workspaceRoot, options = {}) {
    const { jsFiles, packageManifests, pythonManifests, pythonSourceFiles, candidateDocs, scanBudget } = await scanWorkspaceTree(workspaceRoot, options);
    const sdks = new Map();
    const requiredLlmEnvVars = new Set();
    const llmBaseUrlEnvVars = new Set();
    const implicitSdkEnvVars = new Set();

    for (const manifest of packageManifests) {
        const allDeps = { ...manifest.pkg.dependencies, ...manifest.pkg.devDependencies, ...manifest.pkg.peerDependencies };
        for (const [pkgName, info] of NODE_AI_PACKAGES.entries()) {
            if (Object.hasOwn(allDeps, pkgName)) {
                sdks.set(pkgName, { name: pkgName, provider: info.provider, ecosystem: 'node', origin: manifest.path });
                if (info.defaultEnvVars[0]) implicitSdkEnvVars.add(info.defaultEnvVars[0]);
            }
        }
    }

    for (const pyManifest of pythonManifests) {
        for (const [pkgName, provider] of PYTHON_AI_PACKAGES.entries()) {
            const pattern = new RegExp(`(?:^|[\\s"'\\[,])${pkgName.replace('-', '[-_]')}(?:$|[\\s"'\\]=<>~!])`, 'im');
            if (pattern.test(pyManifest.content)) {
                sdks.set(`py:${pkgName}`, { name: pkgName, provider, ecosystem: 'python', origin: pyManifest.path });
            }
        }
    }

    const aiCallingFiles = new Set();
    const systemPrompts = [];
    const systemPromptTexts = [];
    const findings = [];
    const highTemperatureConfigs = [];
    let appHasGlobalRateLimit = false;
    let detectedSseStream = false;
    let detectedMessagesArray = false;
    let detectedSessionId = false;
    const requestBodyFields = new Set();
    let detectedTextResponse = false;
    let detectedHistoryBound = false;
    let detectedForwardsPriorTurns = false;
    let detectedEmptyHistoryLocation = null;
    let detectedMessagesReadLocation = null;
    let detectedInputLengthCheck = false;
    let detectedLlmCallCount = 0;
    let unprotectedLlmCallLocation = null;
    let detectedRawErrorLeak = null;
    let detectedReadsKnowledgeFile = false;
    let inferredJsonPointer = null;

    const recordExtractedSystemPrompt = (file, lines, baseLine, extracted) => {
        if (!extracted?.text) return;
        const contentHash = hash(extracted.text);
        const secretScan = detectSensitiveLiteralsInSystemPrompt(extracted.text);
        if (!systemPrompts.some(sp => sp.file === file.path && sp.contentHash === contentHash)) {
            if (systemPromptTexts.length < 5) {
                systemPromptTexts.push({ file: file.path, text: maskSecretsInText(extracted.text, secretScan.secrets) });
            }
            systemPrompts.push({
                file: file.path,
                line: baseLine,
                excerpt: maskSecretsInSnippet(extracted.text, secretScan.secrets, { maxLength: 400 }),
                // Check grounding on the full prompt: rules often come after the first 400 characters.
                grounded: GROUNDING_REFUSAL_RE.test(extracted.text),
                charLength: extracted.text.length,
                contentHash,
            });
        }
        if (secretScan.matched && !findings.some(f => f.ruleId === 'CB-SEC-04' && f.file === file.path && f._promptHash === contentHash)) {
            findings.push({
                ruleId: 'CB-SEC-04',
                severity: 'HIGH',
                title: 'Sensitive credentials or internal secrets embedded in System Prompt',
                file: file.path,
                line: baseLine + secretScan.lineOffset,
                description: 'System prompt embeds concrete sensitive values (passwords, internal promo/access codes, or tokens). Because system prompts can be extracted via prompt injection, never store confidential secrets inside model instructions.',
                recommendation: 'Remove all passwords, internal employee/admin codes, and tokens from the system prompt; enforce authentication and voucher validation in backend application logic.',
                snippet: maskSecretsInSnippet(secretScan.matchedLine || lines[baseLine - 1] || '', secretScan.secrets),
                _promptHash: contentHash,
            });
        }
    };

    const ctx = {
        moduleConstants: new Map(),
        file: '',
        readText(relPath) {
            for (const base of [path.dirname(path.resolve(workspaceRoot, this.file)), workspaceRoot]) {
                const target = path.resolve(base, relPath);
                const relative = path.relative(path.resolve(workspaceRoot), target);
                if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) continue;
                try {
                    const realTarget = fsSync.realpathSync(target);
                    const realRelative = path.relative(fsSync.realpathSync(workspaceRoot), realTarget);
                    if (realRelative === '..' || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) continue;
                    const stat = fsSync.statSync(realTarget);
                    if (!stat.isFile() || stat.size > 256 * 1024) continue;
                    return fsSync.readFileSync(realTarget, 'utf8');
                } catch {
                    // Missing or unreadable prompt files cannot be resolved statically.
                }
            }
            return null;
        },
    };
    for (const file of jsFiles) {
        const parsed = parseJavaScriptCode(file.content);
        if (!parsed.success) continue;
        const ctxWithFileOnly = { file: file.path, readText: ctx.readText };
        traverse(parsed.ast, {
            VariableDeclarator(p) {
                const declaration = p.parentPath;
                const parent = declaration?.parentPath;
                if (!(parent?.isProgram() || (parent?.isExportNamedDeclaration() && parent.parentPath?.isProgram()))) return;
                if (p.node.id?.type !== 'Identifier') return;
                const extracted = extractNodeStringValue(p.node.init, p.scope, 0, ctxWithFileOnly);
                if (extracted.text && !ctx.moduleConstants.has(p.node.id.name)) ctx.moduleConstants.set(p.node.id.name, extracted.text);
            },
        });
    }

    for (const file of jsFiles) {
        const lines = file.content.split(/\r?\n/);
        lines.forEach((lineText, idx) => {
            for (const { label, regex } of HARDCODED_KEY_PATTERNS) {
                if (regex.test(lineText) && !/example|placeholder|your[_-]?key|xxxx|mock|dummy|test[_-]?key/i.test(lineText)) {
                    findings.push({
                        ruleId: 'CB-SEC-01',
                        severity: 'CRITICAL',
                        title: `Hardcoded ${label} in source code`,
                        file: file.path,
                        line: idx + 1,
                        description: `Detected a literal ${label} committed directly inside ${file.path}. Anyone with repository access can extract and abuse billing quota.`,
                        recommendation: 'Move the API key to environment variables (e.g. process.env.GEMINI_API_KEY) and rotate the exposed credential immediately.',
                        snippet: maskSecretsInSnippet(lineText),
                    });
                }
            }
        });

        if (/express-rate-limit|rateLimit\s*\(|rateLimiter/i.test(file.content)) {
            appHasGlobalRateLimit = true;
        }

        const parsed = parseJavaScriptCode(file.content);
        if (!parsed.success) continue;

        let fileUsesAi = LLM_HTTP_HOST_RE.test(file.content);
        if (fileUsesAi) {
            sdks.set('http-llm-api', { name: 'Direct LLM HTTP Client', provider: 'HTTP API', ecosystem: 'node', origin: file.path });
        }

        const sdkImports = collectModuleImports(parsed.ast);
        const detectSdkKeyEnvironment = p => {
            const rootName = extractExpressionHint(p.node.callee).split('.')[0];
            if (!NODE_AI_PACKAGES.has(sdkImports.get(rootName)?.source)) return;
            const firstArg = p.node.arguments[0];
            if (firstArg?.type === 'ObjectExpression') {
                for (const prop of firstArg.properties) {
                    if (prop.type !== 'ObjectProperty' || !['baseURL', 'baseUrl', 'basePath', 'baseUri', 'endpoint', 'apiBase', 'apiEndpoint', 'apiUrl', 'host', 'serverUrl'].includes(prop.key?.name || prop.key?.value)) continue;
                    const value = prop.value?.type === 'LogicalExpression' && prop.value.operator === '||' ? prop.value.left : prop.value;
                    if (value?.type !== 'MemberExpression' || extractExpressionHint(value.object) !== 'process.env') continue;
                    const name = value.computed ? (value.property.type === 'StringLiteral' ? value.property.value : null) : value.property?.name;
                    if (name) llmBaseUrlEnvVars.add(name);
                }
            }
            const values = firstArg?.type === 'ObjectExpression'
                ? firstArg.properties.filter(prop => prop.type === 'ObjectProperty' && ['apiKey', 'key'].includes(prop.key?.name || prop.key?.value)).map(prop => prop.value)
                : [firstArg];
            for (const value of values) {
                if (value?.type !== 'MemberExpression' || extractExpressionHint(value.object) !== 'process.env') continue;
                const name = value.computed ? (value.property.type === 'StringLiteral' ? value.property.value : null) : value.property?.name;
                if (name) requiredLlmEnvVars.add(name);
            }
        };

        traverse(parsed.ast, {
            ImportDeclaration(p) {
                const src = p.node.source.value;
                if (NODE_AI_PACKAGES.has(src)) {
                    fileUsesAi = true;
                    const info = NODE_AI_PACKAGES.get(src);
                    sdks.set(src, { name: src, provider: info.provider, ecosystem: 'node', origin: file.path });
                    if (info.defaultEnvVars[0]) implicitSdkEnvVars.add(info.defaultEnvVars[0]);
                }
            },
            CallExpression(p) {
                detectSdkKeyEnvironment(p);
                const callee = p.node.callee;
                if (callee?.name === 'require' && p.node.arguments[0]?.type === 'StringLiteral') {
                    const src = p.node.arguments[0].value;
                    if (NODE_AI_PACKAGES.has(src)) {
                        fileUsesAi = true;
                        const info = NODE_AI_PACKAGES.get(src);
                        sdks.set(src, { name: src, provider: info.provider, ecosystem: 'node', origin: file.path });
                        if (info.defaultEnvVars[0]) implicitSdkEnvVars.add(info.defaultEnvVars[0]);
                    }
                }
            },
            NewExpression(p) {
                detectSdkKeyEnvironment(p);
                const calleeName = p.node.callee?.name;
                if (['OpenAI', 'GoogleGenerativeAI', 'GoogleGenAI', 'Anthropic', 'ChatOpenAI', 'ChatGoogleGenerativeAI'].includes(calleeName)) {
                    fileUsesAi = true;
                    const firstArg = p.node.arguments[0];
                    if (firstArg?.type === 'StringLiteral' && firstArg.value.trim().length >= 8 && !/your|mock|test|placeholder/i.test(firstArg.value)) {
                        const line = p.node.loc?.start?.line || 1;
                        if (!findings.some(f => f.ruleId === 'CB-SEC-01' && f.file === file.path && f.line === line)) {
                            findings.push({
                                ruleId: 'CB-SEC-01',
                                severity: 'CRITICAL',
                                title: `Hardcoded API key passed to ${calleeName} constructor`,
                                file: file.path,
                                line,
                                description: `${calleeName} is initialized with a literal string credential instead of reading from process.env.`,
                                recommendation: 'Read the credential from an environment variable so keys are never stored in version control.',
                                snippet: maskSecretsInSnippet(lines[line - 1] || '', [firstArg.value]),
                            });
                        }
                    } else if (firstArg?.type === 'ObjectExpression') {
                        const keyProp = firstArg.properties.find(prop => prop.type === 'ObjectProperty' && ['apiKey', 'key'].includes(prop.key?.name || prop.key?.value));
                        if (keyProp?.value?.type === 'StringLiteral' && keyProp.value.value.trim().length >= 8 && !/your|mock|test|placeholder/i.test(keyProp.value.value)) {
                            const line = keyProp.loc?.start?.line || p.node.loc?.start?.line || 1;
                            if (!findings.some(f => f.ruleId === 'CB-SEC-01' && f.file === file.path && f.line === line)) {
                                findings.push({
                                    ruleId: 'CB-SEC-01',
                                    severity: 'CRITICAL',
                                    title: `Hardcoded apiKey option passed to ${calleeName}`,
                                    file: file.path,
                                    line,
                                    description: `${calleeName} configuration embeds a literal apiKey string directly in code.`,
                                    recommendation: 'Use process.env.<PROVIDER_API_KEY> and keep secrets out of repository files.',
                                    snippet: maskSecretsInSnippet(lines[line - 1] || '', [keyProp.value.value]),
                                });
                            }
                        }
                    }
                }
            },
        });

        const isChatRelatedFile = fileUsesAi || CHAT_ROUTE_HINT_RE.test(file.path);
        if (fileUsesAi) aiCallingFiles.add(file.path);
        if (!isChatRelatedFile) continue;

        if (/text\/event-stream|toDataStreamResponse|pipeDataStreamToResponse|generateContentStream|\.stream\s*\(/i.test(file.content)) {
            detectedSseStream = true;
        }
        if (/(?:readFileSync|readFile)\s*\([^)]*\.(?:md|txt|json|pdf|docx|yaml|yml)/i.test(file.content)) {
            detectedReadsKnowledgeFile = true;
        }
        const destructuresMessagesFromBody = /\{[^}]*\bmessages\b[^}]*\}\s*=\s*(?:req\.)?(?:body\??\b|body)/i.test(file.content);
        for (const field of collectRequestBodyFields(parsed.ast)) requestBodyFields.add(field);
        if (/req\.body(?:\?\.)?\.?messages\b|\breq\.body\??\.messages\b|\bbody\??\.messages\b/.test(file.content) || destructuresMessagesFromBody) {
            detectedMessagesArray = true;
            if (!detectedMessagesReadLocation) {
                const msgLineIdx = lines.findIndex(l => /\bmessages\b/.test(l));
                detectedMessagesReadLocation = {
                    file: file.path,
                    line: msgLineIdx >= 0 ? msgLineIdx + 1 : 1,
                    snippet: msgLineIdx >= 0 ? maskSecretsInSnippet(lines[msgLineIdx]) : '',
                };
            }
            if (/\b\w*messages\w*\s*\.\s*(?:slice|map|filter|flatMap)\s*\(/i.test(file.content) || /\.\.\.\s*\w*messages\w*\b/i.test(file.content)) {
                detectedForwardsPriorTurns = true;
            }
            if (
                /\.slice\s*\(\s*-\d+/i.test(file.content) ||
                /\b\w*messages\w*\s*\.\s*length\s*(?:>|>=|<|<=)\s*\d+/i.test(file.content)
            ) {
                detectedHistoryBound = true;
            }
        }
        const destructuresSessionFromBody = /\{[^}]*\b(?:sessionId|session_id|conversationId|conversation_id|threadId)\b[^}]*\}\s*=\s*(?:req\.)?body\b/.test(file.content);
        if (/req\.body(?:\?\.)?(?:sessionId|session_id|conversationId|conversation_id|threadId)/.test(file.content) || destructuresSessionFromBody) {
            detectedSessionId = true;
        }
        // Only treat .length / maxLength checks on message/content/input strings (not messages.length === 0 alone) as input length caps
        if (
            /(?:content|message|question|prompt|input|text|last)\w*\s*\.\s*length\s*(?:>|>=|<|<=)\s*\d{2,}/i.test(file.content) ||
            /\.max\s*\(\s*\d{2,}\s*\)|maxLength\s*[:=]\s*\d{2,}/i.test(file.content)
        ) {
            detectedInputLengthCheck = true;
        }

        const pointerCandidate = inferResponseJsonPointerFromAst(parsed.ast);
        if (pointerCandidate && !inferredJsonPointer) inferredJsonPointer = pointerCandidate;

        ctx.file = file.path;
        traverse(parsed.ast, {
            ArrayExpression(p) {
                const elements = p.node.elements;
                if (elements.length === 2 && elements[0]?.type === 'StringLiteral' && elements[0].value === 'system') {
                    recordExtractedSystemPrompt(file, lines, p.node.loc?.start?.line || 1, extractNodeStringValue(elements[1], p.scope, 0, ctx));
                }
            },
            NewExpression(p) {
                if (!['SystemMessage', 'SystemMessagePromptTemplate'].includes(p.node.callee?.name)) return;
                const arg = p.node.arguments[0];
                const content = arg?.type === 'ObjectExpression'
                    ? arg.properties.find(prop => prop.type === 'ObjectProperty' && (prop.key?.name || prop.key?.value) === 'content')?.value : arg;
                recordExtractedSystemPrompt(file, lines, p.node.loc?.start?.line || 1, extractNodeStringValue(content, p.scope, 0, ctx));
            },
            ObjectProperty(p) {
                const keyName = p.node.key?.name || p.node.key?.value;
                if (keyName === 'systemInstruction' || keyName === 'system') {
                    const extracted = extractNodeStringValue(p.node.value, p.scope, 0, ctx);
                    const line = p.node.loc?.start?.line || 1;
                    recordExtractedSystemPrompt(file, lines, line, extracted);
                    if (extracted.containsDynamicUserVar) {
                        findings.push({
                            ruleId: 'CB-SEC-03',
                            severity: 'HIGH',
                            title: 'Untrusted user input interpolated directly into System Prompt',
                            file: file.path,
                            line,
                            description: `System instruction dynamically interpolates request/user variables (${extracted.dynamicNames.join(', ')}), allowing attackers to override system rules via Prompt Injection.`,
                            recommendation: 'Keep the system prompt static or strictly grounded to trusted configuration, and pass user messages exclusively in the "user" role.',
                            snippet: maskSecretsInSnippet(lines[line - 1] || ''),
                        });
                    }
                }
                if (fileUsesAi && keyName === 'temperature' && p.node.value?.type === 'NumericLiteral' && p.node.value.value > 0.7) {
                    const line = p.node.loc?.start?.line || 1;
                    highTemperatureConfigs.push({
                        file: file.path,
                        line,
                        value: p.node.value.value,
                        snippet: maskSecretsInSnippet(lines[line - 1] || ''),
                    });
                }
            },
            ObjectExpression(p) {
                const roleProp = p.node.properties.find(prop => prop.type === 'ObjectProperty' && (prop.key?.name || prop.key?.value) === 'role' && prop.value?.type === 'StringLiteral' && prop.value.value === 'system');
                const contentProp = p.node.properties.find(prop => prop.type === 'ObjectProperty' && (prop.key?.name || prop.key?.value) === 'content');
                if (roleProp && contentProp) {
                    const extracted = extractNodeStringValue(contentProp.value, p.scope, 0, ctx);
                    const line = contentProp.loc?.start?.line || p.node.loc?.start?.line || 1;
                    recordExtractedSystemPrompt(file, lines, line, extracted);
                    if (extracted.containsDynamicUserVar) {
                        findings.push({
                            ruleId: 'CB-SEC-03',
                            severity: 'HIGH',
                            title: 'User input concatenated into role:"system" message',
                            file: file.path,
                            line,
                            description: `A system-role message embeds dynamic request variables (${extracted.dynamicNames.join(', ')}), weakening role separation against Prompt Injection.`,
                            recommendation: 'Separate trusted system instructions from untrusted user turns ({ role: "user", content: userMessage }).',
                            snippet: maskSecretsInSnippet(lines[line - 1] || ''),
                        });
                    }
                }
            },
            VariableDeclarator(p) {
                const varName = p.node.id?.name || '';
                if (/(?:systemPrompt|SYSTEM_PROMPT|systemInstruction|SYSTEM_INSTRUCTION|botPrompt)/i.test(varName) && p.node.init) {
                    const extracted = extractNodeStringValue(p.node.init, p.scope, 0, ctx);
                    const line = p.node.loc?.start?.line || 1;
                    recordExtractedSystemPrompt(file, lines, line, extracted);
                    if (extracted.containsDynamicUserVar && !findings.some(f => f.ruleId === 'CB-SEC-03' && f.file === file.path && f.line === line)) {
                        findings.push({
                            ruleId: 'CB-SEC-03',
                            severity: 'HIGH',
                            title: 'Untrusted input concatenated into system prompt variable',
                            file: file.path,
                            line,
                            description: `Variable "${varName}" concatenates dynamic user input directly into system instructions.`,
                            recommendation: 'Keep system instructions immutable and pass user input in a dedicated user message.',
                            snippet: maskSecretsInSnippet(lines[line - 1] || ''),
                        });
                    }
                }
            },
            CallExpression(p) {
                const hint = extractExpressionHint(p.node.callee);
                if (fileUsesAi && p.node.callee?.type === 'MemberExpression' && p.node.callee.property?.name === 'send'
                    && p.node.arguments[0] && p.node.arguments[0].type !== 'ObjectExpression' && !p.findParent(parent => parent.isCatchClause())) {
                    detectedTextResponse = true;
                }
                if (/^(?:console\.(?:log|info|debug|warn)|logger\.(?:info|debug|log))$/.test(hint)) {
                    const argHints = p.node.arguments.map(a => extractExpressionHint(a)).join(' ');
                    if (/\b(?:req\.body|req\.headers|authorization|apiKey|userMessage|messages|prompt)\b/i.test(argHints)) {
                        const line = p.node.loc?.start?.line || 1;
                        findings.push({
                            ruleId: 'CB-PRIV-01',
                            severity: 'HIGH',
                            title: 'Unredacted chat payload or credential logged',
                            file: file.path,
                            line,
                            description: `Logging raw "${argHints.trim()}" exposes user conversation PII or authentication headers in server logs.`,
                            recommendation: 'Remove raw payload logging or log only non-sensitive metadata (requestId, latencyMs, tokenCount).',
                            snippet: maskSecretsInSnippet(lines[line - 1] || ''),
                        });
                    }
                }
                if (fileUsesAi && /(?:^|\.)(?:startChat)$/.test(hint)) {
                    const cfgArg = p.node.arguments[0];
                    if (cfgArg?.type === 'ObjectExpression') {
                        const historyProp = cfgArg.properties.find(
                            prop => prop.type === 'ObjectProperty' && (prop.key?.name || prop.key?.value) === 'history',
                        );
                        if (historyProp) {
                            if (historyProp.value?.type === 'ArrayExpression' && historyProp.value.elements.length === 0) {
                                const line = historyProp.loc?.start?.line || p.node.loc?.start?.line || 1;
                                detectedEmptyHistoryLocation ??= {
                                    file: file.path,
                                    line,
                                    snippet: maskSecretsInSnippet(lines[line - 1] || ''),
                                };
                            } else {
                                detectedForwardsPriorTurns = true;
                            }
                        } else {
                            const line = p.node.loc?.start?.line || 1;
                            detectedEmptyHistoryLocation ??= {
                                file: file.path,
                                line,
                                snippet: maskSecretsInSnippet(lines[line - 1] || ''),
                            };
                        }
                    } else if (!cfgArg) {
                        const line = p.node.loc?.start?.line || 1;
                        detectedEmptyHistoryLocation ??= {
                            file: file.path,
                            line,
                            snippet: maskSecretsInSnippet(lines[line - 1] || ''),
                        };
                    }
                }
                if (
                    fileUsesAi &&
                    /(?:^|\.)(?:generateContent|generateContentStream|sendMessage|sendMessageStream|completions\.create|responses\.create|messages\.create|generateText|streamText|invoke|call)\b/.test(hint)
                ) {
                    detectedLlmCallCount += 1;
                    const firstArg = p.node.arguments[0];
                    if (firstArg?.type === 'ObjectExpression') {
                        const fwdProp = firstArg.properties.find(
                            prop =>
                                prop.type === 'ObjectProperty' &&
                                ['messages', 'contents', 'history'].includes(prop.key?.name || prop.key?.value),
                        );
                        if (fwdProp?.value?.type === 'Identifier' && /\bmessages\b/i.test(fwdProp.value.name)) {
                            detectedForwardsPriorTurns = true;
                        }
                    }
                    if (!isInsideTryBlockWithCatch(p)) {
                        const line = p.node.loc?.start?.line || 1;
                        unprotectedLlmCallLocation ??= {
                            file: file.path,
                            line,
                            snippet: maskSecretsInSnippet(lines[line - 1] || ''),
                        };
                    }
                }
                if (isResponseSendOrJsonCall(p.node.callee)) {
                    const catchAncestor = p.findParent(parent => parent.node.type === 'CatchClause');
                    const fnAncestor = p.findParent(
                        parent =>
                            ['FunctionExpression', 'ArrowFunctionExpression', 'FunctionDeclaration'].includes(parent.node.type) &&
                            parent.node.params?.length === 4,
                    );
                    const errNames = new Set();
                    if (catchAncestor?.node.param?.type === 'Identifier') {
                        errNames.add(catchAncestor.node.param.name);
                    }
                    if (fnAncestor?.node.params?.[0]?.type === 'Identifier') {
                        errNames.add(fnAncestor.node.params[0].name);
                    }
                    if (errNames.size > 0 && p.node.arguments.some(arg => astNodeReferencesIdentifier(arg, errNames))) {
                        const line = p.node.loc?.start?.line || 1;
                        detectedRawErrorLeak ??= {
                            file: file.path,
                            line,
                            snippet: maskSecretsInSnippet(lines[line - 1] || ''),
                        };
                    }
                }
            },
        });
    }

    for (const pyFile of pythonSourceFiles) {
        if (/(?:OpenAI|genai\.GenerativeModel|genai\.Client|Anthropic|ChatOpenAI)\s*\(/.test(pyFile.content)) {
            sdks.set(`py-src:${pyFile.path}`, { name: 'Python LLM SDK', provider: 'Python AI', ecosystem: 'python', origin: pyFile.path });
        }
    }

    const detected = sdks.size > 0 || aiCallingFiles.size > 0;
    if (!detected) {
        return {
            detected: false,
            designScore: null,
            systemPromptTexts: [],
            summary: {
                analyzerVersion: VERSIONS.designAudit,
                ecosystem: pythonSourceFiles.length && !jsFiles.length ? 'python' : 'node',
                sdks: [],
                endpoints: [],
                systemPrompts: [],
                candidateDocs,
                scanBudget,
                launchability: {
                    mode: 'EXTERNAL_URL',
                    ready: false,
                    reason: 'No AI SDK or Chatbot endpoint was detected in this repository snapshot.',
                    llmBaseUrlEnvVars: [],
                },
            },
            findings: [],
            autoFillConfig: {
                executionMode: 'EXTERNAL_URL',
                endpointPath: '/api/chat',
                conversationMode: 'messages',
                responseFormat: 'json',
                responsePointer: '/answer',
                llmEnvVars: [],
                llmBaseUrlEnvVars: [],
                requiresRouteAuth: false,
                recommendedSourcePaths: candidateDocs.slice(0, 5).map(d => d.path),
                ...DEFAULT_EVALUATION_CONFIG,
            },
        };
    }

    const startupRequired = requiredStartupEnvironment(jsFiles, { startupOnly: false });
    const allReferencedEnv = referencedEnvironment(jsFiles);
    for (const item of startupRequired) {
        if (
            ['OpenAI', 'Gemini', 'Anthropic'].includes(item.integration) ||
            /(?:OPENAI|GEMINI|GOOGLE|ANTHROPIC|COHERE|GROQ|MISTRAL|OPENROUTER|HUGGINGFACE|HF_|LLM|AI|CHATBOT|MODEL).*(?:KEY|TOKEN)/i.test(item.name)
        ) {
            requiredLlmEnvVars.add(item.name);
        }
    }
    for (const item of allReferencedEnv) {
        if (/^(?:OPENAI_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY|GOOGLE_GENERATIVE_AI_API_KEY|ANTHROPIC_API_KEY|GROQ_API_KEY|MISTRAL_API_KEY|COHERE_API_KEY|OPENROUTER_API_KEY|HF_TOKEN|HUGGINGFACEHUB_API_TOKEN|LLM_API_KEY|AI_API_KEY)$/i.test(item.name)) {
            requiredLlmEnvVars.add(item.name);
        } else if (
            aiCallingFiles.has(item.sourceFile) &&
            /(?:API[_-]?KEY|LLM[_-]?KEY|MODEL[_-]?KEY|AI[_-]?KEY|BOT[_-]?KEY|(?:OPENAI|GEMINI|GOOGLE|ANTHROPIC|GROQ|MISTRAL|COHERE)[_-]?(?:KEY|TOKEN))$/i.test(item.name) &&
            !/^(?:JWT|SESSION|COOKIE|AUTH|CSRF|STRIPE|SENDGRID|RESEND|TWILIO|DB|DATABASE|POSTGRES|MYSQL|REDIS)/i.test(item.name)
        ) {
            requiredLlmEnvVars.add(item.name);
        }
    }
    const hasHardcodedKeyFinding = findings.some(f => f.ruleId === 'CB-SEC-01');
    if (requiredLlmEnvVars.size === 0 && !hasHardcodedKeyFinding && implicitSdkEnvVars.size > 0) {
        for (const envVar of implicitSdkEnvVars) requiredLlmEnvVars.add(envVar);
    }

    let parsedEndpoints = [];
    try {
        parsedEndpoints = extractValidEndpoints(jsFiles.map(f => ({ path: f.path, content: f.content }))) || [];
    } catch (err) {
        console.warn(`[DesignAudit] Endpoint parser fallback triggered: ${safeWarnMessage(err)}`);
    }

    const mappedEndpoints = parsedEndpoints
        .filter(ep => CHAT_ROUTE_HINT_RE.test(ep.path || ep.endpoint || '') || (ep.controllerFile && aiCallingFiles.has(ep.controllerFile)) || (ep.routeFile && aiCallingFiles.has(ep.routeFile)))
        .map(ep => ({
            method: (ep.method || 'POST').toUpperCase(),
            endpointPath: ep.path || ep.endpoint || '/api/chat',
            sourceFile: ep.routeFile || ep.controllerFile || null,
            line: ep.line || 1,
            requiresRouteAuth: Array.isArray(ep.middlewares) && ep.middlewares.some(m => m.type === 'AUTHENTICATION' || /auth|jwt|token|protect/i.test(m.name || '')),
            hasRateLimitMiddleware: Array.isArray(ep.middlewares) && ep.middlewares.some(m => /rate|limit|throttle/i.test(m.name || '')),
        }));

    const routeContracts = new Map();
    const directRoutes = detectDirectExpressRoutes(jsFiles, aiCallingFiles, routeContracts);
    const contractKey = ep => `${ep.method}:${ep.endpointPath.replace(/\/$/, '') || '/'}`;
    const directKeys = new Set(directRoutes.map(contractKey));
    const allChatEndpoints = [...mappedEndpoints];
    for (const route of directRoutes) {
        const unmountedIndex = allChatEndpoints.findIndex(existing => mappedEndpoints.includes(existing)
            && !directKeys.has(contractKey(existing))
            && existing.method === route.method && existing.sourceFile === route.sourceFile
            && existing.endpointPath !== route.endpointPath && route.endpointPath.endsWith(existing.endpointPath));
        if (unmountedIndex !== -1) allChatEndpoints.splice(unmountedIndex, 1);
        if (allChatEndpoints.some(existing => contractKey(existing) === contractKey(route))) continue;
        const mounted = allChatEndpoints.find(existing => mappedEndpoints.includes(existing)
            && !directKeys.has(contractKey(existing))
            && existing.method === route.method && existing.sourceFile === route.sourceFile
            && existing.line === route.line && existing.endpointPath.endsWith(route.endpointPath));
        if (mounted) {
            const contract = routeContracts.get(contractKey(route));
            if (contract && !routeContracts.has(contractKey(mounted))) routeContracts.set(contractKey(mounted), contract);
        } else if (unmountedIndex === -1) {
            allChatEndpoints.push(route);
        } else {
            allChatEndpoints.splice(unmountedIndex, 0, route);
        }
    }

    // Rule CB-SEC-02: Missing or ungrounded System Prompt
    const hasGroundedPrompt = systemPrompts.some(sp => sp.grounded);
    if (!systemPrompts.length) {
        const anchorFile = [...aiCallingFiles][0] || jsFiles[0]?.path || 'project';
        findings.push({
            ruleId: 'CB-SEC-02',
            severity: 'HIGH',
            title: 'No explicit System Prompt / Guardrail instruction found',
            file: anchorFile,
            line: 1,
            description: 'The chatbot calls an LLM without a detectable system instruction defining domain scope, grounding rules, or polite refusal for out-of-scope queries.',
            recommendation: 'Define a dedicated system prompt instructing the assistant to answer strictly from approved business documents and refuse out-of-scope or adversarial requests.',
            snippet: '',
        });
    } else if (!hasGroundedPrompt) {
        const primary = systemPrompts[0];
        findings.push({
            ruleId: 'CB-SEC-02',
            severity: 'HIGH',
            title: 'System Prompt lacks explicit anti-hallucination & refusal rules',
            file: primary.file,
            line: primary.line,
            description: 'A system prompt was found, but it does not instruct the model to stick strictly to provided business knowledge or refuse out-of-scope questions.',
            recommendation: 'Add explicit grounding rules (e.g. "Answer strictly using the provided context; if the answer is not in the documents, state clearly that you do not have that information.").',
            snippet: maskSecretsInSnippet(primary.excerpt, [], { maxLength: 160 }),
        });
    }

    // Rule CB-REL-01: Missing input length cap or rate limiting
    const routeHasRateLimit = appHasGlobalRateLimit || allChatEndpoints.some(ep => ep.hasRateLimitMiddleware);
    if (!detectedInputLengthCheck || !routeHasRateLimit) {
        const primaryEp = allChatEndpoints[0];
        const missingParts = [
            !detectedInputLengthCheck ? 'input message length limit' : null,
            !routeHasRateLimit ? 'rate-limiting middleware' : null,
        ].filter(Boolean).join(' and ');
        findings.push({
            ruleId: 'CB-REL-01',
            severity: 'MEDIUM',
            title: `Missing ${missingParts} on chatbot endpoint`,
            file: primaryEp?.sourceFile || [...aiCallingFiles][0] || 'server',
            line: primaryEp?.line || 1,
            description: `Chatbot API lacks ${missingParts}, exposing the LLM quota to token-exhaustion or automated flood requests.`,
            recommendation: 'Enforce a strict character cap (e.g. <= 4,000 chars) on incoming user prompts and attach express-rate-limit to the chat route.',
            snippet: '',
        });
    }

    // Rule CB-REL-02: Missing try/catch around LLM call
    if (aiCallingFiles.size > 0 && detectedLlmCallCount > 0 && unprotectedLlmCallLocation) {
        findings.push({
            ruleId: 'CB-REL-02',
            severity: 'MEDIUM',
            title: 'LLM invocation lacks structured try/catch fallback',
            file: unprotectedLlmCallLocation.file,
            line: unprotectedLlmCallLocation.line,
            description: 'LLM SDK call is not wrapped in a try/catch block with a safe user-facing fallback message.',
            recommendation: 'Wrap LLM requests with a timeout and try/catch block returning a sanitized fallback message on provider failure.',
            snippet: unprotectedLlmCallLocation.snippet || '',
        });
    }

    // Rule CB-REL-03: Raw error details / stack trace returned to HTTP client
    if (detectedRawErrorLeak) {
        findings.push({
            ruleId: 'CB-REL-03',
            severity: 'MEDIUM',
            title: 'Raw error message or stack trace returned to client',
            file: detectedRawErrorLeak.file,
            line: detectedRawErrorLeak.line,
            description: 'Error handler serializes raw exception details (e.g. err.message, err.stack, or raw err object) back to the HTTP response, leaking provider internals or server details.',
            recommendation: 'Log detailed errors server-side with secrets redacted and return a sanitized, generic error message (e.g. HTTP 502 "Service temporarily unavailable").',
            snippet: detectedRawErrorLeak.snippet || '',
        });
    }

    // Rule CB-ARCH-02 vs CB-ARCH-01: Multi-turn conversation history lost vs unbounded history
    if (detectedMessagesArray && (detectedEmptyHistoryLocation || !detectedForwardsPriorTurns)) {
        const loc = detectedEmptyHistoryLocation || detectedMessagesReadLocation;
        findings.push({
            ruleId: 'CB-ARCH-02',
            severity: 'MEDIUM',
            title: 'Conversation history not forwarded (multi-turn context lost)',
            file: loc?.file || [...aiCallingFiles][0] || jsFiles[0]?.path || 'server',
            line: loc?.line || 1,
            description: 'The chat endpoint accepts a messages[] array, but passes empty history (e.g. startChat({ history: [] })) or only forwards the final user message, losing all prior multi-turn context.',
            recommendation: 'Forward bounded prior user/assistant turns from messages[] (e.g. messages.slice(-12, -1)) into the LLM conversation history.',
            snippet: loc?.snippet || '',
        });
    } else if (detectedMessagesArray && detectedForwardsPriorTurns && !detectedHistoryBound) {
        findings.push({
            ruleId: 'CB-ARCH-01',
            severity: 'LOW',
            title: 'Unbounded multi-turn message history forwarded to LLM',
            file: detectedMessagesReadLocation?.file || [...aiCallingFiles][0] || jsFiles[0]?.path || 'server',
            line: detectedMessagesReadLocation?.line || 1,
            description: 'Client-supplied messages[] array is forwarded without slicing or length bounds, risking context-window overflow on long sessions.',
            recommendation: 'Enforce a maximum messages count or truncate conversation history to the most recent N turns (e.g. messages.slice(-12)) before calling the LLM.',
            snippet: detectedMessagesReadLocation?.snippet || '',
        });
    }

    // Rule CB-CFG-01: High sampling temperature (> 0.7) on a document-grounded chatbot (LOW advisory)
    const isDocumentGroundedBot =
        candidateDocs.length > 0 ||
        detectedReadsKnowledgeFile ||
        systemPrompts.some(sp => /(?:document|context|knowledge|policy|faq|tài\s*liệu|chính\s*sách)/i.test(sp.excerpt));
    if (isDocumentGroundedBot && highTemperatureConfigs.length > 0) {
        const tempCfg = highTemperatureConfigs[0];
        findings.push({
            ruleId: 'CB-CFG-01',
            severity: 'LOW',
            title: `High sampling temperature (${tempCfg.value}) for document-grounded chatbot (advisory)`,
            file: tempCfg.file,
            line: tempCfg.line,
            description: `Advisory: temperature is set to ${tempCfg.value} (> 0.7) on a chatbot grounded in policy/knowledge documents, increasing hallucination and numerical variance across runs.`,
            recommendation: 'Recommendation: use a low temperature (0.0–0.3) for document-grounded Q&A so answers remain deterministic and faithful to source documents.',
            snippet: tempCfg.snippet || '',
        });
    }

    const hasNodeSdk = [...sdks.values()].some(s => s.ecosystem === 'node');
    const hasOnlyPython = !hasNodeSdk && [...sdks.values()].some(s => s.ecosystem === 'python');
    const jsOnlyRules = new Set(['CB-SEC-02', 'CB-REL-01', 'CB-REL-02', 'CB-ARCH-01', 'CB-ARCH-02', 'CB-REL-03']);
    const sanitizedFindings = findings.filter(f => !hasOnlyPython || !jsOnlyRules.has(f.ruleId)).map(({ _promptHash, ...rest }) => rest);
    const runnablePkg = packageManifests.find(m =>
        !/^(?:client|frontend|web|ui)$/i.test(path.basename(m.dir || '')) &&
        ['start', 'dev', 'serve'].some(script => typeof m.pkg.scripts?.[script] === 'string'),
    );

    const launchability = hasNodeSdk && runnablePkg
        ? {
            mode: 'MANAGED_PROJECT',
            ready: true,
            packageDir: runnablePkg.dir || '.',
            startScript: ['start', 'dev', 'serve'].find(s => typeof runnablePkg.pkg.scripts?.[s] === 'string'),
            requiredLlmEnvVars: [...requiredLlmEnvVars],
            llmBaseUrlEnvVars: [...llmBaseUrlEnvVars],
            note: 'CovAI can boot this Node.js chatbot automatically on an isolated 127.0.0.1 port with your LLM API key injected in RAM only.',
        }
        : {
            mode: 'EXTERNAL_URL',
            ready: false,
            requiredLlmEnvVars: [...requiredLlmEnvVars],
            llmBaseUrlEnvVars: [...llmBaseUrlEnvVars],
            reason: hasOnlyPython
                ? 'Python AI project detected. Express/Node AST route parsing and Node auto-startup do not boot Python runtimes in MVP; start your Python server and connect via External URL (cloudflared / ngrok).'
                : 'No runnable backend start/dev script was found in package.json; use External URL mode to test the deployed chatbot.',
        };

    const penalty = sanitizedFindings.reduce((sum, item) => sum + (SEVERITY_WEIGHT[item.severity] || 5), 0);
    const designScore = Math.max(0, Math.min(100, 100 - penalty));

    let primaryEndpoint = null;
    let bestScore = -Infinity;
    for (const endpoint of allChatEndpoints) {
        if (endpoint.method !== 'POST') continue;
        const candidate = routeContracts.get(contractKey(endpoint));
        const lastSegment = endpoint.endpointPath.split('/').filter(Boolean).at(-1) || '';
        const score = (candidate && (candidate.fields.has('messages') || QUESTION_FIELDS.some(field => candidate.fields.has(field))) ? 8 : 0)
            + (candidate?.responsePointer ? 4 : 0)
            + (CHAT_ROUTE_HINT_RE.test(lastSegment) ? 2 : 0)
            - (/[:*]/.test(endpoint.endpointPath) ? 6 : 0)
            - (/history|session|delete|clear|feedback|upload|title|rename|webhook|login|register|payment|checkout|intent/i.test(lastSegment) ? 4 : 0);
        if (score > bestScore) {
            bestScore = score;
            primaryEndpoint = endpoint;
        }
    }
    primaryEndpoint ||= allChatEndpoints[0] || null;
    const contract = primaryEndpoint ? routeContracts.get(contractKey(primaryEndpoint)) : null;
    const selectedLatest = QUESTION_FIELDS.find(field => contract?.fields.has(field));
    let conversationMode = 'messages';
    let bindings = { '/messages': 'messages' };
    let responseConversationIdPointer;
    if (selectedLatest || contract?.fields.has('messages')) {
        const requiredLatest = QUESTION_FIELDS.find(field => contract.required.includes(field));
        if (!contract.fields.has('messages') || requiredLatest) {
            const latest = requiredLatest || selectedLatest;
            const history = [...HISTORY_FIELDS, 'pastConversation', 'chatLog', 'prevMessages'].find(field => contract.fields.has(field));
            const session = SESSION_FIELDS.find(field => contract.fields.has(field));
            bindings = { [`/${latest}`]: 'latestUserMessage' };
            if (history) bindings[`/${history}`] = 'history';
            else if (session && contract.required.includes(session)) bindings[`/${session}`] = 'generatedConversationId';
            else if (session) {
                bindings[`/${session}`] = 'conversationId';
                conversationMode = 'session';
                responseConversationIdPointer = `/${session}`;
            }
        }
    } else if (!detectedMessagesArray) {
        const latest = LEGACY_QUESTION_FIELDS.find(field => requestBodyFields.has(field));
        const history = HISTORY_FIELDS.find(field => requestBodyFields.has(field));
        const session = SESSION_FIELDS.find(field => requestBodyFields.has(field));
        if (latest) {
            bindings = { [`/${latest}`]: 'latestUserMessage' };
            if (history) bindings[`/${history}`] = 'history';
            else if (session) {
                bindings[`/${session}`] = 'conversationId';
                conversationMode = 'session';
                responseConversationIdPointer = `/${session}`;
            }
        } else if (detectedSessionId) {
            bindings = { '/message': 'latestUserMessage', '/sessionId': 'conversationId' };
            conversationMode = 'session';
            responseConversationIdPointer = '/sessionId';
        }
    }
    const requiredBodyFields = (contract?.required || []).filter(field => !Object.hasOwn(bindings, `/${field}`));
    const responsePointer = contract?.responsePointer || inferredJsonPointer || '/answer';

    const autoFillConfig = {
        executionMode: launchability.ready ? 'MANAGED_PROJECT' : 'EXTERNAL_URL',
        endpointPath: primaryEndpoint?.endpointPath || '/api/chat',
        conversationMode,
        responseFormat: detectedSseStream ? 'sse' : detectedTextResponse && !contract?.responsePointer && !inferredJsonPointer ? 'text' : 'json',
        requestTemplate: conversationMode === 'session' ? { message: '' } : {},
        bindings,
        requiredBodyFields,
        historyFormat: contract?.historyFormat || 'chat',
        responsePointer,
        ...(conversationMode === 'session' ? { responseConversationIdPointer } : {}),
        llmEnvVars: [...requiredLlmEnvVars],
        llmBaseUrlEnvVars: [...llmBaseUrlEnvVars],
        requiresRouteAuth: Boolean(primaryEndpoint?.requiresRouteAuth),
        recommendedSourcePaths: candidateDocs.filter(d => d.priority === 'HIGH').slice(0, 5).map(d => d.path),
        ...DEFAULT_EVALUATION_CONFIG,
    };

    return {
        detected: true,
        designScore,
        systemPromptTexts,
        summary: {
            analyzerVersion: VERSIONS.designAudit,
            ecosystem: hasOnlyPython ? 'python' : pythonManifests.length ? 'mixed' : 'node',
            pythonParserLimitation: pythonManifests.length || pythonSourceFiles.length
                ? 'apiEndpointParser currently parses Express/Node.js JS/TS routes; full Python FastAPI/Flask AST route parsing is scheduled for Phase 2.'
                : null,
            sdks: [...sdks.values()],
            endpoints: allChatEndpoints.map(endpoint => ({
                ...endpoint,
                requestFormat: endpoint === primaryEndpoint ? Object.keys(bindings).map(pointer => pointer.slice(1)).join(' + ') : null,
                responseFormat: endpoint === primaryEndpoint ? autoFillConfig.responseFormat : null,
            })),
            systemPrompts,
            candidateDocs,
            scanBudget,
            launchability,
            severityCounts: {
                CRITICAL: sanitizedFindings.filter(f => f.severity === 'CRITICAL').length,
                HIGH: sanitizedFindings.filter(f => f.severity === 'HIGH').length,
                MEDIUM: sanitizedFindings.filter(f => f.severity === 'MEDIUM').length,
                LOW: sanitizedFindings.filter(f => f.severity === 'LOW').length,
            },
        },
        findings: sanitizedFindings,
        autoFillConfig,
    };
}

export async function resolveProjectSnapshot(db, projectId, snapshotId) {
    if (snapshotId) {
        const snap = await db.projectSnapshot.findFirst({
            where: { id: snapshotId, projectId },
            select: { id: true, projectId: true, source: true, rootDir: true, storagePath: true, createdAt: true },
        });
        if (!snap) fail('SNAPSHOT_NOT_FOUND', 'Snapshot not found for this project', 404);
        return snap;
    }
    const project = await db.project.findUnique({
        where: { id: projectId },
        select: { activeSnapshotId: true },
    });
    if (project?.activeSnapshotId) {
        const active = await db.projectSnapshot.findFirst({
            where: { id: project.activeSnapshotId, projectId },
            select: { id: true, projectId: true, source: true, rootDir: true, storagePath: true, createdAt: true },
        });
        if (active) return active;
    }
    return db.projectSnapshot.findFirst({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, projectId: true, source: true, rootDir: true, storagePath: true, createdAt: true },
    });
}

function formatPersistedAudit(row) {
    return {
        id: row.id,
        projectId: row.projectId,
        snapshotId: row.snapshotId,
        status: 'READY',
        detected: row.detected,
        designScore: row.designScore,
        summary: row.summaryJson,
        findings: row.findingsJson,
        autoFillConfig: row.autoFillConfigJson,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

async function assertDirectoryAccessible(dirPath) {
    if (!dirPath) return false;
    try {
        const stat = await fs.stat(dirPath);
        return stat.isDirectory();
    } catch {
        return false;
    }
}

export async function runChatbotDesignAudit(db, projectId, { snapshotId } = {}) {
    const snapshot = await resolveProjectSnapshot(db, projectId, snapshotId);
    if (!snapshot) {
        return {
            id: null,
            projectId,
            snapshotId: null,
            status: 'NO_SNAPSHOT',
            detected: false,
            designScore: null,
            summary: { sdks: [], endpoints: [], systemPrompts: [], candidateDocs: [], launchability: { mode: 'EXTERNAL_URL', ready: false, reason: 'Import a project repository or ZIP snapshot first.' } },
            findings: [],
            autoFillConfig: null,
        };
    }

    const workspaceRoot = snapshotWorkspaceRoot(snapshot) || normalizeDiskPath(snapshot.rootDir);
    if (!(await assertDirectoryAccessible(workspaceRoot))) {
        fail('WORKSPACE_UNAVAILABLE', 'Snapshot source files are not accessible on this server', 409);
    }

    const analysis = await analyzeChatbotWorkspace(workspaceRoot);
    const saved = await db.$transaction(async tx => {
        return tx.aiEvaluationDesignAudit.upsert({
            where: { projectId_snapshotId: { projectId, snapshotId: snapshot.id } },
            create: {
                projectId,
                snapshotId: snapshot.id,
                detected: analysis.detected,
                designScore: analysis.designScore,
                summaryJson: analysis.summary,
                findingsJson: analysis.findings,
                autoFillConfigJson: analysis.autoFillConfig,
            },
            update: {
                detected: analysis.detected,
                designScore: analysis.designScore,
                summaryJson: analysis.summary,
                findingsJson: analysis.findings,
                autoFillConfigJson: analysis.autoFillConfig,
            },
            select: {
                id: true,
                projectId: true,
                snapshotId: true,
                detected: true,
                designScore: true,
                summaryJson: true,
                findingsJson: true,
                autoFillConfigJson: true,
                createdAt: true,
                updatedAt: true,
            },
        });
    });

    return formatPersistedAudit(saved);
}

export async function getChatbotDesignAudit(db, projectId, { snapshotId, autoScan = false } = {}) {
    const snapshot = await resolveProjectSnapshot(db, projectId, snapshotId);
    if (!snapshot) {
        return {
            id: null,
            projectId,
            snapshotId: null,
            status: 'NO_SNAPSHOT',
            detected: false,
            designScore: null,
            summary: null,
            findings: [],
            autoFillConfig: null,
        };
    }
    const existing = await db.aiEvaluationDesignAudit.findUnique({
        where: { projectId_snapshotId: { projectId, snapshotId: snapshot.id } },
        select: {
            id: true,
            projectId: true,
            snapshotId: true,
            detected: true,
            designScore: true,
            summaryJson: true,
            findingsJson: true,
            autoFillConfigJson: true,
            createdAt: true,
            updatedAt: true,
        },
    });
    if (existing) return formatPersistedAudit(existing);
    if (!autoScan) {
        return {
            id: null,
            projectId,
            snapshotId: snapshot.id,
            status: 'NOT_SCANNED',
            detected: false,
            designScore: null,
            summary: null,
            findings: [],
            autoFillConfig: null,
        };
    }
    try {
        return await runChatbotDesignAudit(db, projectId, { snapshotId: snapshot.id });
    } catch (error) {
        if (error.code === 'WORKSPACE_UNAVAILABLE') {
            return {
                id: null,
                projectId,
                snapshotId: snapshot.id,
                status: 'WORKSPACE_UNAVAILABLE',
                detected: false,
                designScore: null,
                summary: { sdks: [], endpoints: [], systemPrompts: [], candidateDocs: [] },
                findings: [],
                autoFillConfig: null,
            };
        }
        throw error;
    }
}
