/**
 * Builds realistic, deterministic fixture values strictly from analyzed AST
 * data-access contracts, ORM schema metadata, existing project fixtures,
 * query select/include fields, and test assertion requirements.
 *
 * Priority order:
 *  1. Actual source contract (propertyAccesses, expectedReturnType)
 *  2. ORM schema / TypeScript type (schemaHint)
 *  3. Existing project fixtures
 *  4. Query select/include/data fields (querySelectedFields)
 *  5. Input data & assertion property requirements
 *
 * Never invents arbitrary schema fields or assumes every object requires `id`.
 */

function inferScalarForField(fieldName = "", schemaType = null) {
    if (schemaType) {
        if (/^(Int|Float|Decimal|BigInt)$/i.test(schemaType)) return 1;
        if (/^Boolean$/i.test(schemaType)) return true;
        if (/^DateTime$/i.test(schemaType)) return "2025-01-01T00:00:00.000Z";
        if (/^Json$/i.test(schemaType)) return {};
    }
    const lower = String(fieldName).toLowerCase();
    if (lower === "id" || lower.endsWith("id")) return 1;
    if (lower.includes("email")) return "test@example.com";
    if (lower.startsWith("is") || lower.startsWith("has") || ["active", "enabled", "verified", "published"].includes(lower)) {
        return true;
    }
    if (/(count|price|total|amount|qty|quantity|stock|age|score|limit|offset|page)$/.test(lower)) {
        return 10;
    }
    if (/(items|tags|roles|list|entries|children)$/.test(lower)) {
        return [];
    }
    if (/(date|at|timestamp)$/.test(lower)) {
        return "2025-01-01T00:00:00.000Z";
    }
    return `sample-${fieldName || "value"}`;
}

export function buildFixtureRecord(contracts = [], options = {}) {
    const { existingFixture = null, assertionFields = [] } = options;
    const record = {};

    // Priority 1 & 2: Source contract property accesses + ORM schema
    for (const contract of contracts) {
        if (contract.schemaHint?.types) {
            for (const [field, type] of Object.entries(contract.schemaHint.types)) {
                if (!(field in record)) {
                    record[field] = inferScalarForField(field, type);
                }
            }
        }
        for (const prop of contract.propertyAccesses || []) {
            if (!prop || prop === "then" || prop === "catch") continue;
            if (!(prop in record)) {
                record[prop] = inferScalarForField(prop, null);
            }
        }
    }

    // Priority 3: Existing project fixture fields
    if (existingFixture && typeof existingFixture === "object" && !Array.isArray(existingFixture)) {
        for (const [k, v] of Object.entries(existingFixture)) {
            if (!(k in record) && v !== undefined) {
                record[k] = v;
            }
        }
    }

    // Priority 4: Query select / include / data fields
    for (const contract of contracts) {
        for (const field of contract.querySelectedFields || []) {
            if (!field) continue;
            if (!(field in record)) {
                record[field] = inferScalarForField(field, contract.schemaHint?.types?.[field] || null);
            }
        }
    }

    // Priority 5: Assertion-required fields
    for (const field of assertionFields || []) {
        if (field && !(field in record)) {
            record[field] = inferScalarForField(field, null);
        }
    }

    return record;
}

/**
 * Generates independent, realistic fixtures for find, create, update, and delete
 * operations grounded in the analyzed contracts and optional schema/assertions.
 */
export function buildOperationFixtures(contracts = [], options = {}) {
    const byKind = { find: [], create: [], update: [], delete: [], other: [] };
    for (const c of contracts) {
        const kind = byKind[c.operationKind] ? c.operationKind : "other";
        byKind[kind].push(c);
    }

    const baseAll = buildFixtureRecord(contracts, options);
    const findRec = buildFixtureRecord(byKind.find.length ? byKind.find : contracts, options);
    const createRec = buildFixtureRecord(byKind.create.length ? byKind.create : contracts, options);
    const updateRec = buildFixtureRecord(byKind.update.length ? byKind.update : contracts, options);
    const deleteRec = buildFixtureRecord(byKind.delete.length ? byKind.delete : contracts, options);

    // Ensure create/update reflect persisted records when any persisted metadata is grounded
    const hasGroundedId = ("id" in baseAll) || ("_id" in baseAll);
    if (hasGroundedId) {
        if (!("id" in createRec) && ("id" in baseAll)) createRec.id = baseAll.id;
        if (!("id" in updateRec) && ("id" in baseAll)) updateRec.id = baseAll.id;
        if (!("id" in deleteRec) && ("id" in baseAll)) deleteRec.id = baseAll.id;
    }

    return {
        find: Object.keys(findRec).length ? findRec : baseAll,
        create: Object.keys(createRec).length ? createRec : baseAll,
        update: Object.keys(updateRec).length ? updateRec : baseAll,
        delete: Object.keys(deleteRec).length ? deleteRec : baseAll,
    };
}

export function buildReturnValueFromContract(contract, fixtureRecord = null) {
    const rec = fixtureRecord || buildFixtureRecord([contract]);
    switch (contract?.expectedReturnType) {
        case "array":
            return [rec];
        case "number":
            return 1;
        case "boolean":
            return true;
        case "string":
            return "sample-value";
        case "object":
        case "object|null":
            return rec;
        default:
            if (contract?.arrayOperations?.length > 0) return [rec];
            if (contract?.propertyAccesses?.length > 0) return rec;
            if (Object.keys(rec).length > 0) return rec;
            return undefined;
    }
}

export function formatMockFn(framework = "jest", returnValueExpr = "undefined", isAsync = true) {
    const fn = framework === "vitest" ? "vi.fn" : "jest.fn";
    if (isAsync) {
        return `${fn}().mockResolvedValue(${returnValueExpr})`;
    }
    return `${fn}().mockReturnValue(${returnValueExpr})`;
}
