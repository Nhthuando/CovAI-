import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { jest } from '@jest/globals';

const require = createRequire(import.meta.url);
const SERVER_ROOT = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const SERVER_NODE_MODULES = path.join(SERVER_ROOT, 'node_modules');
const COVAI_TEMP_ROOT = path.join(SERVER_ROOT, '.covai-temp');

const EXCLUDED_SERVER_PACKAGES = new Set(['mongoose', 'bcrypt', 'razorpay', '.package-lock.json']);

export function sha256Text(content) {
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

export function sha256File(filePath) {
    return sha256Text(fs.readFileSync(filePath, 'utf8'));
}

export function snapshotSourceHashes(rootDir, relativePaths) {
    const hashes = new Map();
    for (const rel of relativePaths) {
        const full = path.join(rootDir, rel);
        if (fs.existsSync(full)) {
            hashes.set(rel, sha256File(full));
        }
    }
    return hashes;
}

export function verifySourceHashesMatch(rootDir, expectedHashes) {
    for (const [rel, expected] of expectedHashes.entries()) {
        const full = path.join(rootDir, rel);
        const actual = fs.existsSync(full) ? sha256File(full) : null;
        if (actual !== expected) {
            return { intact: false, file: rel, expected, actual };
        }
    }
    return { intact: true };
}

function linkNodeModulesExcludingStubs(fixtureNodeModules) {
    fs.mkdirSync(fixtureNodeModules, { recursive: true });
    const entries = fs.readdirSync(SERVER_NODE_MODULES, { withFileTypes: true });
    for (const entry of entries) {
        if (EXCLUDED_SERVER_PACKAGES.has(entry.name)) continue;
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        const src = path.join(SERVER_NODE_MODULES, entry.name);
        const dest = path.join(fixtureNodeModules, entry.name);
        if (fs.existsSync(dest)) continue;
        const linkType = process.platform === 'win32' ? 'junction' : 'dir';
        fs.symlinkSync(src, dest, linkType);
    }
}

function writeCjsLocalStubPackages(fixtureNodeModules) {
    // 1. mongoose stub supporting Schema, Schema.Types.ObjectId, defaults, validateSync, and chainable query proxies
    const mongooseDir = path.join(fixtureNodeModules, 'mongoose');
    fs.mkdirSync(mongooseDir, { recursive: true });
    fs.writeFileSync(
        path.join(mongooseDir, 'package.json'),
        JSON.stringify({ name: 'mongoose', version: '8.0.0', main: 'index.js' }, null, 2)
    );
    fs.writeFileSync(
        path.join(mongooseDir, 'index.js'),
        `'use strict';
class ValidationError extends Error {
    constructor(errors) {
        const messages = Object.values(errors || {}).map(e => e.message).join(', ');
        super(messages || 'Validation failed');
        this.name = 'ValidationError';
        this.errors = errors || {};
    }
}

class ObjectId {
    constructor(value) {
        this.value = value ? String(value) : '507f1f77bcf86cd799439011';
    }
    toString() {
        return this.value;
    }
    toJSON() {
        return this.value;
    }
    equals(other) {
        return this.value === String(other);
    }
    static isValid(val) {
        return typeof val === 'string' && /^[a-f\\d]{24}$/i.test(val);
    }
}

class Schema {
    constructor(definition = {}, options = {}) {
        this.definition = definition;
        this.options = options;
        this.methods = {};
        this.statics = {};
        this.indexes = [];
    }
    index(fields, opts) { this.indexes.push({ fields, opts }); return this; }
    pre() { return this; }
    post() { return this; }
    plugin() { return this; }
    set() { return this; }
    virtual() { return { get: () => this, set: () => this }; }
}

Schema.Types = {
    ObjectId: function SchemaObjectId(v) { return v; },
    Mixed: function Mixed() {},
    String,
    Number,
    Boolean,
    Date,
    Array,
};

function normalizeFieldSpec(spec) {
    if (Array.isArray(spec)) return { isArray: true, raw: spec };
    if (typeof spec === 'function') return { type: spec };
    if (spec && typeof spec === 'object') return spec;
    return {};
}

function createQueryChain(resolvedValue = []) {
    const chain = {
        populate() { return chain; },
        sort() { return chain; },
        select() { return chain; },
        lean() { return chain; },
        limit() { return chain; },
        skip() { return chain; },
        where() { return chain; },
        exec: async () => resolvedValue,
        then(onFulfilled, onRejected) {
            return Promise.resolve(resolvedValue).then(onFulfilled, onRejected);
        },
        catch(onRejected) {
            return Promise.resolve(resolvedValue).catch(onRejected);
        },
    };
    return chain;
}

const models = {};
const modelSchemas = {};

function model(name, schema) {
    modelSchemas[name] = schema;
    class ModelDocument {
        constructor(data = {}) {
            const def = (schema && schema.definition) || {};
            for (const key of Object.keys(def)) {
                const spec = normalizeFieldSpec(def[key]);
                if (data[key] !== undefined) {
                    this[key] = data[key];
                } else if (spec.default !== undefined) {
                    this[key] = typeof spec.default === 'function' ? spec.default() : spec.default;
                } else if (spec.isArray) {
                    this[key] = [];
                }
            }
            for (const [k, v] of Object.entries(data || {})) {
                if (this[k] === undefined) this[k] = v;
            }
            if (!this._id) this._id = new ObjectId();
        }

        validateSync() {
            const def = (schema && schema.definition) || {};
            const errors = {};
            for (const field of Object.keys(def)) {
                const spec = normalizeFieldSpec(def[field]);
                const val = this[field];
                const isRequired = Array.isArray(spec.required) ? Boolean(spec.required[0]) : Boolean(spec.required);
                const requiredMsg = Array.isArray(spec.required) && spec.required[1]
                    ? spec.required[1]
                    : \`Path \\\`\${field}\\\` is required.\`;
                if (isRequired && (val === undefined || val === null || val === '')) {
                    errors[field] = { message: requiredMsg, kind: 'required', path: field, value: val };
                    continue;
                }
                if (val !== undefined && val !== null && spec.enum) {
                    const allowed = Array.isArray(spec.enum) ? spec.enum : (spec.enum.values || []);
                    if (allowed.length > 0 && !allowed.includes(val)) {
                        errors[field] = {
                            message: \`\\\`\${val}\\\` is not a valid enum value for path \\\`\${field}\\\`.\`,
                            kind: 'enum',
                            path: field,
                            value: val,
                        };
                    }
                }
                if (typeof val === 'number' && typeof spec.min === 'number' && val < spec.min) {
                    errors[field] = {
                        message: \`Path \\\`\${field}\\\` (\${val}) is less than minimum allowed value (\${spec.min}).\`,
                        kind: 'min',
                        path: field,
                        value: val,
                    };
                }
                if (typeof val === 'number' && typeof spec.max === 'number' && val > spec.max) {
                    errors[field] = {
                        message: \`Path \\\`\${field}\\\` (\${val}) is more than maximum allowed value (\${spec.max}).\`,
                        kind: 'max',
                        path: field,
                        value: val,
                    };
                }
            }
            return Object.keys(errors).length > 0 ? new ValidationError(errors) : undefined;
        }

        async validate() {
            const err = this.validateSync();
            if (err) throw err;
        }

        toObject() { return { ...this }; }
        toJSON() { return { ...this }; }
    }

    ModelDocument.modelName = name;
    ModelDocument.schema = schema;
    ModelDocument.find = () => createQueryChain([]);
    ModelDocument.findOne = () => createQueryChain(null);
    ModelDocument.findById = () => createQueryChain(null);
    ModelDocument.findOneAndUpdate = () => createQueryChain(null);
    ModelDocument.findByIdAndUpdate = () => createQueryChain(null);
    ModelDocument.create = async (doc) => new ModelDocument(doc);
    ModelDocument.insertMany = async (docs = []) => docs.map(d => new ModelDocument(d));
    ModelDocument.deleteOne = async () => ({ deletedCount: 0 });
    ModelDocument.deleteMany = async () => ({ deletedCount: 0 });
    ModelDocument.exists = async () => null;
    ModelDocument.countDocuments = async () => 0;
    ModelDocument.updateOne = async () => ({ modifiedCount: 0 });

    models[name] = ModelDocument;
    return ModelDocument;
}

module.exports = {
    Schema,
    model,
    models,
    modelSchemas,
    Types: { ObjectId },
    Error: { ValidationError },
    connect: async () => ({ connection: { host: 'localhost' } }),
    disconnect: async () => {},
    createConnection: () => ({ close: async () => {} }),
    connection: { close: async () => {} },
};
`
    );

    // 2. bcrypt stub wrapping installed bcryptjs
    const bcryptDir = path.join(fixtureNodeModules, 'bcrypt');
    fs.mkdirSync(bcryptDir, { recursive: true });
    fs.writeFileSync(
        path.join(bcryptDir, 'package.json'),
        JSON.stringify({ name: 'bcrypt', version: '5.1.1', main: 'index.js' }, null, 2)
    );
    fs.writeFileSync(
        path.join(bcryptDir, 'index.js'),
        `'use strict';
const bcryptjs = require('bcryptjs');
module.exports = {
    hash: (...args) => bcryptjs.hash(...args),
    compare: (...args) => bcryptjs.compare(...args),
    genSalt: (...args) => bcryptjs.genSalt(...args),
    hashSync: (...args) => bcryptjs.hashSync(...args),
    compareSync: (...args) => bcryptjs.compareSync(...args),
};
`
    );

    // 3. razorpay stub including dist/utils/razorpay-utils.js
    const razorpayDir = path.join(fixtureNodeModules, 'razorpay');
    const razorpayUtilsDir = path.join(razorpayDir, 'dist', 'utils');
    fs.mkdirSync(razorpayUtilsDir, { recursive: true });
    fs.writeFileSync(
        path.join(razorpayDir, 'package.json'),
        JSON.stringify({ name: 'razorpay', version: '2.9.4', main: 'index.js' }, null, 2)
    );
    fs.writeFileSync(
        path.join(razorpayDir, 'index.js'),
        `'use strict';
class Razorpay {
    constructor(options = {}) {
        this.key_id = options.key_id;
        this.key_secret = options.key_secret;
        this.orders = {
            create: async (payload = {}) => ({ id: 'order_stub_1', status: 'created', ...payload }),
            fetch: async (id) => ({ id, status: 'created' }),
        };
        this.payments = {
            fetch: async (id) => ({ id, status: 'captured' }),
        };
    }
}
module.exports = Razorpay;
`
    );
    fs.writeFileSync(
        path.join(razorpayUtilsDir, 'razorpay-utils.js'),
        `'use strict';
function validateWebhookSignature(body, signature, secret) {
    return Boolean(body && signature && secret);
}
module.exports = { validateWebhookSignature };
`
    );
}

export const CJS_FIXTURE_SOURCES = {
    'models/Product.js': `const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const productSchema = new Schema({
    title: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0 },
    stock: { type: Number, default: 10 },
});

module.exports = mongoose.model('Product', productSchema);
`,
    'models/Payment.js': `const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const paymentSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    method: { type: String, enum: ['Razorpay', 'COD'], default: 'Razorpay' },
    transactionId: { type: String, required: true },
    status: { type: String, enum: ['Pending', 'Success', 'Failed'], default: 'Pending' },
});

module.exports = mongoose.model('Payment', paymentSchema);
`,
    'models/User.js': `const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const userSchema = new Schema({
    name: { type: String, required: true },
    email: { type: String, required: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
});

module.exports = mongoose.model('User', userSchema);
`,
    'models/Admin.js': `const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const adminSchema = new Schema({
    name: { type: String, default: 'Admin' },
    email: { type: String, required: true },
    password: { type: String, required: true },
    active: { type: Boolean, default: true },
});

module.exports = mongoose.model('Admin', adminSchema);
`,
    'models/Order.js': `const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const orderSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    orderId: { type: String, required: true },
    items: [{ type: Schema.Types.ObjectId, ref: 'Product' }],
    totalAmount: { type: Number, required: true, min: 0 },
    status: {
        type: String,
        enum: ['pending', 'paid', 'shipped', 'cancelled'],
        default: 'pending',
    },
    paymentMethod: {
        type: String,
        enum: ['Razorpay', 'COD'],
        default: 'Razorpay',
    },
    createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Order', orderSchema);
`,
    'models/Cart.js': `const mongoose = require('mongoose');
const { Schema } = mongoose;

const cartSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    items: [{ type: Schema.Types.ObjectId, ref: 'Product' }],
    totalAmount: { type: Number, default: 0, min: 0 },
    status: {
        type: String,
        enum: ['active', 'checked_out'],
        default: 'active',
    },
});

module.exports = mongoose.model('Cart', cartSchema);
`,
    'controllers/paymentController.js': `const productModel = require('../models/Product');
const orderModel = require('../models/Order');
const paymentModel = require('../models/Payment');
const { validateWebhookSignature } = require('razorpay/dist/utils/razorpay-utils');

async function verifyPayment(req, res) {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, user_id, method, product_id } = req.body;
    try {
        const secret = process.env.RZR_PAY_SECRET_KEY;
        const body = razorpay_order_id + '|' + razorpay_payment_id;
        if (!validateWebhookSignature(body, razorpay_signature, secret)) {
            return res.status(400).json({ status: 'verification_failed' });
        }
        const paymentDetails = { userId: user_id, method, transactionId: razorpay_payment_id, status: 'Success' };
        paymentModel.create(paymentDetails);
        await orderModel.findOneAndUpdate({ orderId: razorpay_order_id }, { status: 'paid' });
        await productModel.findByIdAndUpdate(product_id, { $inc: { stock: -1 } });
        res.status(200).json({ status: 'ok' });
    } catch (error) {
        res.status(500).json({ message: 'Cannot verify payment, server error.' });
    }
}

module.exports = { placeOrder, verifyPayment };
`,
    'controllers/chatbotController.js': `function classifyIntent(message) {
    if (typeof message !== 'string' || !message.trim()) {
        return 'unknown';
    }
    const lower = message.toLowerCase();
    if (lower.includes('order') || lower.includes('track')) return 'order_status';
    if (lower.includes('refund') || lower.includes('return')) return 'refund';
    return 'general';
}

function buildQuickReplies(intent) {
    if (intent === 'order_status') return ['Track my order', 'Cancel order'];
    if (intent === 'refund') return ['Start return', 'Refund policy'];
    return ['Browse products', 'Contact support'];
}

function formatBotReply(intent, userName = 'Guest') {
    const suggestions = buildQuickReplies(intent);
    const messages = {
        order_status: \`Hi \${userName}, let me check your order status.\`,
        refund: \`Hi \${userName}, here are our refund options.\`,
        general: \`Hi \${userName}, how can I help you today?\`,
        unknown: \`Hi \${userName}, could you please clarify your question?\`,
    };
    return {
        intent,
        reply: messages[intent] || messages.unknown,
        suggestions,
    };
}

async function handleMessage(req, res) {
    try {
        const message = req?.body?.message || '';
        const userName = req?.user?.name || 'Guest';
        const intent = classifyIntent(message);
        const payload = formatBotReply(intent, userName);
        return res.status(200).json({ success: true, ...payload });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
}

module.exports = {
    classifyIntent,
    buildQuickReplies,
    formatBotReply,
    handleMessage,
};
`,
    'controllers/adminController.js': `const Admin = require('../models/Admin');
const bcrypt = require('bcrypt');

async function listAdmins(req, res) {
    try {
        const admins = await Admin.find({ active: true });
        return res.status(200).json({ success: true, admins });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
}

async function createAdmin(req, res) {
    try {
        const { email, password, name } = req.body || {};
        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Email and password are required' });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const admin = await Admin.create({ email, password: hashedPassword, name: name || 'Admin' });
        return res.status(201).json({ success: true, admin });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
}

module.exports = { listAdmins, createAdmin };
`,
    'controllers/orderController.js': `const Order = require('../models/Order');
const Razorpay = require('razorpay');

const razorpayInstance = new Razorpay({
    key_id: process.env.RZR_PAY_KEY_ID || 'rzp_test_key',
    key_secret: process.env.RZR_PAY_SECRET_KEY || 'rzp_test_secret',
});

async function getUserOrders(req, res) {
    try {
        const orders = await Order.find({ userId: req.user.id })
            .populate('items')
            .sort({ createdAt: -1 })
            .lean();
        return res.status(200).json({ success: true, orders });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
}

async function createRazorpayOrder(req, res) {
    try {
        const { amount, currency = 'INR', receipt } = req.body || {};
        if (!amount || amount <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid amount' });
        }
        const rzpOrder = await razorpayInstance.orders.create({
            amount: Math.round(amount * 100),
            currency,
            receipt: receipt || 'rcpt_default',
        });
        return res.status(201).json({ success: true, order: rzpOrder });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
}

module.exports = { getUserOrders, createRazorpayOrder };
`,
    'scripts/userSeeding.js': `const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const User = require('../models/User');
require('dotenv').config();

async function seedDefaultUsers() {
    try {
        await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/covai_shop');
        const hashedPassword = await bcrypt.hash('SeedPass123!', 10);
        const created = await User.create({
            name: 'Seed Admin',
            email: 'seed@example.com',
            password: hashedPassword,
            role: 'admin',
        });
        if (!created) {
            process.exit(1);
            return;
        }
        process.exit(0);
    } catch (error) {
        process.exit(1);
    }
}

seedDefaultUsers();
`,
};

export function createCjsExpressMongooseFixture({ prefix = 'e2e-cjs-fixture-', overrides = {} } = {}) {
    fs.mkdirSync(COVAI_TEMP_ROOT, { recursive: true });
    const rootDir = fs.mkdtempSync(path.join(COVAI_TEMP_ROOT, prefix));

    fs.writeFileSync(
        path.join(rootDir, 'package.json'),
        JSON.stringify(
            {
                name: 'covai-e2e-cjs-fixture',
                version: '1.0.0',
                private: true,
                type: 'commonjs',
                scripts: { test: 'jest' },
                devDependencies: { jest: '^29.7.0' },
                dependencies: {
                    mongoose: '^8.0.0',
                    bcrypt: '^5.1.1',
                    razorpay: '^2.9.4',
                    dotenv: '^17.4.2',
                },
            },
            null,
            2
        )
    );
    fs.writeFileSync(
        path.join(rootDir, 'jest.config.cjs'),
        `module.exports = {
    testEnvironment: 'node',
    testMatch: ['**/tests/**/*.test.js'],
};
`
    );

    const fixtureNodeModules = path.join(rootDir, 'node_modules');
    linkNodeModulesExcludingStubs(fixtureNodeModules);
    writeCjsLocalStubPackages(fixtureNodeModules);

    const files = { ...CJS_FIXTURE_SOURCES, ...overrides };
    for (const [relPath, content] of Object.entries(files)) {
        const abs = path.join(rootDir, relPath);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, 'utf8');
    }

    fs.mkdirSync(path.join(rootDir, 'tests'), { recursive: true });

    return {
        rootDir,
        sourceFiles: Object.keys(files),
        snapshotHashes: () => snapshotSourceHashes(rootDir, Object.keys(files)),
    };
}

export const VITEST_TS_FIXTURE_SOURCES = {
    'src/presets/types.ts': `export interface PresetItem {
    id: string;
    label: string;
    tier: 1 | 2;
    enabled: boolean;
}

export type PresetCategory = 'basic' | 'ads';
`,
    'src/presets/tier1-basic.ts': `import type { PresetItem } from './types';

export const tier1BasicPresets: PresetItem[] = [
    { id: 'basic-1', label: 'Basic Feed', tier: 1, enabled: true },
    { id: 'basic-2', label: 'Basic Search', tier: 1, enabled: false },
];

export function getBasicPresetIds(): string[] {
    return tier1BasicPresets.filter(item => item.enabled).map(item => item.id);
}
`,
    'src/presets/tier2-ads.ts': `import type { PresetItem } from './types';

export const tier2AdsPresets: PresetItem[] = [
    { id: 'ads-1', label: 'Sponsored Banner', tier: 2, enabled: true },
    { id: 'ads-2', label: 'Carousel Ad', tier: 2, enabled: false },
];

export function filterEnabledAds(items: PresetItem[] = tier2AdsPresets): PresetItem[] {
    return items.filter(item => item.tier === 2 && item.enabled);
}
`,
    'src/presets/index.ts': `export type { PresetItem, PresetCategory } from './types';
export * from './tier1-basic';
export { tier2AdsPresets, filterEnabledAds } from './tier2-ads';

import { tier1BasicPresets } from './tier1-basic';
import { tier2AdsPresets } from './tier2-ads';
import type { PresetItem } from './types';

export function resolvePresetsByTier(tier: 1 | 2): PresetItem[] {
    if (tier === 1) return tier1BasicPresets.filter(p => p.enabled);
    if (tier === 2) return tier2AdsPresets.filter(p => p.enabled);
    return [];
}

export default {
    resolvePresetsByTier,
    tier2AdsPresets,
};
`,
};

export function createVitestTsFixture({ prefix = 'e2e-vitest-ts-fixture-', overrides = {} } = {}) {
    fs.mkdirSync(COVAI_TEMP_ROOT, { recursive: true });
    const rootDir = fs.mkdtempSync(path.join(COVAI_TEMP_ROOT, prefix));

    fs.writeFileSync(
        path.join(rootDir, 'package.json'),
        JSON.stringify(
            {
                name: 'covai-e2e-ts-fixture',
                version: '1.0.0',
                private: true,
                type: 'module',
                scripts: { test: 'vitest run' },
                devDependencies: {
                    vitest: '^3.2.7',
                    '@vitest/coverage-v8': '^3.2.7',
                },
            },
            null,
            2
        )
    );
    fs.writeFileSync(
        path.join(rootDir, 'tsconfig.json'),
        JSON.stringify(
            {
                compilerOptions: {
                    target: 'ES2022',
                    module: 'ESNext',
                    moduleResolution: 'bundler',
                    strict: true,
                    esModuleInterop: true,
                    skipLibCheck: true,
                },
                include: ['src/**/*', 'tests/**/*'],
            },
            null,
            2
        )
    );
    fs.writeFileSync(
        path.join(rootDir, 'vitest.config.ts'),
        `import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
    },
});
`
    );

    const fixtureNodeModules = path.join(rootDir, 'node_modules');
    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    fs.symlinkSync(SERVER_NODE_MODULES, fixtureNodeModules, linkType);

    const files = { ...VITEST_TS_FIXTURE_SOURCES, ...overrides };
    for (const [relPath, content] of Object.entries(files)) {
        const abs = path.join(rootDir, relPath);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, 'utf8');
    }

    fs.mkdirSync(path.join(rootDir, 'tests'), { recursive: true });

    return {
        rootDir,
        sourceFiles: Object.keys(files),
        snapshotHashes: () => snapshotSourceHashes(rootDir, Object.keys(files)),
    };
}

function unlinkJunctionsRecursively(dirPath) {
    if (!fs.existsSync(dirPath)) return;
    let stat;
    try {
        stat = fs.lstatSync(dirPath);
    } catch {
        return;
    }
    if (stat.isSymbolicLink()) {
        fs.unlinkSync(dirPath);
        return;
    }
    if (!stat.isDirectory()) return;
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        const full = path.join(dirPath, entry.name);
        try {
            const entryStat = fs.lstatSync(full);
            if (entryStat.isSymbolicLink()) {
                fs.unlinkSync(full);
            } else if (entryStat.isDirectory() && (entry.name.startsWith('@') || entry.name === 'node_modules')) {
                unlinkJunctionsRecursively(full);
            }
        } catch {
            // Best-effort cleanup
        }
    }
}

export function cleanupFixtureDir(dir, activeApplyLocks = null) {
    if (activeApplyLocks && typeof activeApplyLocks.clear === 'function') {
        activeApplyLocks.clear();
    }
    if (!dir || !fs.existsSync(dir)) return;
    unlinkJunctionsRecursively(path.join(dir, 'node_modules'));
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

export function createPrismaDouble({
    projectId = 'proj-e2e-1',
    snapshotId = 'snap-e2e-1',
    userId = 'user-e2e-1',
    rootDir = '',
    coverageFiles = [],
} = {}) {
    const state = {
        projectId,
        snapshotId,
        userId,
        rootDir,
        coverageFiles: [...coverageFiles],
    };

    const fixturesByProjectId = new Map();
    const fixturesBySnapshotId = new Map();
    const fileVersions = new Map();

    const registerFixture = ({ projectId: p, snapshotId: s, userId: u, rootDir: r, coverageFiles: cf }) => {
        const existing = (p ? fixturesByProjectId.get(p) : null) || (s ? fixturesBySnapshotId.get(s) : null) || {};
        const entry = {
            projectId: p ?? existing.projectId ?? state.projectId,
            snapshotId: s ?? existing.snapshotId ?? state.snapshotId,
            userId: u ?? existing.userId ?? state.userId,
            rootDir: r ?? existing.rootDir ?? state.rootDir,
            coverageFiles: cf !== undefined ? [...cf] : [...(existing.coverageFiles || [])],
        };
        if (entry.projectId) fixturesByProjectId.set(entry.projectId, entry);
        if (entry.snapshotId) {
            fixturesBySnapshotId.set(entry.snapshotId, entry);
            const prefix = `${entry.snapshotId}::`;
            for (const key of fileVersions.keys()) {
                if (key.startsWith(prefix)) fileVersions.delete(key);
            }
        }
        state.projectId = entry.projectId;
        state.snapshotId = entry.snapshotId;
        state.userId = entry.userId;
        state.rootDir = entry.rootDir;
        state.coverageFiles = entry.coverageFiles;
        return entry;
    };

    if (projectId || snapshotId) {
        registerFixture({ projectId, snapshotId, userId, rootDir, coverageFiles });
    }

    const resolveProjectFixture = (id) => {
        if (id) return fixturesByProjectId.get(id) || null;
        if (state.projectId && fixturesByProjectId.has(state.projectId)) {
            return fixturesByProjectId.get(state.projectId);
        }
        return state.projectId ? state : null;
    };

    const resolveSnapshotFixture = ({ id, projectId: pId } = {}) => {
        if (id) {
            const found = fixturesBySnapshotId.get(id) || null;
            if (!found) return null;
            if (pId && found.projectId !== pId) return null;
            return found;
        }
        if (pId) {
            return fixturesByProjectId.get(pId) || null;
        }
        if (state.snapshotId && fixturesBySnapshotId.has(state.snapshotId)) {
            return fixturesBySnapshotId.get(state.snapshotId);
        }
        return state.snapshotId ? state : null;
    };

    const buildSnapshotRecord = (fixture) => ({
        id: fixture.snapshotId,
        projectId: fixture.projectId,
        rootDir: fixture.rootDir,
        commitSha: null,
        project: {
            id: fixture.projectId,
            ownerId: fixture.userId,
            workspaceRevision: 0,
            accessRevision: 0,
        },
        coverageSummaries: null,
        coverageFiles: [...(fixture.coverageFiles || [])],
    });

    const matchesOwnerWhere = (fixture, where = {}) => {
        if (!fixture) return false;
        if (where.ownerId && where.ownerId !== fixture.userId) return false;
        if (Array.isArray(where.OR) && where.OR.length > 0) {
            const ok = where.OR.some(clause => {
                if (clause?.ownerId) return clause.ownerId === fixture.userId;
                if (clause?.members?.some?.userId) return clause.members.some.userId === fixture.userId;
                return false;
            });
            if (!ok) return false;
        }
        return true;
    };

    const db = {
        __state: state,
        setFixture(opts = {}) {
            return registerFixture(opts);
        },
        resetFixtures() {
            fixturesByProjectId.clear();
            fixturesBySnapshotId.clear();
            fileVersions.clear();
            state.projectId = projectId;
            state.snapshotId = snapshotId;
            state.userId = userId;
            state.rootDir = rootDir;
            state.coverageFiles = [...coverageFiles];
            if (projectId || snapshotId) {
                registerFixture({ projectId, snapshotId, userId, rootDir, coverageFiles });
            }
        },
        project: {
            findFirst: jest.fn(async ({ where, include } = {}) => {
                const fixture = resolveProjectFixture(where?.id);
                if (!matchesOwnerWhere(fixture, where)) return null;
                const snapWhereId = include?.snapshots?.where?.id;
                const snapMatched = fixture.rootDir && (!snapWhereId || snapWhereId === fixture.snapshotId);
                return {
                    id: fixture.projectId,
                    ownerId: fixture.userId,
                    activeSnapshotId: fixture.snapshotId,
                    workspaceRevision: 0,
                    accessRevision: 0,
                    snapshots: snapMatched
                        ? [{ id: fixture.snapshotId, projectId: fixture.projectId, rootDir: fixture.rootDir, createdAt: new Date() }]
                        : [],
                };
            }),
            findUnique: jest.fn(async ({ where } = {}) => {
                const fixture = resolveProjectFixture(where?.id);
                if (!fixture) return null;
                return {
                    id: fixture.projectId,
                    ownerId: fixture.userId,
                    activeSnapshotId: fixture.snapshotId,
                    workspaceRevision: 0,
                    accessRevision: 0,
                };
            }),
        },
        projectMember: {
            findUnique: jest.fn(async ({ where } = {}) => {
                const pId = where?.projectId_userId?.projectId;
                const uId = where?.projectId_userId?.userId;
                const fixture = resolveProjectFixture(pId);
                if (!fixture) return null;
                if (uId && uId !== fixture.userId) return null;
                return { projectId: fixture.projectId, userId: fixture.userId, role: 'OWNER', disciplineRole: 'PM' };
            }),
        },
        projectSnapshot: {
            findUnique: jest.fn(async ({ where } = {}) => {
                const fixture = resolveSnapshotFixture({ id: where?.id });
                if (!fixture) return null;
                return buildSnapshotRecord(fixture);
            }),
            findFirst: jest.fn(async ({ where } = {}) => {
                const fixture = resolveSnapshotFixture({ id: where?.id, projectId: where?.projectId });
                if (!fixture) return null;
                return buildSnapshotRecord(fixture);
            }),
            findMany: jest.fn(async () => []),
            update: jest.fn(async () => ({})),
        },
        projectFileVersion: {
            findUnique: jest.fn(async ({ where } = {}) => {
                const keyParts = where?.snapshotId_relativePath;
                if (!keyParts) return null;
                return fileVersions.get(`${keyParts.snapshotId}::${keyParts.relativePath}`) || null;
            }),
            create: jest.fn(async ({ data } = {}) => {
                const key = `${data.snapshotId}::${data.relativePath}`;
                const row = { id: `pfv-${fileVersions.size + 1}`, ...data };
                fileVersions.set(key, row);
                return row;
            }),
            upsert: jest.fn(async ({ where, create, update } = {}) => {
                const keyParts = where?.snapshotId_relativePath || { snapshotId: create?.snapshotId, relativePath: create?.relativePath };
                const key = `${keyParts.snapshotId}::${keyParts.relativePath}`;
                const existing = fileVersions.get(key);
                if (existing) {
                    const updated = { ...existing, ...(update || {}) };
                    fileVersions.set(key, updated);
                    return updated;
                }
                const created = { id: `pfv-${fileVersions.size + 1}`, ...create };
                fileVersions.set(key, created);
                return created;
            }),
            update: jest.fn(async ({ where, data } = {}) => {
                const keyParts = where?.snapshotId_relativePath;
                const key = keyParts ? `${keyParts.snapshotId}::${keyParts.relativePath}` : null;
                const existing = key ? fileVersions.get(key) : null;
                if (!existing) return null;
                const nextRevision = data?.revision?.increment ? (existing.revision || 0) + data.revision.increment : (data?.revision ?? existing.revision);
                const updated = { ...existing, ...data, revision: nextRevision };
                fileVersions.set(key, updated);
                return updated;
            }),
        },
        projectMutation: {
            findUnique: jest.fn(async () => null),
        },
        coverageFile: {
            findMany: jest.fn(async ({ where } = {}) => {
                const fixture = resolveSnapshotFixture({ id: where?.snapshotId });
                return fixture ? fixture.coverageFiles : [];
            }),
            findFirst: jest.fn(async ({ where } = {}) => {
                const fixture = resolveSnapshotFixture({ id: where?.snapshotId });
                const list = fixture ? fixture.coverageFiles : [];
                return list.find(f => !where?.filePath || f.filePath === where.filePath) || null;
            }),
            upsert: jest.fn(async () => ({})),
        },
        coverageSummary: {
            upsert: jest.fn(async () => ({})),
        },
        testRun: {
            findFirst: jest.fn(async () => null),
            create: jest.fn(async (args) => ({ id: 'run-e2e-1', ...(args?.data || {}) })),
            update: jest.fn(async () => ({})),
        },
        $transaction: jest.fn(async (arg) => {
            if (typeof arg === 'function') return arg(db);
            if (Array.isArray(arg)) return Promise.all(arg);
            return null;
        }),
    };

    return db;
}

export function runDirectJest(rootDir, testFiles) {
    const jestBin = path.join(rootDir, 'node_modules', 'jest', 'bin', 'jest.js');
    const args = [jestBin, ...testFiles, '--runInBand', '--no-cache'];
    return execFileSync(process.execPath, args, {
        cwd: rootDir,
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 45000,
    });
}

export function runDirectVitest(rootDir, testFiles) {
    const vitestBin = path.join(SERVER_NODE_MODULES, 'vitest', 'vitest.mjs');
    const args = [vitestBin, 'run', ...testFiles, '--globals', '--no-file-parallelism'];
    return execFileSync(process.execPath, args, {
        cwd: rootDir,
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 45000,
    });
}
