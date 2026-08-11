import { runSupertest } from '../services/supertestRunner.service.js';
import { dockerRunner } from '../services/dockerRunner.service.js';

describe('supertestRunner.service', () => {
    test('should execute supertest via dockerRunner', async () => {
        const originalRun = dockerRunner.run;
        let command;
        // Use a simple mock object instead of jest.fn()
        dockerRunner.run = async ({ command: receivedCommand }) => {
            command = receivedCommand;
            return { success: true, exitCode: 0 };
        };

        try {
            const result = await runSupertest('job1', '/root', null);
            expect(result.exitCode).toBe(0);
            expect(command).toContain('NODE_ENV=test');
            expect(command).toContain('--runInBand');
        } finally {
            dockerRunner.run = originalRun;
        }
    });

    test('should throw error on failure', async () => {
        const originalRun = dockerRunner.run;
        dockerRunner.run = async () => ({ success: false, exitCode: 2 });

        try {
            await expect(runSupertest('job1', '/root', null)).rejects.toThrow();
        } finally {
            dockerRunner.run = originalRun;
        }
    });
});
