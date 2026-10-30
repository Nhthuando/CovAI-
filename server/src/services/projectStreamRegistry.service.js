const streams = new Map();

export const registerProjectStream = ({ projectId, userId, close }) => {
    const key = `${projectId}:${userId}`;
    if (!streams.has(key)) streams.set(key, new Set());
    const collection = streams.get(key);
    collection.add(close);
    return () => {
        collection.delete(close);
        if (!collection.size) streams.delete(key);
    };
};

export const closeProjectStreams = ({ projectId, userId, accessRevision }) => {
    const key = `${projectId}:${userId}`;
    const collection = streams.get(key);
    if (!collection) return;
    streams.delete(key);
    for (const close of collection) {
        try { close({ type: 'ACCESS_REVOKED', projectId, accessRevision }); }
        catch { /* A disconnected transport must not prevent other revocations. */ }
    }
};

export const registeredProjectStreamCount = ({projectId,userId}) => streams.get(`${projectId}:${userId}`)?.size || 0;
