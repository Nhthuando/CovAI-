import { afterEach, expect, it } from "@jest/globals";
const original = { mode: process.env.AI_PROVIDER_MODE, e2e: process.env.COLLABORATION_E2E_ENABLED, db: process.env.DATABASE_URL };
const { generateMultimodalText } = await import("../services/gemini.service.js");
afterEach(() => {
    for (const [key, value] of Object.entries({ AI_PROVIDER_MODE: original.mode, COLLABORATION_E2E_ENABLED: original.e2e, DATABASE_URL: original.db })) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
});
it("denies fixture transport for a remote or ordinary developer database", async () => {
    process.env.AI_PROVIDER_MODE = "fixture";
    process.env.COLLABORATION_E2E_ENABLED = "true";
    for (const url of ["postgresql://u:p@example.com/main", "postgresql://u:p@127.0.0.1:5432/covai", "postgresql://u:p@127.0.0.1:55432/other"]) {
        process.env.DATABASE_URL = url;
        await expect(generateMultimodalText("test")).rejects.toMatchObject({ statusCode: 503 });
    }
});
it("returns an explicitly labeled deterministic response only for the isolated E2E profile", async () => {
    process.env.AI_PROVIDER_MODE = "fixture";
    process.env.COLLABORATION_E2E_ENABLED = "true";
    process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:55432/covai_collaboration_test";
    expect(await generateMultimodalText("test")).toContain("[LOCAL AI FIXTURE]");
    process.env.COLLABORATION_E2E_ENABLED = "false";
    await expect(generateMultimodalText("test")).rejects.toMatchObject({ statusCode: 503 });
});
