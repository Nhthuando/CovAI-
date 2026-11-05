export const DISCIPLINE_ROLES = Object.freeze(['PM', 'DEVELOPER', 'TECH_LEAD', 'TESTER', 'AI_ENGINEER', 'QA_ENGINEER']);
export const DISCIPLINE_LABELS = Object.freeze({ PM: 'PM', DEVELOPER: 'Developer', TECH_LEAD: 'Tech Lead', TESTER: 'Tester', AI_ENGINEER: 'AI Engineer', QA_ENGINEER: 'QA Engineer' });
export const disciplineLabel = value => DISCIPLINE_LABELS[value] || 'Unassigned';
export const accessLabel = role => role === 'OWNER' ? 'Full access' : role === 'EDITOR' ? 'Edit' : 'View';
