export const deriveLiveRunState = ({ events = [], jobStatus, requiredRuns = 2 }) => {
  const ended = new Set(events.filter(event => event.type === 'RUN_ENDED').map(event => event.runIndex));
  const terminal = ['SUCCESS', 'COMPLETED', 'FAILED', 'CANCELED', 'CANCELLED'].includes(jobStatus);
  return { completedRuns: ended.size, activeRunIndex: Math.min(requiredRuns, Math.max(1, ...events.map(event => event.runIndex || 1))), isTerminal: terminal, canStop: !terminal };
};

export const contiguousCursor = (current, sequences) => {
  const received = new Set(sequences);
  while (received.has(current + 1)) current++;
  return current;
};
