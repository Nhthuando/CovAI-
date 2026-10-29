import { collectSystemGenerationContext } from './systemGenerationContext.service.js';

const label = segment => segment
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase());

export const groupScenarioRoutes = (routes = [], uiActions = []) => {
    const groups = new Map();
    for (const route of routes) {
        if (typeof route !== 'string' || !route.startsWith('/') || route.startsWith('//') || route.includes('*')) continue;
        const segment = route.split('/').filter(Boolean)[0] || 'home';
        const key = ['login', 'register', 'signup', 'signin'].includes(segment) ? 'authentication'
            : ['home', 'completed'].includes(segment) ? 'navigation' : segment;
        const name = key === 'authentication' ? 'Authentication'
            : key === 'navigation' ? 'Main Application' : label(key);
        if (!groups.has(key)) groups.set(key, { id: key, name, routes: [] });
        const group = groups.get(key);
        if (!group.routes.includes(route)) group.routes.push(route);
    }

    // For single-page applications or route-sparse apps, enrich with UI interaction features
    if (groups.size <= 1 && Array.isArray(uiActions) && uiActions.length > 0) {
        const buttons = [...new Set(uiActions.flatMap(a => a.buttons || []))];
        const inputs = [...new Set(uiActions.flatMap(a => a.inputs || []))];
        if (buttons.length > 0 || inputs.length > 0) {
            const detailParts = [];
            if (buttons.length) detailParts.push(`Actions: ${buttons.slice(0, 3).join(', ')}`);
            if (inputs.length) detailParts.push(`Inputs: ${inputs.slice(0, 2).join(', ')}`);
            groups.set('interactions', {
                id: 'interactions',
                name: 'User Interactions & Forms',
                routes: ['/'],
                customDetail: detailParts.join(' · '),
            });
        }
    }

    return [...groups.values()].map(group => ({
        id: group.id,
        name: group.name,
        routes: group.routes,
        detail: group.customDetail || group.routes.join(', ')
    })).slice(0, 12);
};

export const discoverScenarioFeatures = rootDir => {
    const context = collectSystemGenerationContext(rootDir);
    return groupScenarioRoutes(context.routes, context.uiActions);
};
