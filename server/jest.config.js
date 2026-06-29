export default {
    testEnvironment: 'node',
    transform: {
        '^.+\\.(js|ts)$': ['babel-jest', {
            configFile: false,
            babelrc: false,
            presets: [
                ['@babel/preset-env', { targets: { node: 'current' } }],
                '@babel/preset-typescript',
            ],
        }],
    },
    moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
    },
    transformIgnorePatterns: [
        "/node_modules/(?!(?:@prisma/client|@babel)/)",
    ],
    testPathIgnorePatterns: [
        '/node_modules/',
        '/storage/',
    ],
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
};