import {it,expect} from '@jest/globals';
import {relocateSystemTestNavigation} from '../utils/systemTestNavigation.js';
it('adapts local application navigation and URL expectations while preserving routes and other services',()=>{
    const code="await page.goto('http://localhost:5173/todos?filter=open#list');await expect(page).toHaveURL('http://localhost:5173/todos?filter=open#list');await request.get('http://localhost:5000/api/todos');await page.goto('https://example.com/docs');";
    const result=relocateSystemTestNavigation(code,'http://127.0.0.1:4310');
    expect(result.match(/http:\/\/127.0.0.1:4310\/todos\?filter=open#list/g)).toHaveLength(2);
    expect(result).toContain("'http://localhost:5000/api/todos'");
    expect(result).toContain("'https://example.com/docs'");
    expect(code).toContain('localhost:5173');
});
it('leaves relative and dynamic navigation unchanged',()=>{
    const code="await page.goto('/todos');await page.goto(applicationUrl);";
    expect(relocateSystemTestNavigation(code,'http://127.0.0.1:4310')).toBe(code);
});
