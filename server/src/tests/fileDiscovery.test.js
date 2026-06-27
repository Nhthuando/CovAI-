import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { discoverSourceFiles } from '../services/fileDiscovery.service.js';
import { ServiceError } from '../utils/serviceError.js';

jest.mock('fs', () => ({
    __esModule: true,
    existsSync: jest.fn(),
    readdirSync: jest.fn(),
}));

describe('discoverSourceFiles', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should throw ServiceError (400) if rootDir is missing or invalid', () => {
        expect(() => discoverSourceFiles(null)).toThrow(ServiceError);
        expect(() => discoverSourceFiles(null)).toThrow(/Root directory path is required/);
    });

    it('should throw ServiceError (404) if rootDir does not exist', () => {
        jest.spyOn(fs, 'existsSync').mockReturnValue(false);
        expect(() => discoverSourceFiles('/non/existent/path')).toThrow(ServiceError);
        expect(() => discoverSourceFiles('/non/existent/path')).toThrow(/Root directory does not exist/);
    });

    it('should correctly filter out ignored folders and return allowed files', () => {
        jest.spyOn(fs, 'existsSync').mockReturnValue(true);
        
        // Mock directory structure
        jest.spyOn(fs, 'readdirSync').mockImplementation((dir) => {
            if (dir === '/root') return [
                { name: 'src', isDirectory: () => true, isFile: () => false },
                { name: 'node_modules', isDirectory: () => true, isFile: () => false },
                { name: 'file.js', isDirectory: () => false, isFile: () => true }
            ];
            if (dir === path.join('/root', 'src')) return [
                { name: 'test.ts', isDirectory: () => false, isFile: () => true },
                { name: 'ignored.txt', isDirectory: () => false, isFile: () => true }
            ];
            return [];
        });

        const files = discoverSourceFiles('/root');
        
        expect(files).toContain(path.join('/root', 'file.js'));
        expect(files).toContain(path.join('/root', 'src', 'test.ts'));
        expect(files).not.toContain(path.join('/root', 'node_modules'));
        expect(files).not.toContain(path.join('/root', 'src', 'ignored.txt'));
    });

    it('should handle read errors (EACCES) gracefully', () => {
        jest.spyOn(fs, 'existsSync').mockReturnValue(true);
        jest.spyOn(fs, 'readdirSync').mockImplementation((dir) => {
            if (dir === '/root') return [
                { name: 'accessible.js', isDirectory: () => false, isFile: () => true },
                { name: 'inaccessible', isDirectory: () => true, isFile: () => false }
            ];
            if (dir === path.join('/root', 'inaccessible')) {
                const err = new Error('Permission denied');
                err.code = 'EACCES';
                throw err;
            }
            return [];
        });

        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        
        const files = discoverSourceFiles('/root');
        
        expect(files).toContain(path.join('/root', 'accessible.js'));
        consoleSpy.mockRestore();
    });
});
