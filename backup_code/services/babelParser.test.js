import { parseJavaScriptCode, parseJavaScriptFile } from './babelParser.service.js';
import fs from 'fs';
import path from 'path';

// Mock fs for file testing
jest.mock('fs');

describe('Babel Parser Service', () => {

    test('should parse valid JavaScript code', () => {
        const code = 'const x = 10;';
        const result = parseJavaScriptCode(code);
        expect(result.success).toBe(true);
        expect(result.ast).toBeDefined();
    });

    test('should parse TypeScript syntax', () => {
        const code = 'const x: number = 10;';
        const result = parseJavaScriptCode(code);
        expect(result.success).toBe(true);
    });

    test('should parse JSX syntax', () => {
        const code = 'const element = <h1>Hello</h1>;';
        const result = parseJavaScriptCode(code);
        expect(result.success).toBe(true);
    });

    test('should parse ES Modules', () => {
        const code = 'import { something } from "module"; export default something;';
        const result = parseJavaScriptCode(code);
        expect(result.success).toBe(true);
    });

    test('should return error for invalid syntax', () => {
        const code = 'const x = ;'; // Syntax error
        const result = parseJavaScriptCode(code);
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.ast).toBeNull();
    });

    test('should parse valid JavaScript file', () => {
        const mockFilePath = 'test.js';
        const mockCode = 'const y = 20;';
        fs.readFileSync.mockReturnValue(mockCode);

        const result = parseJavaScriptFile(mockFilePath);
        expect(result.success).toBe(true);
        expect(result.ast).toBeDefined();
        expect(fs.readFileSync).toHaveBeenCalledWith(mockFilePath, 'utf-8');
    });

    test('should handle file read errors', () => {
        fs.readFileSync.mockImplementation(() => { throw new Error('File not found'); });
        const result = parseJavaScriptFile('nonexistent.js');
        expect(result.success).toBe(false);
        expect(result.success).toBe(true);
    });

    test('should support modern syntax', () => {
        const code = `
            const a = obj?.prop;
            const b = val ?? "default";
            const c = { ...obj };
            import("./mod.js");
            await fetch(url);
            class User { field = 1; #priv = 2; #method() {} }
            const n = 1_000;
            x ||= y;
        `;
        const result = parseJavaScriptCode(code);
        expect(result.success).toBe(true);
    });

    test('should parse a real file', () => {
        fs.writeFileSync(tempFilePath, 'const x = 10;');
        const result = parseJavaScriptFile(tempFilePath);
        expect(result.success).toBe(true);
        expect(result.ast.type).toBe('File');
    });

    test('should handle missing file', () => {
        const result = parseJavaScriptFile('non-existent.js');
        expect(result.success).toBe(false);
        expect(result.error).toContain('File does not exist');
    });

    test('should handle invalid file path', () => {
        expect(parseJavaScriptFile(null).success).toBe(false);
        expect(parseJavaScriptFile(123).success).toBe(false);
    });
});