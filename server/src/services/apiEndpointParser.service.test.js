import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';

// Mock dependencies before importing the service
jest.unstable_mockModule('fs/promises', () => ({
  readdir: jest.fn(),
  stat: jest.fn(),
  readFile: jest.fn(),
}));

jest.unstable_mockModule('../utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }
}));

const { extractValidEndpoints } = await import('./apiEndpointParser.service.js');
const fsPromises = await import('fs/promises');

describe('API Endpoint Parser', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('1. Extracts direct route declarations (AST fallback)', async () => {
        const mockCode = `
            const express = require('express');
            const app = express();
            app.get('/api/users', (req, res) => res.send('OK'));
            app.post('/api/users/:id', (req, res) => res.send('OK'));
        `;
        
        fsPromises.readdir.mockResolvedValueOnce(['app.js']);
        fsPromises.stat.mockResolvedValue({ isDirectory: () => false });
        fsPromises.readFile.mockResolvedValueOnce(mockCode);
        
        const endpoints = await extractValidEndpoints('/project/root', '/project/root/src');
        
        expect(endpoints).toHaveLength(2);
        expect(endpoints.find(e => e.method === 'GET' && e.path === '/api/users')).toBeDefined();
        expect(endpoints.find(e => e.method === 'POST' && e.path === '/api/users/:id')).toBeDefined();
        
        // Assert provenance
        expect(endpoints[0].provenance.detectionType).toBe('AST_FALLBACK');
        expect(endpoints[0].provenance.resolutionStatus).toBe('PARTIALLY_RESOLVED');
    });

    it('2. Excludes non-server and HTTP client code', async () => {
        const mockCode = `
            const axios = require('axios');
            const request = require('supertest');
            axios.get('/external/api');
            request(app).post('/internal/test');
            // This valid route should still be extracted
            router.put('/valid/route', controller.update);
        `;
        
        fsPromises.readdir.mockResolvedValueOnce(['controller.js']);
        fsPromises.stat.mockResolvedValue({ isDirectory: () => false });
        fsPromises.readFile.mockResolvedValueOnce(mockCode);
        
        const endpoints = await extractValidEndpoints('/project/root', '/project/root/src');
        
        expect(endpoints).toHaveLength(1);
        expect(endpoints[0].method).toBe('PUT');
        expect(endpoints[0].path).toBe('/valid/route');
    });

    it('3. Deduplicates identical endpoints', async () => {
        const mockCode = `
            // Declared twice or detected via both AST and regex
            app.delete('/items/:itemId', handler);
            router.delete('/items/:itemId', handler);
        `;
        
        fsPromises.readdir.mockResolvedValueOnce(['routes.js']);
        fsPromises.stat.mockResolvedValue({ isDirectory: () => false });
        fsPromises.readFile.mockResolvedValueOnce(mockCode);
        
        const endpoints = await extractValidEndpoints('/project/root', '/project/root/src');
        
        expect(endpoints).toHaveLength(1);
        expect(endpoints[0].method).toBe('DELETE');
        expect(endpoints[0].path).toBe('/items/:itemId');
    });

    it('4. Excludes test files and excluded directories', async () => {
        fsPromises.readdir.mockResolvedValueOnce(['node_modules', 'test.spec.js', 'src']);
        fsPromises.stat.mockImplementation(async (filePath) => {
            if (filePath.includes('node_modules')) return { isDirectory: () => true };
            if (filePath.includes('test.spec.js')) return { isDirectory: () => false };
            if (filePath.includes('src')) return { isDirectory: () => true };
            return { isDirectory: () => false };
        });
        
        // src directory contents
        fsPromises.readdir.mockResolvedValueOnce(['app.js']);
        fsPromises.readFile.mockResolvedValueOnce(`app.get('/test', handler);`);

        const endpoints = await extractValidEndpoints('/project/root', '/project/root');
        
        // It shouldn't read node_modules or test.spec.js
        const readFiles = fsPromises.readFile.mock.calls.map(call => call[0]);
        expect(readFiles.some(f => f.includes('node_modules'))).toBe(false);
        expect(readFiles.some(f => f.includes('test.spec.js'))).toBe(false);
        expect(endpoints).toHaveLength(1);
    });
});
