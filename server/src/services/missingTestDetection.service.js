import fs from "fs";
import path from "path";
import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";
import { getAiSuggestions } from "./aiSuggestion.service.js";

const IGNORED_DIRECTORIES = new Set(["node_modules", ".git", "coverage", "dist", "build", ".next", ".vite", ".vitest", "storage", "uploads"]);

export async function detectMissingTests(projectId) {
    const project = await prisma.project.findUnique({
        where: { id: projectId },
    });

    if (!project) {
        throw new ServiceError("Project not found", 404);
    }

    const rootDir = project.rootDir;
    const pkgPath = path.join(rootDir, "package.json");

    const results = {
        availableFrameworks: [],
        availableCategories: [],
        missingCategories: ["UNIT", "INTEGRATION", "SYSTEM"],
        tests: {
            unit: { detected: false, framework: null, files: [] },
            integration: { detected: false, framework: null, files: [] },
            system: { detected: false, framework: null, files: [] }
        }
    };

    if (!fs.existsSync(pkgPath)) {
        return { success: true, data: results };
    }

    let pkg = {};
    try {
        pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    } catch (e) {
        // Invalid package.json, proceed with empty frameworks
    }
    const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies };

    if (deps["jest"]) results.availableFrameworks.push("JEST");
    if (deps["vitest"]) results.availableFrameworks.push("VITEST");
    if (deps["supertest"]) results.availableFrameworks.push("SUPERTEST");
    if (deps["@playwright/test"]) results.availableFrameworks.push("PLAYWRIGHT");

    const allFiles = getAllFiles(rootDir);

    for (const file of allFiles) {
        let content = "";
        try {
            content = fs.readFileSync(file, "utf-8");
        } catch (e) { continue; }

        const fileName = path.basename(file);
        const relativePath = path.relative(rootDir, file);

        // Priority: SYSTEM > INTEGRATION > UNIT
        if (results.availableFrameworks.includes("PLAYWRIGHT") && (content.includes("@playwright/test") || content.includes("page.goto") || content.includes("page.click") || content.includes("browser.newPage"))) {
            if (!results.tests.system.files.includes(relativePath)) {
                results.tests.system.detected = true;
                results.tests.system.files.push(relativePath);
                results.tests.system.framework = "PLAYWRIGHT";
            }
        } else if (results.availableFrameworks.includes("SUPERTEST") && (content.includes("supertest") || content.includes("request(app)"))) {
            if (!results.tests.integration.files.includes(relativePath)) {
                results.tests.integration.detected = true;
                results.tests.integration.files.push(relativePath);
                results.tests.integration.framework = "SUPERTEST";
            }
        } else if (/\.(test|spec|testcase)\.[a-z0-9]+$/i.test(fileName) || /(?:^|\/)(tests?|__tests__|specs?|unit)\//i.test(relativePath.replace(/\\/g, "/"))) {
            const normRel = relativePath.replace(/\\/g, "/");
            const isHelper = /^(setup|global-?setup|setup-?tests|teardown|helpers?|mocks?|fixtures?|config|utils?)\.[a-z0-9]+$/i.test(fileName);
            if (!isHelper && /\.[cm]?[jt]sx?$/i.test(fileName)) {
                if (!results.tests.unit.files.includes(normRel)) {
                    results.tests.unit.detected = true;
                    results.tests.unit.files.push(normRel);
                    if (content.includes("vitest") || content.includes("vi.")) {
                        results.tests.unit.framework = "VITEST";
                    } else if (content.includes("jest") || content.includes("@jest/")) {
                        results.tests.unit.framework = "JEST";
                    } else {
                        results.tests.unit.framework = results.availableFrameworks.includes("VITEST") ? "VITEST" : "JEST";
                    }
                }
            }
        }
    }

    if (results.tests.unit.detected) results.availableCategories.push("UNIT");
    if (results.tests.integration.detected) results.availableCategories.push("INTEGRATION");
    if (results.tests.system.detected) results.availableCategories.push("SYSTEM");

    results.missingCategories = ["UNIT", "INTEGRATION", "SYSTEM"].filter(cat => !results.availableCategories.includes(cat));

    let recommendation = null;
    try {
        const aiData = await getAiSuggestions({
            projectId: project.id,
            userId: project.ownerId
        });
        recommendation = aiData.suggestions;
    } catch (e) {
        recommendation = null;
    }

    return {
        success: true,
        data: { ...results, recommendation }
    };
}

function getAllFiles(dirPath, arrayOfFiles = []) {
    if (!fs.existsSync(dirPath)) return arrayOfFiles;
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
        const fullPath = path.join(dirPath, file);
        if (fs.statSync(fullPath).isDirectory()) {
            if (!IGNORED_DIRECTORIES.has(file)) {
                arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
            }
        } else {
            arrayOfFiles.push(fullPath);
        }
    }
    return arrayOfFiles;
}