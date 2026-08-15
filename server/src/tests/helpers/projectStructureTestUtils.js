import fs from "fs";
import os from "os";
import path from "path";

export const createProjectStructureFixture = (files) => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-project-structure-"));
    for (const [relativePath, content] of Object.entries(files)) {
        const target = path.join(rootDir, relativePath);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content);
    }
    return { rootDir, cleanup: () => fs.rmSync(rootDir, { recursive: true, force: true }) };
};

export const comparableAnalysis = (analysis) => {
    const copy = JSON.parse(JSON.stringify(analysis));
    delete copy.analyzedAt;
    return copy;
};
