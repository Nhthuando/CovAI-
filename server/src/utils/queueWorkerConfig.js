// Bound parallel host/browser jobs explicitly instead of scaling with CPU count.
// API instances may submit jobs without consuming them; workers still require
// access to the same imported workspace storage.
export const queueWorkerConfig = (env=process.env) => {
    const concurrency=Number(env.COVAI_WORKER_CONCURRENCY ?? 1);
    if(!Number.isInteger(concurrency) || concurrency<1 || concurrency>32)throw new Error('COVAI_WORKER_CONCURRENCY must be an integer from 1 to 32');
    return {enabled:env.COVAI_WORKER_ENABLED!=='false',concurrency};
};
