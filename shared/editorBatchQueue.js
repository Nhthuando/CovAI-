// A transmitted request is immutable: retries must retain its ID and bytes.
export function enqueueEditorUpdate(queue, bytes, { merge, encode, decode, makeId, maxBytes }) {
    const tail = queue.at(-1);
    if (tail && !tail.sent) {
        const combined = merge([decode(tail.bytes), bytes]);
        if (combined.byteLength <= maxBytes) { tail.bytes = encode(combined); return; }
    }
    queue.push({ requestId: makeId(), bytes: encode(bytes), sent: false });
}

export function compactRecoveredEditorQueue(pending, options) {
    const queue = [];
    pending.forEach((item, index) => {
        // Legacy queues did not store `sent`; only the head could be in flight.
        if (index === 0 || item.sent) queue.push({ ...item, sent: true });
        else enqueueEditorUpdate(queue, options.decode(item.bytes), { ...options, makeId: () => item.requestId });
    });
    return queue;
}
