import {describe,it,expect} from '@jest/globals';
import {autStartupCommand} from '../utils/autStartupCommand.js';

describe('web application startup commands',()=>{
    it.each(['pnpm','yarn','bun'])('forwards %s port flags without npm-only separators',manager=>{
        expect(autStartupCommand('dev','vite',4301,{manager,command:manager})).toBe(`${manager} run dev --port 4301 --strictPort --host 127.0.0.1`);
    });
    it.each([
        ['vite --port 5173','npm run dev -- --port 4301 --strictPort --host 127.0.0.1'],
        ['next dev -p 3000','npm run dev -- --port 4301 --hostname 127.0.0.1'],
        ['nuxt dev','npm run dev -- --port 4301 --host 127.0.0.1'],
        ['astro dev','npm run dev -- --port 4301 --host 127.0.0.1'],
        ['vue-cli-service serve','npm run dev -- --port 4301 --host 127.0.0.1'],
        ['node index.js','npm run dev'],
    ])('selects compatible port flags for %s',(script,expected)=>{
        expect(autStartupCommand('dev',script,4301)).toBe(expected);
    });
});
