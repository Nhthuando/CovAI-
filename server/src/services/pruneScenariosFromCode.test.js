import { pruneScenariosFromCode } from './scenarioManager.service.js';
import { extractTestRequests } from './testSourceParser.service.js';
import { extractValidatedTestRequests } from './integrationWorkspace.service.js';

describe('pruneScenariosFromCode & selective generation validation', () => {
    const sampleGeneratedCode = `import request from "supertest";
import app from "../../src/app.js";

describe("User Routes", () => {
    it("should get all users", async () => {
        const res = await request(app).get("/api/users");
        expect(res.status).toBe(200);
    });

    it("should create a user", async () => {
        const res = await request(app).post("/api/users").send({ name: "Alice" });
        expect(res.status).toBe(201);
    });

    it("should get user by id", async () => {
        const res = await request(app).get("/api/users/1");
        expect(res.status).toBe(200);
    });
});
`;

    const allRequests = [
        { testName: "should get all users", method: "GET", path: "/api/users" },
        { testName: "should create a user", method: "POST", path: "/api/users" },
        { testName: "should get user by id", method: "GET", path: "/api/users/1" }
    ];

    it('1. Prunes rejected endpoint scenarios from the generated test code AST', () => {
        // User only selected GET /api/users and POST /api/users
        // GET /api/users/1 was rejected
        const rejectedRequests = [
            allRequests[2] // should get user by id
        ];

        const cleanedCode = pruneScenariosFromCode(sampleGeneratedCode, allRequests, rejectedRequests);

        expect(cleanedCode).toContain("should get all users");
        expect(cleanedCode).toContain("should create a user");
        expect(cleanedCode).not.toContain("should get user by id");
        expect(cleanedCode).not.toContain("/api/users/1");

        // Verify with AST parser that the pruned code only extracts 2 requests
        const parsed = extractTestRequests(cleanedCode, "tests/integration/user.test.js");
        expect(parsed.length).toBe(2);
        expect(parsed.map(p => p.testName)).toEqual(["should get all users", "should create a user"]);
    });

    it('2. Removes empty describe block if all scenarios within it were pruned', () => {
        const multiDescribeCode = `import request from "supertest";
import app from "../../src/app.js";

describe("GET /api/users", () => {
    it("should get all users", async () => {
        await request(app).get("/api/users");
    });
});

describe("GET /api/users/:id", () => {
    it("should get user by id", async () => {
        await request(app).get("/api/users/1");
    });
});
`;
        const requests = [
            { testName: "should get all users", method: "GET", path: "/api/users" },
            { testName: "should get user by id", method: "GET", path: "/api/users/1" }
        ];

        const rejected = [requests[1]];
        const cleaned = pruneScenariosFromCode(multiDescribeCode, requests, rejected);

        expect(cleaned).toContain("GET /api/users");
        expect(cleaned).not.toContain("GET /api/users/:id");
        expect(cleaned).not.toContain("should get user by id");

        const parsed = extractTestRequests(cleaned, "tests/integration/user.test.js");
        expect(parsed.length).toBe(1);
        expect(parsed[0].testName).toBe("should get all users");
    });

    it('3. Handles duplicate scenario names correctly in document order', () => {
        const codeWithDuplicates = `import request from "supertest";
import app from "../../src/app.js";

describe("Users", () => {
    it("should succeed", async () => {
        await request(app).get("/api/users");
    });

    it("should succeed", async () => {
        await request(app).get("/api/unselected");
    });
});
`;
        const requests = [
            { testName: "should succeed", method: "GET", path: "/api/users" },
            { testName: "should succeed", method: "GET", path: "/api/unselected" }
        ];

        // Reject the second duplicate
        const rejected = [requests[1]];
        const cleaned = pruneScenariosFromCode(codeWithDuplicates, requests, rejected);

        expect(cleaned).toContain("/api/users");
        expect(cleaned).not.toContain("/api/unselected");

        const parsed = extractTestRequests(cleaned, "tests/integration/user.test.js");
        expect(parsed.length).toBe(1);
        expect(parsed[0].path).toBe("/api/users");
    });

    it('4. extractValidatedTestRequests filters out requests excluded from meta.requests', () => {
        const fakeAiTest = {
            id: 'test-1',
            filePath: 'tests/integration/user.test.js',
            content: sampleGeneratedCode,
            metaJson: JSON.stringify({
                framework: 'SUPERTEST',
                requests: [
                    { scenarioId: '1', testName: 'should get all users', method: 'GET', path: '/api/users' },
                    { scenarioId: '2', testName: 'should create a user', method: 'POST', path: '/api/users' }
                    // 'should get user by id' was rejected and omitted from meta.requests
                ]
            })
        };

        const validated = extractValidatedTestRequests(fakeAiTest);
        expect(validated.length).toBe(2);
        expect(validated.map(v => v.testName)).toEqual(['should get all users', 'should create a user']);
        expect(validated.some(v => v.testName === 'should get user by id')).toBe(false);
    });

    it('5. Safe fallback: returns original content on empty or invalid inputs', () => {
        expect(pruneScenariosFromCode(null, [], [])).toBe(null);
        expect(pruneScenariosFromCode("let a = 1;", [], [])).toBe("let a = 1;");
        expect(pruneScenariosFromCode("invalid js syntax {{{", [{ testName: 'foo' }], [{ testName: 'foo' }])).toBe("invalid js syntax {{{");
    });
});
