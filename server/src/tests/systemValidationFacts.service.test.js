import { describe, it, expect } from '@jest/globals';
import { extractValidationFacts, buildTestDesignChecklist, formatTestDesignForPrompt } from '../services/systemValidationFacts.service.js';

const extract = (content, path = 'client/src/Form.tsx') => extractValidationFacts({ files: [{ path, content }] });
const fact = (rule, value, overrides = {}) => ({ field: 'password', rule, value, message: null, layer: 'client', source: 'client/Form.jsx:1', ...overrides });
const checklist = facts => buildTestDesignChecklist({ facts });

describe('extractValidationFacts', () => {
    it('extracts JSX attributes with name, id and lowercase placeholder fields', () => {
        const facts = extract(`<><input name="password" type="password" required minLength={8} maxLength="64" pattern="[a-z]+" />
            <input id="email" type="email" /><input placeholder="Age" type="number" min="18" max={99} />
            <input name="optional" required={false} /><input name="explicit" required={true} /></>`);
        expect(facts).toEqual(expect.arrayContaining([
            expect.objectContaining({ field: 'password', rule: 'required', value: null }),
            expect.objectContaining({ field: 'password', rule: 'minLength', value: 8 }),
            expect.objectContaining({ field: 'password', rule: 'maxLength', value: 64 }),
            expect.objectContaining({ field: 'password', rule: 'pattern', value: '[a-z]+' }),
            expect.objectContaining({ field: 'email', rule: 'email', value: 'email' }),
            expect.objectContaining({ field: 'age', rule: 'min', value: 18 }),
            expect.objectContaining({ field: 'age', rule: 'max', value: 99 }),
            expect.objectContaining({ field: 'age', rule: 'type', value: 'number' }),
            expect.objectContaining({ field: 'explicit', rule: 'required' }),
        ]));
        expect(facts.some(item => item.field === 'optional')).toBe(false);
    });

    it('extracts HTML attributes without attempting JavaScript parsing', () => {
        expect(extract('<form><input name="title" required minlength="3"></form>', 'index.html')).toEqual([
            expect.objectContaining({ field: 'title', rule: 'required' }),
            expect.objectContaining({ field: 'title', rule: 'minLength', value: 3 }),
        ]);
    });

    it('extracts manual length comparisons and messages from if blocks', () => {
        const facts = extract(`if (req.body.password.length < 8) { res.status(400).json({ message: 'Password too short' }); }
            if (password.length >= 8) { allow(); }
            if (value.length > 64) { throw new Error('Too long'); }
            if (other.length <= 32) { allow(); }
            const { value, other } = req.body;`, 'server/src/validators/auth.js');
        expect(facts).toEqual(expect.arrayContaining([
            expect.objectContaining({ field: 'password', rule: 'minLength', value: 8, message: 'Password too short', layer: 'server', source: 'server/src/validators/auth.js:1' }),
            expect.objectContaining({ field: 'value', rule: 'maxLength', value: 64, message: 'Too long' }),
            expect.objectContaining({ field: 'other', rule: 'maxLength', value: 32 }),
        ]));
        expect(facts.filter(item => item.field === 'password')).toHaveLength(1);
    });

    it('extracts manual required checks and nearby error messages', () => {
        const facts = extract(`if (!email) { setError('Email required'); }
            if (!form.name.trim()) { setError('Name required'); }
            if (title === '') { throw new Error('Title required'); }
            const invalid = code.length < 4;
            setError('Code too short');
            const fields = <><input name="email" /><input name="name" /><input name="title" /><input name="code" /></>;`);
        for (const [field, message] of [['email', 'Email required'], ['name', 'Name required'], ['title', 'Title required']]) {
            expect(facts).toContainEqual(expect.objectContaining({ field, rule: 'required', message }));
        }
        expect(facts).toContainEqual(expect.objectContaining({ field: 'code', rule: 'minLength', message: 'Code too short' }));
    });

    it('extracts Zod object rules, regex sources, and per-rule messages', () => {
        const facts = extract(`const schema = z.object({ password: z.string().min(8, 'At least eight').max(64),
            email: z.string().email(), name: z.string().nonempty(), code: z.string().regex(/^[A-Z]+$/, 'Uppercase only') });`);
        expect(facts).toEqual(expect.arrayContaining([
            expect.objectContaining({ field: 'password', rule: 'minLength', value: 8, message: 'At least eight' }),
            expect.objectContaining({ field: 'password', rule: 'maxLength', value: 64 }),
            expect.objectContaining({ field: 'email', rule: 'email' }),
            expect.objectContaining({ field: 'name', rule: 'required' }),
            expect.objectContaining({ field: 'code', rule: 'pattern', value: '^[A-Z]+$', message: 'Uppercase only' }),
        ]));
    });

    it('extracts Yup object rules and required messages', () => {
        const facts = extract(`const schema = yup.object({ password: yup.string().min(8).max(64).required('Enter password'), email: yup.string().email() });`);
        expect(facts.map(item => item.rule)).toEqual(['minLength', 'maxLength', 'required', 'email']);
        expect(facts[2].message).toBe('Enter password');
    });

    it('extracts Joi rules and messages keyed by rule', () => {
        const facts = extract(`const schema = Joi.object({ password: Joi.string().min(8).max(64).required().messages({ 'string.min': 'Too short', 'any.required': 'Password required' }), email: Joi.string().email() });`);
        expect(facts).toEqual(expect.arrayContaining([
            expect.objectContaining({ field: 'password', rule: 'minLength', message: 'Too short', layer: 'server' }),
            expect.objectContaining({ field: 'password', rule: 'maxLength', value: 64 }),
            expect.objectContaining({ field: 'password', rule: 'required', message: 'Password required' }),
            expect.objectContaining({ field: 'email', rule: 'email' }),
        ]));
    });

    it('extracts express-validator chains and withMessage', () => {
        const facts = extract(`body('password').isLength({ min: 8, max: 64 }).withMessage('Use 8 to 64 characters');
            body('email').isEmail(); check('name').notEmpty();`, 'api/validation.js');
        expect(facts).toEqual(expect.arrayContaining([
            expect.objectContaining({ field: 'password', rule: 'minLength', value: 8, message: 'Use 8 to 64 characters' }),
            expect.objectContaining({ field: 'password', rule: 'maxLength', value: 64, layer: 'server' }),
            expect.objectContaining({ field: 'email', rule: 'email' }),
            expect.objectContaining({ field: 'name', rule: 'required' }),
        ]));
    });

    it('classifies server paths and request/response code', () => {
        for (const path of ['server/a.js', 'api/a.js', 'backend/a.js', 'routes/a.js', 'controllers/a.js', 'validators/a.js']) {
            expect(extract('const { email } = req.body; if (!email) fail();', path)[0].layer).toBe('server');
        }
        expect(extract('if (!req.body.email) res.end();')[0].layer).toBe('server');
    });

    it('deduplicates repeated rules, preserves stable order, and caps facts', () => {
        const files = [{ path: 'client/Form.jsx', content: 'if (password.length < 8) fail(); if (password.length < 8) fail(); if (!email) fail(); const fields = <><input name="password" /><input name="email" /></>;' }];
        const facts = extractValidationFacts({ files });
        expect(facts).toHaveLength(2);
        expect(extractValidationFacts({ files })).toEqual(facts);
        expect(extractValidationFacts({ files, maxFacts: 1 })).toEqual(facts.slice(0, 1));
        expect(extractValidationFacts({ files, maxFacts: 0 })).toEqual([]);
    });

    it('skips dependencies, test files, and generated directories', () => {
        const paths = ['node_modules/a.js', 'src/a.test.js', 'src/a.spec.tsx', 'tests/a.js', '__tests__/a.js', 'dist/a.js', 'build/a.js'];
        expect(extractValidationFacts({ files: paths.map(path => ({ path, content: 'if (!email) fail();' })) })).toEqual([]);
    });

    it('falls back on malformed files and continues processing later files', () => {
        let facts;
        expect(() => {
            facts = extractValidationFacts({ files: [
                { path: 'broken.js', content: "const { password } = req.body; if (password.length < 8) { setError('Too short'); @@@" },
                { path: 'good.js', content: 'const { email } = req.body; if (!email) fail();' },
            ] });
        }).not.toThrow();
        expect(facts).toContainEqual(expect.objectContaining({ field: 'password', rule: 'minLength', value: 8, message: 'Too short' }));
        expect(facts).toContainEqual(expect.objectContaining({ field: 'email', rule: 'required' }));
    });
});

describe('validation precision regressions', () => {
    it.each([
        ['playwright.config.mjs', "const config = { reporter: !process.env.CI ? 'list' : 'dot' };"],
        ['src/components/ArticleList.js', "const ArticleList = ({ articles }) => !articles ? <div className='article-preview' /> : null;"],
        ['src/components/Header.js', "const Header = ({ currentUser }) => !currentUser ? <ul className='nav navbar-nav pull-xs-right' /> : null;"],
        ['src/middleware.js', "if (!skipTracking) track('RESULT');"],
        ['src/middleware.js', "if (!error) store('jwt');"],
        ['client/src/main.js', 'if (!ok) returnValue();'],
    ])('does not infer input validation from application state in %s', (path, content) => {
        expect(extract(content, path)).toEqual([]);
    });

    it('registers fields project-wide before scanning manual checks', () => {
        const facts = extractValidationFacts({ files: [
            { path: 'client/checks.js', content: "if (password.length < 8) setError('Password must be at least 8 characters');" },
            { path: 'client/Login.jsx', content: '<input type="password" placeholder="Password" value={password} />' },
        ] });
        expect(facts).toEqual([expect.objectContaining({ field: 'password', rule: 'minLength', value: 8, message: 'Password must be at least 8 characters', layer: 'client' })]);
    });

    it('registers request destructuring and extracts the response message', () => {
        expect(extract(`const { email } = req.body;
            if (!email) return res.status(400).json({ message: 'Email is required' });`, 'server/auth.js')).toEqual([
            expect.objectContaining({ field: 'email', rule: 'required', value: null, message: 'Email is required', layer: 'server' }),
        ]);
    });

    it.each(['> 0', '>= 1', '!== 0'])('treats trimmed length %s as required', comparison => {
        const facts = extract(`const name = req.body.name; if (name.trim().length ${comparison}) save();`, 'server/src/valid.js');
        expect(facts).toEqual([expect.objectContaining({ field: 'name', rule: 'required', value: null })]);
    });

    it('treats zero length as required only when the consequent rejects', () => {
        expect(extract("const { name } = req.body; if (name.length === 0) throw new Error('Name is required');")).toEqual([
            expect.objectContaining({ field: 'name', rule: 'required', message: 'Name is required' }),
        ]);
        expect(extract('const { name } = req.body; if (name.length === 0) render();')).toEqual([]);
    });

    it.each([
        ['< 8', 'save()', 'minLength', 8],
        ['<= 7', "setError('Password too short')", 'minLength', 8],
        ['>= 8', 'save()', 'minLength', 8],
        ['> 64', "setError('Password too long')", 'maxLength', 64],
        ['>= 65', "throw new Error('Password too long')", 'maxLength', 64],
        ['<= 64', 'save()', 'maxLength', 64],
        ['> 64', "return { error: 'Password too long' }", 'maxLength', 64],
        ['> 64', 'res.status(400).end()', 'maxLength', 64],
        ['> 64', "notify('Password is invalid')", 'maxLength', 64],
    ])('interprets length %s with consequent %s', (comparison, consequent, rule, value) => {
        expect(extract(`const { password } = req.body; if (password.length ${comparison}) { ${consequent}; }`)).toEqual([
            expect.objectContaining({ field: 'password', rule, value }),
        ]);
    });

    it('ignores positive length thresholds without a rejecting consequent', () => {
        expect(extract('const { name } = req.body; if (name.length > 3) save();')).toEqual([]);
    });

    it.each(['list', 'RESULT', 'jwt', 'article-preview', 'nav navbar-nav pull-xs-right', 'https://example.com/error message', 'src/path invalid', '.error invalid'])('rejects nonhuman message %s', message => {
        const facts = extract(`const { name } = req.body; if (!name) setError(${JSON.stringify(message)});`);
        expect(facts).toEqual([expect.objectContaining({ field: 'name', rule: 'required', message: null })]);
    });

    it.each([
        '<textarea name="Biography" />', '<select id="BIOGRAPHY" />', '<input placeholder="Biography" />',
        '<input aria-label="Biography" />', '<input value={biography} />', '<input value={this.state.biography} />',
        '<input value={form.biography} />',
    ])('registers input identity from %s', input => {
        expect(extract(`const field = ${input}; if (!biography) setError('Biography is required');`)).toEqual([
            expect.objectContaining({ field: 'biography', rule: 'required', message: 'Biography is required' }),
        ]);
    });

    it('compares spaced placeholders with camel-case identifiers', () => {
        expect(extract('const field = <input placeholder="First Name" />; if (!firstName) fail();')).toEqual([
            expect.objectContaining({ field: 'firstName', rule: 'required' }),
        ]);
    });

    it.each(["z.object({ email: z.string().email() })", "yup.object({ email: yup.string().email() })", "Joi.object({ email: Joi.string().email() })", "body('email').isEmail()", "check('email').isEmail()"])(
        'registers schema and express fields from %s', schema => {
            const facts = extract(`const schema = ${schema}; if (!email) setError('Email is required');`);
            expect(facts).toContainEqual(expect.objectContaining({ field: 'email', rule: 'required', message: 'Email is required' }));
            expect(facts).toContainEqual(expect.objectContaining({ field: 'email', rule: 'email' }));
        });

    it.each(['vite.config.ts', 'webpack.dev.js', 'babel.config.cjs', 'eslint.config.js', 'eslint-rules.js', 'jest.setup.js', 'custom.config.mjs'])(
        'skips tooling file %s including its registry candidates', path => {
            expect(extractValidationFacts({ files: [
                { path, content: 'const field = <input name="ok" required />;' },
                { path: 'src/main.js', content: 'if (!ok) fail();' },
            ] })).toEqual([]);
        });

    it('still scans middleware for registered fields', () => {
        expect(extract("if (!req.body.email) setError('Email is required');", 'src/middleware.js')).toEqual([
            expect.objectContaining({ field: 'email', rule: 'required', message: 'Email is required' }),
        ]);
    });

    it('applies the registry gate and length semantics in the parse fallback', () => {
        expect(extract("const name = req.body.name; if (name.trim().length > 0) save();\nif (!ok) fail(); @@@")).toEqual([
            expect.objectContaining({ field: 'name', rule: 'required', value: null }),
        ]);
    });
});

describe('buildTestDesignChecklist', () => {
    it('creates minLength boundaries 7, 8 and 9', () => {
        expect(checklist([fact('minLength', 8)]).map(item => [item.input.length, item.expect])).toEqual([[7, 'reject'], [8, 'accept'], [9, 'accept']]);
    });

    it('creates maxLength boundaries and suppresses the extra minLength case', () => {
        expect(checklist([fact('maxLength', 64)]).map(item => [item.input.length, item.expect])).toEqual([[64, 'accept'], [65, 'reject']]);
        expect(checklist([fact('minLength', 8), fact('maxLength', 64)])).toHaveLength(4);
    });

    it('creates email, required, numeric and pattern cases in technique order', () => {
        const facts = [fact('email', 'email'), fact('min', 18), fact('max', 99), fact('required', null), fact('pattern', '^[a-z]+$')];
        const items = checklist(facts);
        expect(items.map(item => [item.input.value, item.expect])).toEqual([
            ['', 'reject'], [17, 'reject'], [18, 'accept'], [99, 'accept'], [100, 'reject'],
            ['not-an-email', 'reject'], ['user@example.com', 'accept'], ['!!!', 'reject'],
        ]);
        expect(items.map(item => item.technique)).toEqual(['required', 'boundary', 'boundary', 'boundary', 'boundary', 'format', 'format', 'format']);
        expect(buildTestDesignChecklist({ facts, maxItems: 2 })).toHaveLength(2);
    });

    it('merges client and server rules and prefers the server message and source', () => {
        const facts = extractValidationFacts({ files: [
            { path: 'client/Form.jsx', content: "if (password.length < 8) setError('Client message');" },
            { path: 'server/auth.js', content: "if (password.length < 8) throw new Error('Server message'); const { password } = req.body;" },
        ] });
        expect(facts).toHaveLength(2);
        for (const ordered of [facts, [...facts].reverse()]) {
            const items = checklist(ordered);
            expect(items).toHaveLength(3);
            expect(items[0]).toMatchObject({ id: 'password-minLength-below', message: 'Server message', source: 'server/auth.js:1' });
        }
    });
});

describe('formatTestDesignForPrompt', () => {
    it('formats fields, source, boundaries and UI message expectations', () => {
        const facts = [fact('minLength', 8, { message: 'At least eight' })];
        const output = formatTestDesignForPrompt({ facts, checklist: checklist(facts) });
        expect(output).toContain('password: minLength 8');
        expect(output).toContain('client/Form.jsx:1');
        expect(output).toContain('[password-minLength-below] password with 7 characters -> reject');
        expect(output).toContain('expect message "At least eight" if shown in UI');
        expect(formatTestDesignForPrompt({ facts: [] })).toBe('');
    });

    it('truncates at line boundaries and reports the omitted item count', () => {
        const facts = [fact('minLength', 8)];
        const output = formatTestDesignForPrompt({ facts, maxChars: 180 });
        expect(output.length).toBeLessThanOrEqual(180);
        expect(output).toMatch(/\n- \.\.\. 3 more items omitted$/);
        expect(output).not.toContain('[password-minLength-below]');
        expect(formatTestDesignForPrompt({ facts, maxChars: 4 })).toBe('');
    });
});
