import { EventEmitter } from 'events';

export const eventDispatcher = new EventEmitter();

// Optional: Add custom event types or constants here if needed
export const NOTIFICATION_EVENT = 'notification';
export const JOB_EVENT = 'job';