// Keep setup inside each factory because Jest and Vitest can hoist the registration.
function mockCode(moduleName, framework, declarations) {
    const runner = framework === 'vitest' ? 'vi' : 'jest';
    const options = runner === 'jest' ? ', { virtual: true }' : '';
    return runner + ".mock('" + moduleName + "', () => {\n" +
        '  const api = {\n' + declarations(runner) + '\n  };\n' +
        '  return { __esModule: true, default: api, ...api };\n}' + options + ');\n';
}

export function buildBcryptMockCode(framework) {
    return ['bcrypt', 'bcryptjs'].map(name => mockCode(name, framework, runner => [
        "    hash: " + runner + ".fn().mockResolvedValue('$2b$10$mockHashedPassword1234567890'),",
        '    compare: ' + runner + '.fn().mockResolvedValue(true),',
        "    genSalt: " + runner + ".fn().mockResolvedValue('$2b$10$salt'),",
        "    hashSync: " + runner + ".fn().mockReturnValue('$2b$10$mockHashedPassword1234567890'),",
        '    compareSync: ' + runner + '.fn().mockReturnValue(true),',
    ].join('\n'))).join('\n');
}

export function buildJwtMockCode(framework, token = 'mock_signed_jwt_token_xyz') {
    return mockCode('jsonwebtoken', framework, runner => [
        '    verify: ' + runner + ".fn(() => ({ id: 'mock_user_1', userId: 'mock_user_1', _id: '507f1f77bcf86cd799439011',",
        "      email: 'user@example.com', role: 'user', username: 'testuser' })),",
        '    sign: ' + runner + '.fn().mockReturnValue(' + JSON.stringify(token) + '),',
        '    decode: ' + runner + ".fn(() => ({ id: 'mock_user_1', email: 'user@example.com', role: 'user' })),",
    ].join('\n'));
}
