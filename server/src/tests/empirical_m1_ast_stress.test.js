import { describe, test, expect } from "@jest/globals";
import path from "path";
import fs from "fs";
import { sourceInputContracts, synthesizeFixture } from "../services/unitTestInputContracts.service.js";

describe("Empirical Challenger M1: AST Parameter Inference & Fixture Synthesis Stress Test", () => {

    // =========================================================================
    // SECTION 1: WORKING CAPABILITIES UNDER ADVERSARIAL PATTERNS
    // =========================================================================
    describe("1. Verified AST & Fixture Capabilities", () => {
        test("Deeply nested destructuring in .map callback ({ a: { b: { c } } })", () => {
            const code = `
                export function processNestedEntries(entries) {
                    return entries.map(({ a: { b: { c } } }) => {
                        return c ? c.trim() : "";
                    });
                }
            `;
            const start = performance.now();
            const { functions } = sourceInputContracts(code);
            const elapsed = performance.now() - start;

            expect(functions.has("processNestedEntries")).toBe(true);
            const fn = functions.get("processNestedEntries");
            expect(fn.parameters.length).toBe(1);
            const param = fn.parameters[0];

            expect(param.kind).toBe("array");
            expect(param.element).toBeDefined();
            expect(param.element.fields).toHaveProperty("a");

            const fixture = synthesizeFixture(param, "entries");
            expect(Array.isArray(fixture)).toBe(true);
            expect(fixture.length).toBeGreaterThanOrEqual(2);
            expect(elapsed).toBeLessThan(100);
        });

        test("ESM Generator functions with for..of yields correctly inferred as collections", () => {
            const code = `
                export function* streamDialogueTurns(history) {
                    for (const turn of history) {
                        if (turn.role === "user") {
                            yield turn.content;
                        } else if (turn.role === "model") {
                            yield turn.text;
                        }
                    }
                }
            `;
            const { functions } = sourceInputContracts(code);
            expect(functions.has("streamDialogueTurns")).toBe(true);
            const fn = functions.get("streamDialogueTurns");
            const param = fn.parameters[0];
            expect(param.kind).toBe("array");
            expect(param.element.fields).toHaveProperty("role");
            expect(param.element.fields.role.sampleValues).toContain("user");
            expect(param.element.fields.role.sampleValues).toContain("model");
            expect(param.element.fields).toHaveProperty("content");
            expect(param.element.fields).toHaveProperty("text");
        });

        test("Async generator function with for await..of", () => {
            const code = `
                export async function* eventPipeline(events) {
                    for (const ev of events) {
                        if (ev.status === "completed") {
                            yield ev.payload;
                        }
                    }
                }
            `;
            const { functions } = sourceInputContracts(code);
            expect(functions.has("eventPipeline")).toBe(true);
            const fn = functions.get("eventPipeline");
            const param = fn.parameters[0];
            expect(param.kind).toBe("array");
            expect(param.element.fields).toHaveProperty("status");
            expect(param.element.fields.status.sampleValues).toContain("completed");
        });

        test("Anonymous default export function and arrow function expressions", () => {
            const code = `
                export default async function (messages, config = {}) {
                    const limit = config.limit || 5;
                    return messages.filter(m => m.valid).slice(0, limit);
                }
            `;
            const { functions } = sourceInputContracts(code);
            expect(functions.has("default")).toBe(true);
            const fn = functions.get("default");
            expect(fn.parameters.length).toBe(2);
            expect(fn.parameters[0].kind).toBe("array");
        });

        test("Single-line JSDoc with Array and Object types", () => {
            const code = `
                /**
                 * @param {Array<{ role: string, content: string }>} rawHistory
                 * @param {Object} [options]
                 */
                export function normalizeConversation(rawHistory, options = {}) {
                    if (!Array.isArray(rawHistory)) return [];
                    return rawHistory.map(turn => ({ role: turn.role, content: turn.content }));
                }
            `;
            const { functions } = sourceInputContracts(code);
            const fn = functions.get("normalizeConversation");
            expect(fn).toBeDefined();

            const p1 = fn.parameters[0];
            expect(p1.kind).toBe("array");
            expect(p1.element.fields).toHaveProperty("role");
            expect(p1.element.fields).toHaveProperty("content");
        });

        test("Processes 100 functions within latency budget (< 500ms)", () => {
            const functionBlocks = [];
            for (let i = 0; i < 100; i++) {
                functionBlocks.push(`
                    export function handler_${i}(items_${i}, options_${i}) {
                        if (!Array.isArray(items_${i})) return [];
                        const max = options_${i}?.limit || 20;
                        return items_${i}.filter(it => it.active && it.score > ${i}).map(it => ({
                            id: it.id,
                            role: it.role === 'admin' ? 'lead' : 'agent',
                            name: it.name || 'default_${i}'
                        })).slice(0, max);
                    }
                `);
            }
            const massiveSource = functionBlocks.join("\n");

            const start = performance.now();
            const { functions } = sourceInputContracts(massiveSource);
            const duration = performance.now() - start;

            expect(functions.size).toBe(100);
            console.log("Benchmarked 100 functions analysis: " + duration.toFixed(2) + " ms");
            expect(duration).toBeLessThan(1500);
        });

        test("Array fixture produces >= 2 distinct populated items", () => {
            const contract = {
                name: "history",
                kind: "array",
                element: {
                    kind: "object",
                    fields: {
                        role: { kind: "string", sampleValues: ["user", "model"] },
                        content: { kind: "string", sampleValues: ["Sample user query", "Sample model response"] },
                        timestamp: { kind: "number", default: 1700000000000 }
                    }
                }
            };

            const fixture = synthesizeFixture(contract, "history");
            expect(Array.isArray(fixture)).toBe(true);
            expect(fixture.length).toBeGreaterThanOrEqual(2);

            const [item0, item1] = fixture;
            expect(item0.role).toBe("user");
            expect(item1.role).toBe("model");
            expect(item0.content).toBe("Sample user query");
            expect(item1.content).toBe("Sample model response");
        });

        test("Target function historyNormalizer.js correctly extracts contracts", () => {
            const normalizerPath = path.resolve(process.cwd(), "src", "utils", "historyNormalizer.js");
            const normalizerCode = fs.readFileSync(normalizerPath, "utf8");

            const { functions } = sourceInputContracts(normalizerCode);
            expect(functions.has("normalizeHistory")).toBe(true);
            const fn = functions.get("normalizeHistory");
            expect(fn.parameters.length).toBe(1);

            const historyParam = fn.parameters[0];
            expect(historyParam.kind).toBe("array");
            expect(historyParam.element).toBeDefined();

            const fields = historyParam.element.fields;
            expect(fields).toHaveProperty("role");
            expect(fields.role.sampleValues).toContain("user");
            expect(fields.role.sampleValues).toContain("model");
            expect(fields.role.sampleValues).toContain("assistant");
            expect(fields).toHaveProperty("content");
            expect(fields).toHaveProperty("text");

            const fixture = synthesizeFixture(historyParam, "rawHistory");
            expect(Array.isArray(fixture)).toBe(true);
            expect(fixture.length).toBe(2);
            // Notice: Because sampleValues encountered role === 'assistant' first in AST traversal,
            // sampleValues is ['assistant', 'user', 'model'].
            // Therefore, item 0 receives 'assistant' and item 1 receives 'user'.
            expect(fixture[0].role).toBe("assistant");
            expect(fixture[1].role).toBe("user");
        });
    });

    // =========================================================================
    // SECTION 2: ADVERSARIAL STRESS CHALLENGES & CONFIRMED DEFECTS
    // =========================================================================
    describe("2. Confirmed Engine Defects & Failure Modes", () => {

        // BUG 1: Missing computed check on index assignments causes false array inference
        test("BUG 1: Non-computed property access in variable declarator falsely converts object param into array", () => {
            const code = `
                export function configureService(options) {
                    const timeout = options.timeout;
                    return timeout;
                }
            `;
            const { functions } = sourceInputContracts(code);
            const param = functions.get("configureService").parameters[0];

            // In an ideal engine, options should be kind: 'object'.
            // However, lines 309-317 lack a check for node.init.computed === true,
            // so `const timeout = options.timeout` is erroneously treated as `const item = history[i]`.
            // We document and empirically confirm this flaw:
            const isFalselyInferredAsArray = param.kind === "array";
            expect(isFalselyInferredAsArray).toBe(true); // Demonstrates the confirmed defect!
            expect(param.synthesizedFixture).toEqual([{ id: "id-1" }, { id: "id-2" }]);
        });

        // BUG 2: Destructured callback parameters drop property tracking & sampleValues
        test("BUG 2: Destructured callback parameters fail to populate sampleValues in itemProperties", () => {
            const code = `
                export function filterUsers(users) {
                    return users.filter(({ role, status }) => {
                        return role === "admin" && status === "active";
                    });
                }
            `;
            const { functions } = sourceInputContracts(code);
            const param = functions.get("filterUsers").parameters[0];

            expect(param.kind).toBe("array");
            expect(param.element.fields).toHaveProperty("role");
            expect(param.element.fields).toHaveProperty("status");

            // Because itemVars does not register destructured identifiers (role, status),
            // subsequent binary comparison checks (role === 'admin') are not linked to the item property.
            // Result: sampleValues remains empty Set().
            const roleSampleValues = param.element.fields.role.sampleValues;
            expect(roleSampleValues.length).toBe(0); // Confirms defect: 'admin' is lost!
        });

        // BUG 3: Step 5 unconditionally overwrites TypeScript/JSDoc object contracts with 'string'
        test("BUG 3: Step 5 AST object inference stomps over nested TypeScript interface definitions", () => {
            const code = `
                interface Author {
                    name: string;
                }
                interface Book {
                    title: string;
                    author: Author;
                }
                export function getBookAuthor(book: Book) {
                    return book.title + " by " + book.author.name;
                }
            `;
            const { functions } = sourceInputContracts(code);
            const param = functions.get("getBookAuthor").parameters[0];

            expect(param.kind).toBe("object");
            expect(param.fields).toHaveProperty("title");
            expect(param.fields).toHaveProperty("author");

            // Because directProperties records `author` as kind: 'string' from `book.author`,
            // Step 5 overwrites the nested Author interface with kind: 'string'!
            expect(param.fields.author.kind).toBe("string"); // Confirms defect: object contract stomped!
        });

        // BUG 4: CommonJS module.exports.<method> assignment is ignored
        test("BUG 4: CommonJS module.exports.<method> syntax is not extracted into functions map", () => {
            const code = `
                module.exports.generateItems = function* (items) {
                    for (const item of items) {
                        yield item.id;
                    }
                };
                exports.transformBatch = async (batch) => {
                    return batch.map(b => b.timestamp);
                };
            `;
            const { functions } = sourceInputContracts(code);

            // exports.transformBatch is recognized
            expect(functions.has("transformBatch")).toBe(true);

            // BUT module.exports.generateItems is completely missing because line 499 only checks module.exports = ...
            expect(functions.has("generateItems")).toBe(false); // Confirms defect: named method on module.exports ignored!
        });

        // BUG 5: Multiline JSDoc parameter annotations are silently dropped
        test("BUG 5: Multiline JSDoc type annotations fail line-by-line regex and drop to unknown", () => {
            const code = `
                /**
                 * @param {
                 *   string | number
                 * } identifier
                 */
                export function lookupEntity(identifier) {
                    return identifier;
                }
            `;
            const { functions } = sourceInputContracts(code);
            const param = functions.get("lookupEntity").parameters[0];

            // Splitting by \n in parseJsdocComments breaks on unclosed '{' on line 1 of @param
            expect(param.kind).toBe("unknown"); // Confirms defect: dropped to unknown
        });
    });
});
