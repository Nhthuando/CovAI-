import fs from 'fs';
import path from 'path';
import { jest } from '@jest/globals';
import { discoverSourceFiles } from '../fileDiscovery.service.js';
import { ServiceError } from '../../utils/serviceError.js';

jest.mock('fs');

describe('discoverSourceFiles', () => {
  const mockRootDir = '/mock/root';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('1. should throw ServiceError (400) if rootDir is missing or invalid', () => {
    expect(() => discoverSourceFiles(null)).toThrow(ServiceError);
    expect(() => discoverSourceFiles('')).toThrow(ServiceError);
  });

  it('2. should throw ServiceError (404) if rootDir does not exist', () => {
    // Sử dụng jest.spyOn để mock các phương thức của module fs
    const existsSyncSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(false);
    expect(() => discoverSourceFiles(mockRootDir)).toThrow(ServiceError);
    existsSyncSpy.mockRestore();
  });

  it('3. should correctly filter out ignored folders and only return allowed files', () => {
    const existsSyncSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    const readdirSyncSpy = jest.spyOn(fs, 'readdirSync').mockReturnValue([
      { name: 'index.js', isDirectory: () => false, isFile: () => true },
      { name: 'node_modules', isDirectory: () => true, isFile: () => false },
      { name: 'dist', isDirectory: () => true, isFile: () => false },
      { name: 'style.css', isDirectory: () => false, isFile: () => true },
      { name: 'app.ts', isDirectory: () => false, isFile: () => true }
    ]);

    const files = discoverSourceFiles(mockRootDir);

    expect(files).toContain(path.join(mockRootDir, 'index.js'));
    expect(files).toContain(path.join(mockRootDir, 'app.ts'));
    expect(files).not.toContain(path.join(mockRootDir, 'node_modules'));
    expect(files).not.toContain(path.join(mockRootDir, 'dist'));
    expect(files).not.toContain(path.join(mockRootDir, 'style.css'));
    
    existsSyncSpy.mockRestore();
    readdirSyncSpy.mockRestore();
  });

  it('4. should handle read errors (EACCES) gracefully and continue scanning', () => {
    const existsSyncSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    const readdirSyncSpy = jest.spyOn(fs, 'readdirSync').mockImplementation((dirPath) => {
      if (dirPath === mockRootDir) {
        return [
          { name: 'allowed.js', isDirectory: () => false, isFile: () => true },
          { name: 'locked_folder', isDirectory: () => true, isFile: () => false }
        ];
      }
      
      if (dirPath.includes('locked_folder')) {
        const error = new Error('Permission denied');
        error.code = 'EACCES';
        throw error;
      }
      
      return [];
    });

    const files = discoverSourceFiles(mockRootDir);
    
    expect(files).toEqual([path.join(mockRootDir, 'allowed.js')]);
    
    existsSyncSpy.mockRestore();
    readdirSyncSpy.mockRestore();
  });
});