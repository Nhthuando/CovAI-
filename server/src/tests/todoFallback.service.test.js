import {
    detectIncompleteOutput,
    explainFailure,
    createTodoPlaceholder,
    mergeGeneratedSections,
    buildFallback,
    generateFallbackResponse,
} from "../../src/services/todoFallback.service.js";

describe("TODO Fallback Generator Service", () => {

    // ---------------------------------------------------------------------
    // detectIncompleteOutput
    // ---------------------------------------------------------------------

    describe("detectIncompleteOutput", () => {

        test("should detect missing sections", () => {

            const result = detectIncompleteOutput({
                coverage: { lines: 80 },
                cfg: null,
                aiSuggestions: [],
                aiTests: undefined,
            });

            expect(result).toEqual([
                "cfg",
                "aiSuggestions",
                "aiTests",
            ]);

        });

        test("should return empty array when every section exists", () => {

            const result = detectIncompleteOutput({
                coverage: { lines: 80 },
                cfg: { nodes: [], edges: [] },
                aiSuggestions: [{ id: 1 }],
            });

            expect(result).toEqual([]);

        });

        test("should throw for invalid input", () => {

            expect(() =>
                detectIncompleteOutput(null)
            ).toThrow();

        });

    });

    // ---------------------------------------------------------------------
    // explainFailure
    // ---------------------------------------------------------------------

    describe("explainFailure", () => {

        test("should explain timeout error", () => {

            const result = explainFailure(
                "aiSuggestions",
                new Error("timeout")
            );

            expect(result.section).toBe("aiSuggestions");
            expect(result.reason).toBeDefined();

        });

        test("should explain parser error", () => {

            const result = explainFailure(
                "cfg",
                new Error("parse failed")
            );

            expect(result.section).toBe("cfg");
            expect(result.reason).toBeDefined();

        });

        test("should explain unknown error", () => {

            const result = explainFailure(
                "coverage"
            );

            expect(result.section).toBe("coverage");
            expect(result.reason).toBeDefined();

        });

    });

    // ---------------------------------------------------------------------
    // createTodoPlaceholder
    // ---------------------------------------------------------------------

    describe("createTodoPlaceholder", () => {

        test("should create todo placeholder", () => {

            const todo = createTodoPlaceholder(
                "cfg",
                "Parser error"
            );

            expect(todo.todo).toBe(true);
            expect(todo.section).toBe("cfg");
            expect(todo.reason).toBe("Parser error");
            expect(todo.message).toContain("TODO");

        });

    });

    // ---------------------------------------------------------------------
    // mergeGeneratedSections
    // ---------------------------------------------------------------------

    describe("mergeGeneratedSections", () => {

        test("should preserve generated sections", () => {

            const result = mergeGeneratedSections({

                coverage: {
                    percent: 90,
                },

                cfg: null,

                aiSuggestions: new Error("timeout"),

            });

            expect(result.generated.coverage).toBeDefined();

            expect(result.todos.cfg).toBeDefined();

            expect(result.todos.aiSuggestions).toBeDefined();

        });

        test("should return empty todos when everything exists", () => {

            const result = mergeGeneratedSections({

                coverage: {
                    ok: true,
                },

                cfg: {
                    ok: true,
                },

            });

            expect(result.todos).toEqual({});

            expect(result.generated.coverage).toBeDefined();

            expect(result.generated.cfg).toBeDefined();

        });

    });

    // ---------------------------------------------------------------------
    // buildFallback
    // ---------------------------------------------------------------------

    describe("buildFallback", () => {

        test("should build fallback response", () => {

            const result = buildFallback(

                {

                    coverage: {
                        percent: 90,
                    },

                    cfg: null,

                },

                {

                    aiTests: new Error("timeout"),

                }

            );

            expect(result.completed).toBe(false);

            expect(result.generated.coverage).toBeDefined();

            expect(result.todos.cfg).toBeDefined();

            expect(result.todos.aiTests).toBeDefined();

            expect(result.metadata.generatedCount).toBe(1);

            expect(result.metadata.missingCount).toBe(2);

        });

        test("should build completed response", () => {

            const result = buildFallback({

                coverage: {
                    ok: true,
                },

                cfg: {
                    ok: true,
                },

            });

            expect(result.completed).toBe(true);

            expect(result.metadata.generatedCount).toBe(2);

            expect(result.metadata.missingCount).toBe(0);

        });

    });

    // ---------------------------------------------------------------------
    // generateFallbackResponse
    // ---------------------------------------------------------------------

    describe("generateFallbackResponse", () => {

        test("should return completed=true when all sections exist", async () => {

            const result = await generateFallbackResponse({

                coverage: {
                    ok: true,
                },

                cfg: {
                    ok: true,
                },

                aiSuggestions: [
                    {
                        id: 1,
                    },
                ],

            });

            expect(result.completed).toBe(true);

            expect(result.todos).toEqual({});

        });

        test("should insert todos for missing sections", async () => {

            const result = await generateFallbackResponse({

                coverage: {
                    ok: true,
                },

                cfg: null,

                aiSuggestions: new Error("timeout"),

            });

            expect(result.completed).toBe(false);

            expect(result.generated.coverage).toBeDefined();

            expect(result.todos.cfg).toBeDefined();

            expect(result.todos.aiSuggestions).toBeDefined();

        });

        test("should recover from invalid input", async () => {

            const result = await generateFallbackResponse(null);

            expect(result.generated).toEqual({});

            expect(result.todos).toEqual({});

            expect(result.completed).toBe(true);

        });

        test("should recover when all sections are missing", async () => {

            const result = await generateFallbackResponse({

                coverage: null,
                cfg: null,
                aiSuggestions: null,

            });

            expect(result.completed).toBe(false);

            expect(result.generated).toEqual({});

            expect(result.todos.coverage).toBeDefined();

            expect(result.todos.cfg).toBeDefined();

            expect(result.todos.aiSuggestions).toBeDefined();

        });

    });

});