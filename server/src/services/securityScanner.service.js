import { generateText } from "./gemini.service.js";

// Regex phát hiện cơ bản
const SECRET_PATTERN = /(api_key|apikey|secret|password|passwd|pwd|token)\s*[:=]\s*["']([^"']{8,})["']/i;
const DANGEROUS_API_PATTERN = /(eval\(|exec\(|execSync\(|setTimeout\(\s*["'])/;

export const scanLocalVulnerabilities = (sourceFiles) => {
    const findings = [];
    sourceFiles.forEach(file => {
        const lines = file.content.split('\n');
        lines.forEach((line, idx) => {
            if (SECRET_PATTERN.test(line)) {
                findings.push({
                    type: "SECRET",
                    severity: "CRITICAL",
                    file: file.path,
                    line: idx + 1,
                    description: "Phát hiện thông tin nhạy cảm (Hardcoded secret/password)."
                });
            } else if (DANGEROUS_API_PATTERN.test(line)) {
                findings.push({
                    type: "DANGEROUS_API",
                    severity: "HIGH",
                    file: file.path,
                    line: idx + 1,
                    description: "Phát hiện sử dụng hàm nguy hiểm (eval, exec,...)."
                });
            }
        });
    });
    return findings;
};

export const scanAiVulnerabilities = async (sourceFiles) => {
    if (!sourceFiles || sourceFiles.length === 0) return [];
    
    const prompt = `You are a security expert. Scan these files for insecure patterns (e.g. SQL Injection, XSS, insecure crypto).
    Respond ONLY with a JSON array:
    [
      { "type": "INSECURE_PATTERN", "severity": "HIGH", "file": "filepath", "line": 12, "description": "Details" }
    ]
    
    Files:
    ${sourceFiles.slice(0, 10).map(f => `### ${f.path}\n\`\`\`\n${f.content.slice(0, 2000)}\n\`\`\`\n`).join('\n')}
    `;
    
    try {
        const resultText = await generateText(prompt, "Respond strictly with JSON array.");
        const match = resultText.match(/\[.*\]/s);
        if (match) return JSON.parse(match[0]);
        return [];
    } catch (e) {
        console.error("[SecurityScanner] AI Scan failed", e);
        return [];
    }
};
