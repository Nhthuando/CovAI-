export default {
    transform: {
        '^.+\\.js$': 'babel-jest',
    },
    testEnvironment: 'node',
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
