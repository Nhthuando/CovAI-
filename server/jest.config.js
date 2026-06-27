export default {
    transform: {
        '^.+\\.js$': 'babel-jest',
    },
    testEnvironment: 'node',
    transform: {
        '^.+\\.(js|ts)$': ['babel-jest', { configFile: false, babelrc: false, presets: [['@babel/preset-env', { targets: { node: 'current' } }]] }],
    },
    moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
    },
    transformIgnorePatterns: [
        '/node_modules/(?!(@prisma/client)/)',
    ],
    testPathIgnorePatterns: [
        '/node_modules/',
        '/storage/',
    ],
};
