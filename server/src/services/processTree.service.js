import { spawnSync } from 'node:child_process';
import treeKill from 'tree-kill';

const activeProcesses = new Map();
const terminationHandlers = {
    SIGINT: () => handleTermination('SIGINT'),
    SIGTERM: () => handleTermination('SIGTERM'),
};

export function terminateProcessTree(child, processGroup = false) {
    if (!child?.pid) return;
    if (processGroup && process.platform !== 'win32') {
        try {
            process.kill(-child.pid, 'SIGKILL');
            return;
        } catch (error) {
            if (error.code === 'ESRCH') return;
        }
    }
    if (process.platform === 'win32') {
        const result = spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
            windowsHide: true, timeout: 10000, stdio: 'ignore',
        });
        if (result.status === 0) return;
    }
    treeKill(child.pid, 'SIGKILL', () => {
        try { child.kill('SIGKILL'); } catch { /* The process already exited. */ }
    });
}

function stopActiveProcesses() {
    for (const [child, processGroup] of activeProcesses) terminateProcessTree(child, processGroup);
}

function handleTermination(signal) {
    stopActiveProcesses();
    process.removeListener(signal, terminationHandlers[signal]);
    if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
}

// Track only processes launched by this server. Owned Linux process groups also
// let us reap workers after their CLI parent has exited or during server shutdown.
export function trackProcessTree(child, processGroup = false) {
    if (!child?.pid) return;
    if (activeProcesses.size === 0) {
        process.on('exit', stopActiveProcesses);
        process.on('SIGINT', terminationHandlers.SIGINT);
        process.on('SIGTERM', terminationHandlers.SIGTERM);
    }
    activeProcesses.set(child, processGroup);
    child.once('exit', () => {
        if (processGroup) terminateProcessTree(child, true);
    });
    child.once('close', () => {
        activeProcesses.delete(child);
        if (activeProcesses.size === 0) {
            process.removeListener('exit', stopActiveProcesses);
            process.removeListener('SIGINT', terminationHandlers.SIGINT);
            process.removeListener('SIGTERM', terminationHandlers.SIGTERM);
        }
    });
}
