// A failed refresh cannot undo a batch already committed by the server.
export async function refreshPublishedUnitTests(tasks) {
    const results = await Promise.allSettled(tasks.map(task => Promise.resolve().then(task).then(result => {
        if (result?.isError) throw result.error || new Error('Refresh failed');
        return result;
    })));
    return results.filter(result => result.status === 'rejected').map(result => result.reason?.message || 'Refresh failed');
}
