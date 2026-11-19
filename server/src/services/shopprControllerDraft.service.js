import path from 'node:path';
import { renderNativeCommonJsMockHarness } from './nativeCommonJsMockHarness.service.js';

function relativeModule(testFile, target) {
    const relative = path.posix.relative(path.posix.dirname(testFile), target);
    return JSON.stringify(relative.startsWith('.') ? relative : './' + relative);
}

export function proposeShopprControllerDraft({ sourceCode, sourceFile, testFile, framework, original }) {
    if (original?.trim()) return null;
    const isVitest = framework === 'vitest';
    const runner = isVitest ? 'vi' : 'jest';
    const source = relativeModule(testFile, sourceFile);
    const dep = name => relativeModule(testFile, path.posix.join(path.posix.dirname(sourceFile), '../models', name));
    const modelMocks = new Map();
    let cases;

    if (/\/categoryController\.js$/.test(sourceFile) &&
        /categoryModel\s*=\s*require\(['"]\.\.\/models\/Category['"]\)/.test(sourceCode) &&
        /categoryModel\.find\(\{\}\)\.select\(['"]_id name['"]\)/.test(sourceCode) &&
        /module\.exports\s*=\s*\{\s*getCategories\s*\}/.test(sourceCode)) {
        modelMocks.set('categoryModelMock', { module: dep('Category'), methods: ['find'] });
        cases = `test('returns the selected categories', async () => {
    const categories = [{ _id: 'cat-1', name: 'Tea' }];
    const select = ${runner}.fn().mockResolvedValueOnce(categories);
    categoryModelMock.find.mockReturnValueOnce({ select });
    const res = response();
    await controller.getCategories({}, res);
    expect(categoryModelMock.find).toHaveBeenCalledWith({});
    expect(select).toHaveBeenCalledWith('_id name');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, categories });
});

test('returns 500 when the category query fails', async () => {
    categoryModelMock.find.mockReturnValueOnce({ select: ${runner}.fn().mockRejectedValueOnce(new Error('query failed')) });
    const res = response();
    await controller.getCategories({}, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: "Cannot get categories, server error" });
});`;
    } else if (/\/cartController\.js$/.test(sourceFile) &&
        /cartModel\s*=\s*require\(['"]\.\.\/models\/Cart['"]\)/.test(sourceCode) &&
        /productModel\s*=\s*require\(['"]\.\.\/models\/Product['"]\)/.test(sourceCode) &&
        ['findById(req.params.productId)', 'findOne({userId: req.user.id})', '$push: {items: productDetails._id}',
            '$inc: {totalAmount: productDetails.price - productDetails.discount}', ".populate('items')",
            'cart: cartDetails[0].items', 'await cartModel.create(cartData)'].every(fragment => sourceCode.includes(fragment))) {
        modelMocks.set('cartModelMock', { module: dep('Cart'), methods: ['findOne', 'create', 'updateOne', 'exists', 'find'] });
        modelMocks.set('productModelMock', { module: dep('Product'), methods: ['findById'] });
        cases = `const product = { _id: 'stored-product-1', price: 25, discount: 5 };
const request = () => ({ params: { productId: 'product-1' }, user: { id: 'user-1' } });

test('TC-BRANCH-02: addToCart creates a cart when none exists', async () => {
    productModelMock.findById.mockResolvedValueOnce(product);
    cartModelMock.findOne.mockResolvedValueOnce(null);
    const res = response();
    await controller.addToCart(request(), res);
    expect(productModelMock.findById).toHaveBeenCalledWith('product-1');
    expect(cartModelMock.findOne).toHaveBeenCalledWith({ userId: 'user-1' });
    expect(cartModelMock.create).toHaveBeenCalledWith({ userId: 'user-1', items: ['stored-product-1'], totalAmount: 20 });
    expect(cartModelMock.updateOne).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
});

test('TC-BRANCH-04: addToCart updates an existing cart', async () => {
    productModelMock.findById.mockResolvedValueOnce(product);
    cartModelMock.findOne.mockResolvedValueOnce({ _id: 'cart-1', totalAmount: 10 });
    const res = response();
    await controller.addToCart(request(), res);
    expect(productModelMock.findById).toHaveBeenCalledWith('product-1');
    expect(cartModelMock.findOne).toHaveBeenCalledWith({ userId: 'user-1' });
    expect(cartModelMock.updateOne).toHaveBeenCalledWith({ userId: 'user-1' }, {
        $push: { items: 'stored-product-1' },
        $inc: { totalAmount: 20 },
    });
    expect(cartModelMock.create).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
});

test('TC-BRANCH-07: getCart returns populated items when a cart exists', async () => {
    const items = [{ _id: 'stored-product-1', title: 'Tea' }];
    const populate = ${runner}.fn().mockResolvedValueOnce([{ items }]);
    cartModelMock.exists.mockResolvedValueOnce({ _id: 'cart-1' });
    cartModelMock.find.mockReturnValueOnce({ populate });
    const res = response();
    await controller.getCart({ user: { id: 'user-1' } }, res);
    expect(cartModelMock.exists).toHaveBeenCalledWith({ userId: 'user-1' });
    expect(cartModelMock.find).toHaveBeenCalledWith({ userId: 'user-1' });
    expect(populate).toHaveBeenCalledWith('items');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, cart: items });
});`;
    } else if (/\/paymentController\.js$/.test(sourceFile) &&
        ["require('../models/Payment')", "require('../models/Order')", "require('../models/Product')",
            "require('razorpay/dist/utils/razorpay-utils')", 'validateWebhookSignature(body, razorpay_signature, secret)',
            'paymentModel.create(paymentDetails)', 'orderModel.findOneAndUpdate({orderId: razorpay_order_id}',
            'productModel.findByIdAndUpdate(product_id, {$inc: {stock: -1}', 'transactionId: razorpay_payment_id',
            "status:'Success'", "status: 'verification_failed'", 'Cannot verify payment, server error.'].every(fragment => sourceCode.includes(fragment))) {
        modelMocks.set('paymentModelMock', { module: dep('Payment'), methods: ['create'] });
        modelMocks.set('orderModelMock', { module: dep('Order'), methods: ['findOneAndUpdate'] });
        modelMocks.set('productModelMock', { module: dep('Product'), methods: ['findByIdAndUpdate'] });
        modelMocks.set('razorpayMock', { module: JSON.stringify('razorpay/dist/utils/razorpay-utils'), methods: ['validateWebhookSignature'] });
        cases = `const request = () => ({ body: {
    razorpay_order_id: 'order-1',
    razorpay_payment_id: 'payment-1',
    razorpay_signature: 'test-signature',
    user_id: 'user-1',
    method: 'Razorpay',
    product_id: 'product-1',
} });

test('records a verified payment, marks the order paid and decrements stock', async () => {
    razorpayMock.validateWebhookSignature.mockReturnValueOnce(true);
    paymentModelMock.create.mockResolvedValueOnce({ _id: 'payment-record' });
    orderModelMock.findOneAndUpdate.mockResolvedValueOnce({ orderId: 'order-1', status: 'paid' });
    productModelMock.findByIdAndUpdate.mockResolvedValueOnce({ _id: 'product-1', stock: 4 });
    const res = response();
    await controller.verifyPayment(request(), res);
    expect(razorpayMock.validateWebhookSignature).toHaveBeenCalledWith('order-1|payment-1', 'test-signature', process.env.RZR_PAY_SECRET_KEY);
    expect(paymentModelMock.create).toHaveBeenCalledWith({
        userId: 'user-1', method: 'Razorpay', transactionId: 'payment-1', status: 'Success',
    });
    expect(orderModelMock.findOneAndUpdate).toHaveBeenCalledWith({ orderId: 'order-1' }, { status: 'paid' });
    expect(productModelMock.findByIdAndUpdate).toHaveBeenCalledWith('product-1', { $inc: { stock: -1 } });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ status: 'ok' });
});

test('rejects an invalid signature without calling the payment, order or product models', async () => {
    razorpayMock.validateWebhookSignature.mockReturnValueOnce(false);
    const res = response();
    await controller.verifyPayment(request(), res);
    expect(razorpayMock.validateWebhookSignature).toHaveBeenCalledTimes(1);
    expect(paymentModelMock.create).not.toHaveBeenCalled();
    expect(orderModelMock.findOneAndUpdate).not.toHaveBeenCalled();
    expect(productModelMock.findByIdAndUpdate).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ status: 'verification_failed' });
});

test('returns 500 and skips the stock update if the order update fails', async () => {
    razorpayMock.validateWebhookSignature.mockReturnValueOnce(true);
    paymentModelMock.create.mockResolvedValueOnce({ _id: 'payment-record' });
    orderModelMock.findOneAndUpdate.mockRejectedValueOnce(new Error('order update failed'));
    const res = response();
    await controller.verifyPayment(request(), res);
    expect(orderModelMock.findOneAndUpdate).toHaveBeenCalledWith({ orderId: 'order-1' }, { status: 'paid' });
    expect(productModelMock.findByIdAndUpdate).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ message: 'Cannot verify payment, server error.' });
});`;
    } else return null;

    const models = [...modelMocks.entries()];
    const mockShape = methods => `{ ${methods.map(method => `${method}: ${runner}.fn()`).join(', ')} }`;
    const setup = isVitest ? `import { createRequire } from 'node:module';
import { beforeEach, expect, test, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { ${models.map(([name]) => name).join(', ')} } = vi.hoisted(() => ({
${models.map(([name, { methods }]) => `    ${name}: ${mockShape(methods)},`).join('\n')}
}));

// This controller loads CommonJS dependencies through Node's require.
${renderNativeCommonJsMockHarness(source, models.map(([binding, { module }]) => ({ binding, module })), { binding: 'controller' })}
` : `${models.map(([name, { module, methods }]) =>
        `jest.mock(${module}, () => (${mockShape(methods)}));\nconst ${name} = require(${module});`).join('\n')}
const controller = require(${source});
`;
    return {
        explanation: 'Exercise the controller with isolated CommonJS model exports and source-derived request fixtures.',
        fullUpdatedContent: `${setup}
beforeEach(() => ${runner}.clearAllMocks());
const response = () => ({ status: ${runner}.fn().mockReturnThis(), json: ${runner}.fn() });

${cases}
`,
    };
}
