// Factory-local helpers preserve Jest hoisting and one mock identity per model.
export const jestMongooseMockCode = `
// Universal Mongoose In-Memory Proxy Mock
jest.mock('mongoose', () => {
  var _sampleMongooseItem = { _id: '507f1f77bcf86cd799439011', id: '1', name: 'Sample Item', category: { _id: '1', name: 'General' }, status: 'ACTIVE', email: 'sample@example.com' };
  function _createMongooseQueryMock(result) {
    var r = result !== undefined ? result : [_sampleMongooseItem];
    return {
      exec: jest.fn(() => Promise.resolve(r)),
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      lean: jest.fn(() => Promise.resolve(r)),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      distinct: jest.fn().mockReturnThis(),
      session: jest.fn().mockReturnThis(),
      equals: jest.fn().mockReturnThis(),
      then: (resolve, reject) => Promise.resolve(r).then(resolve, reject),
      catch: (reject) => Promise.resolve(r).catch(reject),
      finally: (cb) => Promise.resolve(r).finally(cb)
    };
  }
  function _createMongooseModelProxy() {
    var fn = jest.fn((doc = {}) => ({
      _id: doc._id || '507f1f77bcf86cd799439011',
      id: doc.id || '1',
      ...doc,
      save: jest.fn((cb) => {
        var savedDoc = { _id: '507f1f77bcf86cd799439011', id: '1', ...doc };
        if (typeof cb === 'function') cb(null, savedDoc);
        return Promise.resolve(savedDoc);
      }),
      validate: jest.fn((cb) => {
        if (typeof cb === 'function') cb(null);
        return Promise.resolve();
      }),
      validateSync: jest.fn(() => undefined),
      toObject: jest.fn(() => ({ _id: '507f1f77bcf86cd799439011', id: '1', ...doc })),
      toJSON: jest.fn(() => ({ _id: '507f1f77bcf86cd799439011', id: '1', ...doc })),
      isModified: jest.fn(() => false),
      set: jest.fn().mockReturnThis(),
      get: jest.fn((k) => doc[k]),
      populate: jest.fn().mockReturnThis()
    }));
    Object.assign(fn, {
      find: jest.fn(() => _createMongooseQueryMock([_sampleMongooseItem])),
      findOne: jest.fn(() => _createMongooseQueryMock(_sampleMongooseItem)),
      findById: jest.fn(() => _createMongooseQueryMock(_sampleMongooseItem)),
      findOneAndUpdate: jest.fn(() => _createMongooseQueryMock(_sampleMongooseItem)),
      findByIdAndUpdate: jest.fn(() => _createMongooseQueryMock(_sampleMongooseItem)),
      findOneAndDelete: jest.fn(() => _createMongooseQueryMock(_sampleMongooseItem)),
      findByIdAndDelete: jest.fn(() => _createMongooseQueryMock(_sampleMongooseItem)),
      exists: jest.fn(() => _createMongooseQueryMock({ _id: '507f1f77bcf86cd799439011' })),
      deleteOne: jest.fn(() => Promise.resolve({ deletedCount: 1 })),
      deleteMany: jest.fn(() => Promise.resolve({ deletedCount: 1 })),
      updateOne: jest.fn(() => Promise.resolve({ matchedCount: 1, modifiedCount: 1 })),
      updateMany: jest.fn(() => Promise.resolve({ matchedCount: 1, modifiedCount: 1 })),
      create: jest.fn((doc) => Promise.resolve({ _id: '507f1f77bcf86cd799439011', id: '1', ...(Array.isArray(doc) ? doc[0] : doc) })),
      countDocuments: jest.fn(() => Promise.resolve(1)),
      distinct: jest.fn(() => Promise.resolve(['sample'])),
      aggregate: jest.fn(() => Promise.resolve([_sampleMongooseItem])),
      insertMany: jest.fn((docs) => Promise.resolve(Array.isArray(docs) ? docs : [docs])),
      bulkWrite: jest.fn(() => Promise.resolve({ ok: 1, insertedCount: 1, modifiedCount: 0 })),
      validate: jest.fn(() => Promise.resolve()),
      schema: { path: jest.fn(() => ({ validate: jest.fn(), required: jest.fn() })), paths: {}, obj: {} }
    });
    return fn;
  }
  class _MockMongooseObjectId {
    constructor(id) {
      this.id = id || '507f1f77bcf86cd799439011';
      this._bsontype = 'ObjectID';
    }
    toString() { return String(this.id); }
    toHexString() { return String(this.id); }
    valueOf() { return String(this.id); }
    equals(other) { return String(this) === String(other); }
    static isValid(id) { return typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id); }
  }
  class _MockMongooseSchema {
    constructor(obj = {}) {
      this.obj = obj;
      this.methods = {};
      this.statics = {};
      this.paths = {};
    }
    static Types = { ObjectId: _MockMongooseObjectId };
    index() { return this; }
    pre() { return this; }
    post() { return this; }
    plugin() { return this; }
    virtual() { return { get: () => this, set: () => this }; }
    path() { return { validate: () => this, required: () => this, default: () => this }; }
    add() { return this; }
    set() { return this; }
  }
  const models = {};
  const mongoose = {
    models,
    model: jest.fn(name => {
      if (!Object.hasOwn(models, name)) Object.defineProperty(models, name, {
        value: _createMongooseModelProxy(), enumerable: true, configurable: true, writable: true
      });
      return models[name];
    }),
    Schema: _MockMongooseSchema,
    Types: { ObjectId: _MockMongooseObjectId },
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    connection: { on: jest.fn(), once: jest.fn(), readyState: 1, db: { admin: () => ({ ping: jest.fn().mockResolvedValue({ ok: 1 }) }) } },
    set: jest.fn()
  };
  return { __esModule: true, default: mongoose, ...mongoose };
}, { virtual: true });
`;
