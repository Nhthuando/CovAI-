$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$inputPath = Join-Path $PSScriptRoot "..\CAPSTONE PROJECT REGISTRATION FORM.docx"
$outputPath = Join-Path $PSScriptRoot "..\CAPSTONE PROJECT REGISTRATION FORM - CovAI.docx"
Copy-Item -LiteralPath $inputPath -Destination $outputPath -Force

$nsUri = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
$zip = [System.IO.Compression.ZipFile]::Open($outputPath, [System.IO.Compression.ZipArchiveMode]::Update)
$entry = $zip.GetEntry("word/document.xml")
$reader = [System.IO.StreamReader]::new($entry.Open())
[xml]$xml = $reader.ReadToEnd()
$reader.Close()
$entry.Delete()

$nsm = [System.Xml.XmlNamespaceManager]::new($xml.NameTable)
$nsm.AddNamespace("w", $nsUri)

function Set-ParagraphText([System.Xml.XmlElement]$paragraph, [string]$text) {
    $children = @($paragraph.ChildNodes)
    foreach ($child in $children) {
        if ($child.LocalName -ne "pPr") {
            [void]$paragraph.RemoveChild($child)
        }
    }

    $run = $xml.CreateElement("w", "r", $nsUri)
    $lines = $text -split "`n", 0, "SimpleMatch"
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $textNode = $xml.CreateElement("w", "t", $nsUri)
        if ($lines[$i].StartsWith(" ") -or $lines[$i].EndsWith(" ")) {
            $space = $xml.CreateAttribute("xml", "space", "http://www.w3.org/XML/1998/namespace")
            $space.Value = "preserve"
            [void]$textNode.Attributes.Append($space)
        }
        $textNode.InnerText = $lines[$i]
        [void]$run.AppendChild($textNode)
        if ($i -lt ($lines.Count - 1)) {
            [void]$run.AppendChild($xml.CreateElement("w", "br", $nsUri))
        }
    }
    [void]$paragraph.AppendChild($run)
}

function Set-BodyParagraph([int]$index, [string]$text) {
    $paragraph = $bodyParagraphs[$index]
    Set-ParagraphText $paragraph $text
}

function Set-CellText([int]$tableIndex, [int]$rowIndex, [int]$cellIndex, [string]$text) {
    $cell = $tables[$tableIndex].SelectNodes("./w:tr", $nsm)[$rowIndex].SelectNodes("./w:tc", $nsm)[$cellIndex]
    $paragraph = $cell.SelectSingleNode("./w:p", $nsm)
    if (-not $paragraph) {
        $paragraph = $xml.CreateElement("w", "p", $nsUri)
        [void]$cell.AppendChild($paragraph)
    }
    Set-ParagraphText $paragraph $text
}

$bodyParagraphs = @($xml.SelectNodes("//w:body/w:p", $nsm))
$tables = @($xml.SelectNodes("//w:body/w:tbl", $nsm))

# 1. General information. Personal, course, and approval fields intentionally remain blank.
Set-CellText 0 1 1 "CovAI - AI-Assisted Software Quality Analysis and Test Intelligence Platform"
Set-CellText 0 2 1 "[ ] Industry-based  [x] Research-based  [x] Startup/Product  [ ] Others:"
Set-CellText 0 5 1 "[x] Student Team  [ ] Faculty  [ ] Industry Partner"

# 4. Problem statement
Set-BodyParagraph 10 "Background of the problem`nSoftware teams need timely, trustworthy evidence of code quality, but coverage data, complexity metrics, architecture knowledge, and test-design decisions are usually scattered across separate tools. New developers spend considerable time reading unfamiliar repositories and deciding where tests should be written first."
Set-BodyParagraph 11 "Current limitations / gaps`nExisting coverage tools report percentages but do not explain risky execution paths, connect them to source structure, or turn gaps into prioritized testing actions. Manual test design is slow and inconsistent; static findings and AI outputs also need developer review, traceability, and safe execution controls."
Set-BodyParagraph 12 "Target users / stakeholders`nPrimary users are JavaScript/TypeScript developers, QA engineers, technical leads, and students. Secondary stakeholders are project managers and mentors who need concise quality evidence, architecture overviews, and progress visibility."

# 5. Objectives
Set-BodyParagraph 15 "Objective 1`nDeliver a secure web platform that imports a JavaScript/TypeScript project from ZIP or GitHub, records immutable snapshots, and produces coverage, CFG, cyclomatic-complexity, and project-structure results for a selected snapshot."
Set-BodyParagraph 16 "Objective 2`nFor benchmark projects of up to 500 source files, complete a quality analysis within 60 seconds when prerequisite analysis data are available, and display a persistent quality report with coverage, performance, security, maintainability, and overall scores."
Set-BodyParagraph 17 "Objective 3`nUse bounded AI context to prioritize coverage gaps and generate reviewable Jest test skeletons or runnable candidates; validate output, preserve job status and logs, and provide actionable recommendations without blocking rule-based analysis when AI is unavailable."

# 6. Proposed solution
Set-BodyParagraph 20 "System overview`nCovAI is a React web application backed by an Express API. A user uploads a ZIP archive or imports a GitHub repository; the platform creates a snapshot and schedules isolated analysis jobs. The pipeline executes Jest coverage, parses ASTs with Babel, builds CFGs, calculates cyclomatic complexity, analyzes project structure, and stores results in PostgreSQL. Gemini receives a limited, risk-ranked context to generate suggestions and test candidates."
Set-BodyParagraph 21 "Key features`n- Authenticated project workspace with ZIP/GitHub ingestion and snapshot history. - Jest line, branch, function, and statement coverage. - CFG and cyclomatic-complexity visualization. - Project tree, dependency graph, role classification, and architecture overview. - AI test suggestions/generation with quotas, validation, fallbacks, and reviewable output. - Quality dashboard for coverage, performance, security patterns, maintainability, debug findings, and recommendations. - Asynchronous BullMQ/Redis jobs with Socket.IO notifications."
Set-BodyParagraph 22 "Expected outputs`nA deployed prototype; source code and database schema; analysis API and dashboard; stored snapshot reports, job logs, and notifications; Jest-based automated tests; benchmark evidence; SRS, SAD, test plan, final report, and demo. Requirement-to-test traceability, Jira export, and Playwright/Cypress adapters are documented as post-core extensions rather than claimed as completed functions."

# 7. Complex engineering problem justification
$complexityRows = @(
    @("Yes", "Balances conflicting concerns: deeper analysis and AI context improve insight, while execution time, cost, privacy, and safe handling of uploaded source code must remain controlled."),
    @("Yes", "No single off-the-shelf tool combines snapshot-aware coverage, CFG/CC, architecture discovery, quality scoring, and validated AI test guidance in one workflow for this target."),
    @("Yes", "Serves developers, QA engineers, technical leads, project managers, mentors, and students; each needs different levels of detail and assurance."),
    @("Yes", "Integrates React, Express, PostgreSQL/Prisma, Redis/BullMQ, Docker-based execution, Firebase storage, GitHub OAuth/API, Socket.IO, Babel AST parsing, Jest, and Gemini AI."),
    @("Yes", "Can reduce manual test-design effort and improve early detection of quality and security risks in academic and small software teams."),
    @("Yes", "Existing testing and coding standards guide practice but do not prescribe trustworthy AI-generated test validation, risk-ranked context selection, or traceability of AI recommendations."),
    @("Yes", "Combines software engineering, static program analysis, testing, cloud/platform operations, application security, human-computer interaction, and applied AI.")
)
for ($i = 0; $i -lt $complexityRows.Count; $i++) {
    Set-CellText 3 ($i + 1) 1 $complexityRows[$i][0]
    Set-CellText 3 ($i + 1) 2 $complexityRows[$i][1]
}

# 8. Constraints, impacts, and ethics
$constraintMarks = @{
    30 = "[x] Performance"; 31 = "[x] Security & Privacy"; 32 = "[x] Scalability"; 33 = "[x] Cost"; 34 = "[x] Maintainability";
    35 = "[x] Economic"; 36 = "[x] Ethical"; 37 = "[ ] Public health, safety, and welfare"; 38 = "[x] Social and Global";
    39 = "[ ] Cultural"; 40 = "[x] Sustainability"; 41 = "[x] Other: Safe execution of untrusted uploaded code"
}
foreach ($key in $constraintMarks.Keys) { Set-BodyParagraph $key $constraintMarks[$key] }
Set-BodyParagraph 43 "Explain how system addresses them:`nAnalysis is queued and cached by snapshot hash to control cost and latency. The system uses file-size/archive limits, sensitive-file filtering, authorization, JWT, rate limiting, encrypted GitHub tokens, bounded AI context and quotas, Docker-based isolation for code execution, PostgreSQL persistence, and modular route-controller-service boundaries. Rule-based results remain available if AI fails."
Set-BodyParagraph 45 "Cultural / Social impact`nMakes quality evidence easier to understand for mixed-experience teams and helps newcomers learn an unfamiliar repository through architecture and execution-flow views. It supports, rather than replaces, developer and QA judgement."
Set-BodyParagraph 46 "Environmental (Green IT)`nSnapshot hashing/reuse, bounded source collection, asynchronous jobs, and targeted risk ranking avoid unnecessary repeated analysis and reduce compute and AI-token consumption."
Set-BodyParagraph 47 "Economic impact`nReduces time spent locating untested or complex code and can lower rework cost by prioritizing quality risks before release. The prototype uses open-source components and controlled AI quotas."
Set-BodyParagraph 49 "Data privacy`nProject source code, GitHub tokens, and analysis results are sensitive. Access is restricted to project owners; tokens are encrypted; uploads are filtered; AI prompts are bounded to necessary risk-ranked code; users should obtain authorization before uploading proprietary repositories."
Set-BodyParagraph 50 "AI bias / fairness`nAI-generated findings and tests are advisory, validated for format, and presented for human review. Rule-based metrics, prompt limits, failure fallbacks, and visible diagnostics reduce over-reliance on non-deterministic outputs."
Set-BodyParagraph 51 "Intellectual property`nUsers retain ownership of uploaded source code. CovAI does not claim ownership; teams must respect repository licenses, third-party dependencies, API terms, and permissions before analysis or export."

# 9. Standards
Set-BodyParagraph 53 "[x] Code standards: ESLint and consistent ES-module/React/Node.js conventions; secure coding review practices."
Set-BodyParagraph 54 "[x] Design standards: layered route -> controller -> service architecture, separation of concerns, reusable components, and documented API/data contracts."
Set-BodyParagraph 55 "[x] IEEE standards: IEEE 830/29148-style requirements, IEEE 1016 design description, IEEE 829/29119-style test documentation, and IEEE 1012 verification/validation principles."
Set-BodyParagraph 56 "[x] ISO/IEC/IEEE 12207:2017 lifecycle-process alignment and ISO/IEC 25010 quality characteristics (functional suitability, performance efficiency, security, maintainability, reliability)."
Set-BodyParagraph 57 "[x] Other standards related to specific topics: OWASP secure-development guidance, OAuth 2.0/GitHub API practices, and Docker container-security principles."

# 10. Technical stack and methodology
Set-CellText 4 1 1 "React 19, Vite, React Router, Tailwind CSS, Framer Motion, Dagre"
Set-CellText 4 2 1 "Node.js, Express 5, REST API, Socket.IO, Zod validation"
Set-CellText 4 3 1 "PostgreSQL (Neon compatible), Prisma ORM; Firebase Storage for artifacts"
Set-CellText 4 4 1 "Docker/Docker Compose, Redis, BullMQ, snapshot hashing/cache; GitHub Actions integration planned"
Set-CellText 4 5 1 "Git/GitHub OAuth/API, Jest, Babel Parser, Gemini API, ESLint, Postman/API HTTP examples"
Set-BodyParagraph 60 "[x] Agile/Scrum"
Set-BodyParagraph 61 "[ ] V-Model"
Set-BodyParagraph 62 "[ ] Hybrid"
Set-BodyParagraph 63 "Sprint plan (high-level):`nSprints 1-2: validate scope, requirements, threat model, architecture, and UX. Sprints 3-4: ingestion, snapshots, queue, storage, and authentication. Sprints 5-6: coverage, CFG/CC, and structure/architecture analysis. Sprints 7-8: quality dashboard, AI guidance/test generation, validation, and notifications. Sprints 9-10: integration, security/performance tests, usability evaluation, documentation, demo, and final report."

# 11. Major deliverables
Set-CellText 5 1 1 "Approved proposal; scope, stakeholders, success measures, risks, and initial architecture"
Set-CellText 5 2 1 "SRS, SAD, data model, API contracts, threat model, UI prototype, and test strategy"
Set-CellText 5 3 1 "Working CovAI prototype: ingestion, asynchronous analysis, dashboards, AI assistance, automated tests, benchmark and security evidence"
Set-CellText 5 4 1 "Final report, source repository, deployment/run guide, test report, recorded/live demo, and presentation"

# 12. Risks
Set-CellText 6 1 0 "Execution of untrusted uploaded code or malicious archives"
Set-CellText 6 1 1 "High"
Set-CellText 6 1 2 "Restrict archive type/size, filter sensitive paths, validate ownership, isolate execution in Docker with resource/time limits, and avoid exposing host paths."
Set-CellText 6 2 0 "AI quota, cost, unavailable service, or inaccurate generated tests/findings"
Set-CellText 6 2 1 "Medium"
Set-CellText 6 2 2 "Use quotas and bounded prompts; parse/validate outputs; retain rule-based scoring and explicit fallbacks; require developer review before accepting generated tests."

# 13. Contributions
Set-BodyParagraph 67 "Technical contribution`nA snapshot-aware software-quality workflow that combines Jest coverage, CFG, cyclomatic complexity, project-structure/architecture analysis, persistent quality scoring, and validated AI test assistance in a single web platform."
Set-BodyParagraph 68 "Innovation / novelty`nThe project turns dispersed metrics into risk-prioritized, explainable actions: source structure and execution complexity guide AI context and test suggestions, while asynchronous jobs, caching, and fallbacks make the workflow practical rather than a one-off demonstration."
Set-BodyParagraph 69 "Practical applicability`nTeams can import a repository, identify low-coverage/high-complexity areas, understand architecture faster, review test candidates, and monitor analysis progress. The modular design supports future requirement-to-test traceability, Jira export, CI/CD triggers, and Playwright/Cypress adapters."

$newEntry = $zip.CreateEntry("word/document.xml", [System.IO.Compression.CompressionLevel]::Optimal)
$writer = [System.IO.StreamWriter]::new($newEntry.Open(), [System.Text.UTF8Encoding]::new($false))
$xml.Save($writer)
$writer.Close()
$zip.Dispose()

Write-Output "Created: $outputPath"
