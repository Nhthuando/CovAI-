import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@jest/globals';
import { proposeShopprControllerDraft } from '../services/shopprControllerDraft.service.js';
import { assembleUnitTestCandidate } from '../services/unitTestChangeSet.service.js';
import { inspectUnitTestQuality } from '../services/unitTestQualityGate.service.js';

const sourceFile = 'controllers/paymentController.js';
const testFile = 'tests/paymentController.vitest.test.js';
const controller = `const productModel = require('../models/Product');
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
        const paymentDetails = { userId: user_id, method, transactionId: razorpay_payment_id, status:'Success' };
        paymentModel.create(paymentDetails);
        await orderModel.findOneAndUpdate({orderId: razorpay_order_id}, {status: 'paid'});
        await productModel.findByIdAndUpdate(product_id, {$inc: {stock: -1} });
        res.status(200).json({ status: 'ok' });
    } catch (error) {
        res.status(500).json({ message: 'Cannot verify payment, server error.' });
    }
}`;

test('payment draft uses the controller’s CommonJS bindings and reports dangling source exports separately', () => {
    const directory = fileURLToPath(new URL('../../.covai-temp/', import.meta.url));
    fs.mkdirSync(directory, { recursive: true });
    const rootDir = fs.mkdtempSync(path.join(directory, 'payment-draft-'));
    try {
        fs.mkdirSync(path.join(rootDir, 'controllers'));
        const source = path.join(rootDir, sourceFile);
        const sourceCode = controller + '\nmodule.exports = { verifyPayment };\n';
        fs.writeFileSync(source, sourceCode);
        const draft = proposeShopprControllerDraft({ sourceCode, sourceFile, testFile, framework: 'vitest' });
        const { content: code } = assembleUnitTestCandidate({ original: '', proposed: draft.fullUpdatedContent, testFile });
        for (const [model, binding] of [['Payment', 'paymentModelMock'], ['Order', 'orderModelMock'], ['Product', 'productModelMock']]) {
            expect(code).toContain(`[require.resolve("../models/${model}"), ${binding}]`);
        }
        expect(code).toContain('require.resolve("razorpay/dist/utils/razorpay-utils")');
        const inspect = () => inspectUnitTestQuality({ rootDir, testFile, sourceFile, framework: 'vitest', code });
        expect(inspect()).toMatchObject({ cases: expect.arrayContaining([expect.objectContaining({
            testCaseId: 'records a verified payment, marks the order paid and decrements stock',
        })]), findings: [] });
        fs.writeFileSync(source, controller + '\nmodule.exports = { placeOrder, verifyPayment };\n');
        expect(inspect().findings).toEqual([expect.objectContaining({
            code: 'C', classification: 'POTENTIAL_SOURCE_DEFECT', reason: expect.stringContaining('placeOrder'),
        })]);
    } finally {
        fs.rmSync(rootDir, { recursive: true, force: true });
    }
});
