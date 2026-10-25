# COVAI Logic Analysis Module — Implementation Analysis

## 1. Introduction

### 1.1 Objective and Purpose
This document delivers an exhaustive, source-verified technical report on the **Logic Analysis** module within the **COVAI Studio** automated test generation and quality analysis platform. Designed for academic and capstone evaluation, this analysis provides an authoritative assessment of the architectural design, user interface layout, Abstract Syntax Tree (AST) parsing infrastructure, Control Flow Graph (CFG) generation algorithms, McCabe Cyclomatic Complexity calculations, decision-path modeling, test guidance synthesis, and frontend-to-backend workflows.

The Logic Analysis module is engineered to give software engineers, QA practitioners, and engineering managers deep structural insight into the internal branching mechanics and complexity characteristics of individual JavaScript and TypeScript source files. By decomposing source files into callable functions, deriving directed control-flow graphs, computing industry-standard cyclomatic complexity indexes, and correlating CFG nodes directly with source code lines, the module enables developers to identify error-prone logic hotspots, plan basis path coverage, and determine refactoring candidates before deployment.

### 1.2 Scope of Analysis
The scope of this document encompasses:
1. **Visual Presentation and Interactive Layout:** Verification of the three-panel layout (Source Code Viewer, Function Graph/CFG Canvas, and Architecture Overview/Metrics Inspector) against actual UI screenshots and frontend component hierarchies.
2. **Static AST Analysis and Parsing Infrastructure:** Babel-based parser configurations, AST node extraction, function identification rules, and syntax support (ES2024+, JSX, TypeScript).
3. **Control Flow Graph Generation Engine:** AST-to-CFG transformation rules, node types, edge generation semantics, virtual exit node resolution, and Dagre topological layout calculations.
4. **Complexity Calculation Models:** Discrepancy analysis between backend AST-based decision point accumulation ($CC = 1 + D$) and frontend single-sink topological graph equation representation ($M = E - N + 2P$).
5. **Complexity Classification and Distribution:** Threshold analysis for Low, Moderate, High, and Critical risk tiers across file scopes.
6. **Decision-Path and Test Guidance Verification:** Deep inspection of stated "decision paths" and "recommended test cases," separating hardcoded rule heuristics from dynamic path enumeration and automated test generation pipelines.
7. **Frontend-Backend Integration Workflows:** REST API endpoints, Prisma database schemas, asynchronous BullMQ job orchestration, and Monaco editor synchronization.
8. **Implementation Audit and Defect Discovery:** Cataloging of verified bugs, structural limitations, naming collisions, and unhandled edge cases across the codebase.

### 1.3 Methodology and Verification Standards
In adherence to strict verification requirements:
- **Code-Backed Verification:** Every statement regarding architecture, data flow, algorithm mechanics, and UI behavior is cross-referenced with exact repository file paths and line numbers.
- **Visual Evidence Separation:** Screenshot-specific values (e.g., File: `src/handlers/create-quickbooks-attachable.handler.ts`, Total Functions: 15, Max McCabe CC: 29, Complexity Distribution: Low (11), Mod (3), High (1), Zoom: 40%) are documented as instance test data and strictly decoupled from general system algorithms.
- **Classification Taxonomy:** Implementation statuses are marked using four formal classifications:
  - `IMPLEMENTED`: Verified in active source code with working functional logic.
  - `PARTIALLY IMPLEMENTED`: Code exists but exhibits limitations, unhandled branches, or structural discrepancies.
  - `NOT IMPLEMENTED`: Feature or concept referenced in UI/documentation but entirely absent from active codebase.
  - `UNVERIFIED`: Behavior cannot be definitively confirmed through static code inspection.
- **Integrity Guarantee:** No application source code, database migrations, configuration files, or analysis artifacts were modified during this investigation.

---

## 2. Module Overview

### 2.1 Role in COVAI Studio
Within COVAI Studio (`client/src/components/dashboard/Layout.jsx`), the Logic Analysis module serves as the primary visual debugging and control-flow inspection workspace. Accessible via the primary Activity Bar (`client/src/components/dashboard/ActivityBar.jsx:20`) through the `GitBranch` icon (`id: "logic-analysis"`), the module is presented as a high-density, full-screen interactive overlay modal (`CFGCalculator.jsx`).

```
+---------------------------------------------------------------------------------------------------------------------------------+
| TOP BAR: [ Dropdown: src/handlers/create-quickbooks-attachable.handler.ts  v ]            [ [->] Open in Editor ] [ (X) Close ] |
+------------------------------------+---------------------------------------------------------------+----------------------------+
| LEFT PANEL: SOURCE CODE            | MIDDLE PANEL: FUNCTIONS IN FILE / CFG CANVAS                  | RIGHT PANEL: METRICS       |
| [Header: SOURCE CODE | JS/TS]      | [Header: Functions in File / CFG ]  [ [-] 40% [+] [Reset] ]   | [Header: OVERVIEW / INSP]  |
|------------------------------------+---------------------------------------------------------------+----------------------------+
| 170  });                           |                                                               | FILE ARCHITECTURE OVERVIEW |
| 171                                |                    [ sendDirectMessage() ]                    |                            |
| 172  req.write(preamble);          |                               |                               | TOTAL FUNCTIONS   MAX CC   |
| 173  if ("buffer" in file) {       |                               v                               |       15             29    |
| 174    req.write(file.buffer);     |                   [ <anonymous@L185C2> ]                      |                            |
| 175    req.write(closer);          |                               |                               | -------------------------- |
| 176    req.end();                  |                               v                               | Complexity Distribution    |
| 177  } else {                      |                   [ reIdentifyLoadError() ]                   | [==== Low ==][=Mod=][=Hi=] |
| 178    // Stream file part         |                               |                               | Low (11)   Mod (3) High (1)|
| 179    // The read is bounded      |                               v                               | -------------------------- |
| 180    const readStream = ...      |                  [ uploadAttachableFile() ]                   | CALL GRAPH NAVIGATION      |
| 181    req.on("error", () => ...)  |                               :                               | Select function to inspect |
| 182  }                             |                               v                               | internal CFG, complexity,  |
|                                    |                  [ <anonymous@L391C2> ]                       | paths & recommendations.   |
|                                    +---------------------------------------------------------------+                            |
|                                    | Pill: [*] Click a function node to analyze its CFG • Drag pan |                            |
+------------------------------------+---------------------------------------------------------------+----------------------------+
```

The module can also be summoned contextually from other subsystems:
1. **Coverage Dashboard:** Clicking any function or line in the Coverage View triggers `handleOpenCFG(filePath, line, funcName)` in `Layout.jsx:169-182`, deep-linking the modal directly to that specific function's CFG and highlighting its starting line.
2. **Quality Audit Reports:** Navigating from high-complexity alerts in the Quality Dashboard directly mounts `CFGCalculator.jsx` with the target file and function preloaded.

### 2.2 Core Capabilities
1. **Dual-Mode Graph Visualization:**
   - **Call Graph / File Functions View:** Visualizes all callable functions, methods, and callbacks discovered within the active file in an ordered sequence.
   - **Intra-procedural CFG View:** Upon selecting a specific function node, renders its internal Control Flow Graph composed of entry, exit, conditional branch, and sequential statement blocks.
2. **Synchronized Multi-Pane Code Navigation:**
   - Selecting a node in the CFG canvas automatically scrolls the left-hand Source Code Viewer to the exact line of code, activating an indicator cursor (`▶`) and line highlighting.
   - Clicking a line number in the source viewer highlights the corresponding CFG node in the canvas.
3. **Automated McCabe Cyclomatic Complexity Analysis:**
   - Computes cyclomatic complexity per function using AST branch-point accumulation.
   - Calculates file-level maximum complexity (`Max McCabe CC`) and partitions file functions into a risk distribution bar (Low, Moderate, High).
4. **Topological Graph Equation Visualization:**
   - Synthesizes an interactive single-sink graph model utilizing a synthetic `Virtual Exit` node to demonstrate McCabe's standard topological theorem: $M = E - N + 2P$.
5. **Seamless IDE Editor Handoff:**
   - Provides an `Open in Editor` button that dismisses the analysis modal, navigates to the IDE's Monaco-based code editor, loads the source file, and positions the cursor on the selected function's line.

---

## 3. Logic Analysis UI

### 3.1 Layout Architecture and Responsive State
The user interface of the Logic Analysis module is implemented in `client/src/components/dashboard/CFGCalculator.jsx` (2,006 lines of code). The modal mounts as a fixed full-screen overlay (`fixed inset-0 z-50 flex flex-col`) with a three-column horizontal partition on desktop environments and a collapsible vertical column stack on mobile displays (`useBreakpoints()`, `CFGCalculator.jsx:491`).

The desktop layout features two draggable split-resizers (`CFGCalculator.jsx:511-547`):
- `leftWidth`: State variable controlling the Source Code panel width (default: 420px, constrained between 200px and 800px via `isResizingLeft`).
- `rightWidth`: State variable controlling the Metrics / Architecture Overview panel width (default: 400px, constrained between 200px and 800px via `isResizingRight`).
- `flex: 1` Middle Container: The central graph canvas automatically expands to occupy all remaining viewport space (guaranteed minimum width: 550px).

### 3.2 Visual Component Hierarchy
```
CFGCalculator (Modal Root: motion.div)
│
├── Top Bar Navigation Header (h-14, flex items-center justify-between)
│   ├── Source File Selector (<select> dropdown binding selectedFile)
│   ├── Active Sub-path / Function Breadcrumb (selectedFunc)
│   └── Top Action Group
│       ├── "Open in Editor" Action Button (ExternalLink icon)
│       └── Close Modal Action Button (X icon)
│
├── Workspace Content Body (flex-1 flex overflow-hidden)
│   │
│   ├── Left Column: Source Code Panel (resizable width)
│   │   ├── Panel Header ("SOURCE CODE" label + "JS/TS" badge + Line tag)
│   │   └── Scrollable Code Viewer (codeContainerRef, 1-indexed lines)
│   │       └── Line Row (indicator ▶, line number, syntax-highlighted tokens)
│   │
│   ├── Left/Center Resizer Handle (cursor: col-resize)
│   │
│   ├── Middle Column: Graph Canvas Area (flex-1 min-w-[550px])
│   │   ├── Canvas Toolbar (Back button, View Title, Zoom -, %, +, Reset)
│   │   ├── Interactive Viewport (canvasRef, pan/zoom transform layer)
│   │   │   ├── SVG Vector Layer (defs arrowhead marker, cubic paths)
│   │   │   └── Node HTML Layer
│   │   │       ├── FuncNode Elements (Call Graph mode)
│   │   │       └── CFGNode Elements (CFG mode: Diamond, Rounded, Pill)
│   │   └── Floating Instruction Pill (Sparkles icon + context hint)
│   │
│   ├── Center/Right Resizer Handle (cursor: col-resize)
│   │
│   └── Right Column: Metrics & Inspector Panel (resizable width)
│       ├── Mode A: Call Graph (isCallGraph === true)
│       │   ├── Section Header ("FILE ARCHITECTURE OVERVIEW")
│       │   ├── Metric Cards Grid ("TOTAL FUNCTIONS", "MAX MCCABE CC")
│       │   ├── Complexity Distribution Card (Segmented progress bar + counts)
│       │   └── Call Graph Navigation Guidance Card (Info icon)
│       │
│       └── Mode B: CFG Inspection (isCallGraph === false)
│           ├── Section Header ("Complexity Analysis" + function badge)
│           ├── Node Inspector Card (Type, In/Out degree, Line preview)
│           ├── Radial McCabe Gauge (SVG circle meter + risk badge + 4-tier bar)
│           ├── Graph Formula Card (M = E - N + 2P equation breakdown)
│           └── QA & Testing Guidance Card (Basis paths, decision count, rules)
```

---

## 4. Source Code Selection and Display

### 4.1 File Discovery and Selection Mechanism
The list of available source files presented in the top-left dropdown selector is derived dynamically from precomputed CFG database records:
```javascript
// CFGCalculator.jsx:674-676
const uniqueFiles = useMemo(() => {
  return [...new Set(cfgs.map((c) => c.filePath))];
}, [cfgs]);
```
When the user selects a file from the `<select>` element (`CFGCalculator.jsx:930-947`):
1. `setSelectedFile(e.target.value)` updates the active file.
2. `setSelectedFunc(null)` resets the active function, reverting the graph view to the file-level Call Graph overview.
3. `setSelectedNodeId(null)` and `setHighlightedLine(null)` clear any active node inspection.

If the modal is invoked with an external file target (`initialFile`), the system executes a resilient 5-tier fuzzy matching algorithm implemented in `findMatchingCfgFile` (`CFGCalculator.jsx:356-403`):
1. **Exact Path Match:** Compares normalized POSIX paths.
2. **Suffix Match (`endsWith`):** Handles workspace prefix divergences.
3. **Monorepo Stripping:** Removes common directory prefixes (`backend/`, `server/`, `client/`, `api/`, `app/`, `frontend/`).
4. **Basename Match:** Compares trailing file basenames (e.g., `create-quickbooks-attachable.handler.ts`).
5. **Truncated Prefix Match:** Accommodates UI paths truncated with ellipses (`...`).

If the requested file has no pre-existing CFG records, an automatic rebuild trigger (`CFGCalculator.jsx:591-615`) invokes `buildCfgApi(project.id, "")` once to generate missing artifacts on the fly.

### 4.2 Source Code Fetching and Snapshot Isolation
Source code is loaded asynchronously through `getFileContentApi(project.id, selectedFile)` (`client/src/services/project.service.js:14-16`), which issues an authenticated request to `GET /api/projects/:id/file-content?path=...`.

On the backend (`server/src/controllers/project.controller.js:383-421`):
```javascript
// Verification: project.controller.js:388-415
const relativePath = req.query.path;
const safePath = path.normalize(relativePath).replace(/^(\.\.[\/\\])+/, '');
const fullPath = path.join(project.rootDir || project.storageBasePath, safePath);
const content = fs.readFileSync(fullPath, 'utf8');
return res.status(200).json({ success: true, data: { content } });
```
> [!IMPORTANT]
> **Data Flow Finding:** The source code displayed in the viewer is read directly from the physical project directory on disk (`project.rootDir || project.storageBasePath`), whereas the CFG structures and Cyclomatic records are read from the PostgreSQL database (`prisma.cfg` and `prisma.cyclomatic`) tied to a specific `snapshotId`. If the local codebase is edited after a snapshot is captured, line numbers in the stored CFG may diverge from physical disk lines until `buildCfgApi` is re-executed.

### 4.3 Syntax Highlighting and Tokenization
Rather than embedding a heavy dependency such as PrismJS or Monaco in the left pane, `CFGCalculator.jsx` implements a custom lightweight regex tokenizer `syntaxHighlight(text)` (`CFGCalculator.jsx:40-74`):
- **Keywords:** Matches `\b(function|if|else|return|const|let|var)\b` $\rightarrow$ colored with `var(--color-primary)` in font semibold.
- **Strings:** Matches `"[^"]*"` and `'[^']*'` $\rightarrow$ colored with `var(--color-success)`.
- **Numeric Literals:** Matches `\b\d+\b` $\rightarrow$ colored with `var(--color-warning)`.
- **Default Identifiers & Delimiters:** Colored with `var(--color-text)`.

```javascript
// CFGCalculator.jsx:40-45
function syntaxHighlight(text) {
  return text
    .split(/(\bfunction\b|\bif\b|\belse\b|\breturn\b|\bconst\b|\blet\b|\bvar\b|"[^"]*"|'[^']*'|\b\d+\b)/g)
    .map((part, i) => { ... });
}
```
*Limitation:* The regex parser does not support ES6 template literals (`` `...` ``), multiline comments (`/* ... */`), single-line comments (`// ...`), JSX tags, or TypeScript type annotations. In the screenshot, comments around lines 178–180 are rendered as standard plain text rather than muted comment tokens.

### 4.4 Line Numbering and Bidirectional Code Synchronization
Source text is split by newline characters (`\n`) into a structured array of line objects:
```javascript
// CFGCalculator.jsx:702-704
const sourceLines = useMemo(() => {
  return sourceCode.split("\n").map((text, i) => ({ num: i + 1, text }));
}, [sourceCode]);
```
Each line element is assigned a unique DOM ID: `cfg-source-line-${line.num}` (`CFGCalculator.jsx:1110`). The viewer supports full bidirectional synchronization:
1. **Node-to-Code Sync:** Clicking a node in the CFG canvas invokes `handleNodeClick(node)` (`CFGCalculator.jsx:847-864`), which resolves `targetLine = node.line` and calls:
   ```javascript
   document.getElementById(`cfg-source-line-${targetLine}`)
     ?.scrollIntoView({ behavior: "smooth", block: "center" });
   ```
   The line is visually highlighted with a solid primary left border (`border-l-[4px] border-l-[var(--color-primary)]`), background tint (`bg-[var(--color-primary)]/20`), and an animated indicator arrow (`▶`).
2. **Code-to-Node Sync:** Clicking any line in the code pane (`CFGCalculator.jsx:1111-1119`) searches the active graph for a node possessing `n.line === line.num`. If found, `selectedNodeId` is updated, highlighting the CFG node on the canvas.
3. **Scope Dimming:** When an individual function is selected, lines outside the function's boundary (`line.num < activeCfg.startLine || line.num > activeCfg.endLine`) have their opacity reduced to 35% (`opacity-35`, `CFGCalculator.jsx:1104-1126`), isolating the active routine visually.

---

## 5. Function Extraction

### 5.1 AST Parsing and Parser Configuration
Function discovery and structural extraction are performed by the backend service `cyclomaticFunctionExtractor.service.js` using `@babel/parser` (`server/src/services/cyclomaticFunctionExtractor.service.js:1-82`).

The parser is configured with broad modern ECMAScript and TypeScript syntax options:
```javascript
// cyclomaticFunctionExtractor.service.js:18-29
const ast = parseFn(code, {
    sourceType: 'unambiguous',
    errorRecovery: true,
    plugins: [
        'typescript',
        'jsx',
        'classProperties',
        'classPrivateProperties',
        'classPrivateMethods',
        'exportDefaultFrom'
    ]
});
```
With `errorRecovery: true`, Babel continues parsing even if the file contains non-fatal syntax errors, ensuring partial function extraction rather than catastrophic failure.

### 5.2 Supported Callable Constructs
The AST traversal inspects nodes matching 6 distinct Babel types:
1. `FunctionDeclaration`: Standard hoisted function definitions (`function foo() {}`).
2. `FunctionExpression`: Named or anonymous functions assigned to expressions (`const f = function() {}`).
3. `ArrowFunctionExpression`: ES6 fat arrow closures (`const f = () => {}`).
4. `ClassMethod`: Standard class member methods (`class A { foo() {} }`).
5. `ClassPrivateMethod`: Private class methods with hash prefixes (`class A { #foo() {} }`).
6. `ObjectMethod`: Methods declared inside object literals (`const obj = { foo() {} }`).

### 5.3 Function Name Resolution Strategy
Because real-world codebases frequently employ anonymous lambdas, callbacks, and assigned arrow functions, the extractor executes a multi-tiered name resolution routine (`cyclomaticFunctionExtractor.service.js:44-65`):

```javascript
let functionName = 'anonymous';

if (node.id && node.id.name) {
    functionName = node.id.name;
} else if (node.key && node.key.name) {
    functionName = node.key.name;
} else if (parent && parent.type === 'VariableDeclarator' && parent.id && parent.id.name) {
    functionName = parent.id.name;
} else if (parent && parent.type === 'AssignmentExpression') {
    if (parent.left && parent.left.property && parent.left.property.name) {
        functionName = parent.left.property.name;
    } else if (parent.left && parent.left.name) {
        functionName = parent.left.name;
    }
} else if (parent && (parent.type === 'ObjectProperty' || parent.type === 'Property') && parent.key && parent.key.name) {
    functionName = parent.key.name;
}

// Fallback for unnamed functions / callbacks:
if (functionName === 'anonymous' && node.loc && node.loc.start) {
    functionName = `<anonymous@L${node.loc.start.line}C${node.loc.start.column}>`;
}
```

> [!NOTE]
> **Screenshot Verification Fact:** In the provided screenshot, the function list displays entries such as `<anonymous@L185C2>`, `<anonymous@L261C24>`, and `<anonymous@L265C2>`. This exact notation is directly verified by line 63 of `cyclomaticFunctionExtractor.service.js`, proving that the system derives synthetic coordinate names for anonymous callbacks (such as stream event handlers `req.on("error", () => ...)` on line 185).

### 5.4 Function Extraction Inventory
| Function Type | Detection Method | Name Resolution | Source Location | Status |
|---|---|---|---|---|
| **FunctionDeclaration** | AST `node.type === 'FunctionDeclaration'` | Direct `node.id.name` | `node.loc.start.line` to `end.line` | `IMPLEMENTED` |
| **FunctionExpression** | AST `node.type === 'FunctionExpression'` | Parent `VariableDeclarator` / `Assignment` / Fallback `<anonymous@L...>` | `node.loc.start.line` to `end.line` | `IMPLEMENTED` |
| **ArrowFunctionExpression** | AST `node.type === 'ArrowFunctionExpression'` | Variable identifier or `<anonymous@L...>` | `node.loc.start.line` to `end.line` | `IMPLEMENTED` |
| **ClassMethod** | AST `node.type === 'ClassMethod'` | Method key identifier `node.key.name` | `node.loc.start.line` to `end.line` | `IMPLEMENTED` |
| **ClassPrivateMethod** | AST `node.type === 'ClassPrivateMethod'` | Private identifier `node.key.name` | `node.loc.start.line` to `end.line` | `IMPLEMENTED` |
| **ObjectMethod** | AST `node.type === 'ObjectMethod'` | Object property key `node.key.name` | `node.loc.start.line` to `end.line` | `IMPLEMENTED` |
| **Async Function** | Any above with `node.async === true` | Resolved via parent construct | Accurate | `IMPLEMENTED` |
| **Generator Function** | Any above with `node.generator === true` | Resolved via parent construct | Accurate | `IMPLEMENTED` |
| **Nested Function** | Traversed recursively during AST traversal | Resolved independently as separate node | Stored with independent line spans | `IMPLEMENTED` |
| **Duplicate Function Name** | Disambiguated in `buildCfg.service.js:48` | Appends `@L${startLine}` if duplicate in file | Distinct database records | `IMPLEMENTED` |

---

## 6. Function Graph and Call Relationships

### 6.1 "Functions in File" Canvas Representation
When no function is actively selected (`selectedFunc === null`), the middle panel renders the file's callable inventory under the title `FUNCTIONS IN FILE`.

Each function is rendered on the canvas using the `FuncNode` component (`CFGCalculator.jsx:194-228`):
- Displays a `Network` icon (`lucide-react`).
- Formats the function title with an appended invocation indicator: `{label}()`.
- Positioned absolutely at `(x, y)` computed by Dagre.
- Includes a hover scale micro-animation (`whileHover={{ scale: 1.05 }}`) and click listener `onClick={() => setSelectedFunc(n.id)}`.

### 6.2 Structural Call Graph Verification vs. Synthetic Chain
> [!WARNING]
> **Critical Architectural Finding:** While the right-hand panel refers to this view as the `CALL GRAPH NAVIGATION` card, the underlying implementation in `CFGCalculator.jsx` does **not** construct a true inter-procedural static or dynamic call graph.
>
> In `CFGCalculator.jsx:725-735`:
> ```javascript
> if (isCallGraph) {
>   // Just layout the functions side by side or vertically
>   const nodes = fileCfgs.map((c, i) => ({
>     id: c.functionName,
>     label: c.functionName,
>   }));
>   const edges = [];
>   // Create a dummy chain so dagre lays them out nicely vertically
>   for (let i = 0; i < nodes.length - 1; i++)
>     edges.push({ from: nodes[i].id, to: nodes[i + 1].id });
>   return computeLayout(nodes, edges);
> }
> ```
> As proven by line 734, the frontend creates a **synthetic sequential chain** connecting each function to the next function in array order (`nodes[i] -> nodes[i+1]`). It does **not** trace whether `sendDirectMessage()` actually calls `<anonymous@L185C2>` or `reIdentifyLoadError()`. The edges exist solely to force the Dagre layout engine to organize the function nodes into a clean vertical stack. Furthermore, in Call Graph mode, the SVG edge layer is suppressed, displaying only the vertical column of `FuncNode` cards shown in the screenshot.

### 6.3 Graph Specification
| Graph Element | Actual Meaning | Data Source | Interaction | Status |
|---|---|---|---|---|
| **FuncNode Card** | A callable function, method, or callback | `cfgs` filtered by `selectedFile` | Click selects function and loads CFG | `IMPLEMENTED` |
| **Node Label** | Name of routine or `<anonymous@L...>` | `cfg.functionName` | Rendered with `()` suffix | `IMPLEMENTED` |
| **Inter-node Edges** | Synthetic vertical alignment chain | Array index order (`i -> i+1`) | Non-rendered layout guides | `PARTIALLY IMPLEMENTED` (Synthetic) |
| **Zoom Controls** | Canvas scale modifier (0.2x to 3.0x) | Local `zoom` state ($\pm 15\%$) | Click `-`, `+`, or mouse wheel scroll | `IMPLEMENTED` |
| **Zoom Percentage** | Integer display of active zoom | `Math.round(zoom * 100)%` | Display only (e.g., `40%`) | `IMPLEMENTED` |
| **Reset Control** | Restores scale to 1.0 and pan to (0, 0) | `setZoom(1); setPan({x:0, y:0})` | Click button | `IMPLEMENTED` |
| **Canvas Drag/Pan** | 2D translation of canvas viewport | `isDragging` mouse listeners | Click and drag canvas background | `IMPLEMENTED` |
| **Instruction Pill** | Floating interaction hint | Dynamic condition on `isCallGraph` | Static informational banner | `IMPLEMENTED` |

---

## 7. Control Flow Graph Analysis

### 7.1 AST-to-CFG Construction Engine
When a function node is clicked, `selectedFunc` is populated, switching the canvas from Call Graph mode to the function's internal **Control Flow Graph (CFG)**.

The CFG is constructed by `server/src/services/cfgBuilder.service.js:11-164` through recursive traversal of the function's AST body (`buildCFG(astNode)`). The engine generates two primary collections:
1. `nodes`: Array of `{ id: string, type: string, line: number | null }`.
2. `edges`: Array of `{ from: string, to: string, label: string | null }`.

### 7.2 Language Construct Support and Graph Modeling
The builder traverses AST constructs through a recursive `traverse(node, parentId)` dispatcher:

1. **Function Root / Entry:**
   - Matches: `FunctionDeclaration`, `FunctionExpression`, `ArrowFunctionExpression`.
   - Action: Pushes root node `{ id: "start", type: "start", line }`. Traverses body with `parentId = "start"`.
2. **Sequential Statements:**
   - Matches: `ExpressionStatement`, `VariableDeclaration`, `AwaitExpression`.
   - Action: Pushes `{ id: "stmt_${++nodeCounter}", type: "statement", line }`. Creates directed edge `parentId -> stmtId`. Sets `currentId = stmtId`.
3. **Conditionals (`if` / `else`):**
   - Matches: `IfStatement`.
   - Action: Pushes `{ id: "if_${++nodeCounter}", type: "condition", line }`. Creates edge `parentId -> ifId`.
   - Recursively traverses `node.consequent` with `parentId = ifId`.
   - Recursively traverses `node.alternate` (if present) with `parentId = ifId`.
4. **Loops:**
   - Matches: `ForStatement`, `ForInStatement`, `ForOfStatement`, `WhileStatement`, `DoWhileStatement`.
   - Action: Pushes `{ id: "loop_${++nodeCounter}", type: "condition", line }`. Creates edge `parentId -> loopId`.
   - Traverses loop body with `parentId = loopId`.
   - Appends a cycle back-edge: `edges.push(createEdge(loopId, loopId, "next"))`.
5. **Switch Statements:**
   - Matches: `SwitchStatement`.
   - Action: Pushes `{ id: "switch_${++nodeCounter}", type: "condition", line }`. Creates edge `parentId -> switchId`.
   - Iterates `node.cases`, creating for each case: `{ id: "case_${++nodeCounter}", type: "condition", line }`, with edge `switchId -> caseId`, then traverses case statements.
6. **Exception Handling (`try` / `catch` / `finally`):**
   - Matches: `TryStatement`.
   - Action: Pushes `{ id: "try_${++nodeCounter}", type: "statement", line }`. Traverses try block.
   - For catch handler: Pushes `{ id: "catch_${++nodeCounter}", type: "condition", line }`, creates labeled edge `createEdge(tryId, catchId, "error")`.
   - For finalizer: Pushes `{ id: "finally_${++nodeCounter}", type: "statement", line }`.
7. **Return Statements:**
   - Matches: `ReturnStatement`.
   - Action: Pushes `{ id: "return_${++nodeCounter}", type: "return", line }`. Creates edge `parentId -> retId`.

### 7.3 Frontend Virtual Exit Resolution
In raw AST traversal, multiple `return` statements or terminal branches terminate as disjoint leaf nodes with an out-degree of 0. To satisfy standard graph-theoretic cyclomatic complexity equations requiring a single sink, the frontend dynamically post-processes the graph before computing the Dagre layout (`CFGCalculator.jsx:745-764`):

```javascript
// CFGCalculator.jsx:745-764
if (nodes.length > 0) {
  const fromNodeIds = new Set(edges.map((e) => e.from));
  const leafNodes = nodes.filter((n) => !fromNodeIds.has(n.id));

  if (leafNodes.length > 0) {
    const exitNodeId = "virtual_exit_node";
    nodes = [
      ...nodes,
      {
        id: exitNodeId,
        type: "exit",
        label: "Virtual Exit",
        line: activeCfg?.endLine,
      },
    ];
    leafNodes.forEach((leaf) => {
      edges = [...edges, { from: leaf.id, to: exitNodeId }];
    });
  }
}
```

### 7.4 Control Flow Construct Support Matrix
| CFG Element / Construct | Actual Representation | Source Evidence | Limitation | Status |
|---|---|---|---|---|
| **Function Entry** | Node `id: "start"`, `type: "start"` | `cfgBuilder.service.js:32` | Single root entry point | `IMPLEMENTED` |
| **Sequential Statement** | Node `type: "statement"`, linear edge | `cfgBuilder.service.js:69-72` | Statements in block are individual nodes | `IMPLEMENTED` |
| **If / Else Conditional** | Node `type: "condition"`, branching edges | `cfgBuilder.service.js:48-56` | Does not rejoin at merge point in raw AST | `PARTIALLY IMPLEMENTED` |
| **Ternary Operator (`? :`)** | Handled in complexity, generic in CFG | `cyclomaticCalculator.service.js:26` | Not isolated as conditional CFG node | `PARTIALLY IMPLEMENTED` |
| **While / Do-While Loop** | Node `type: "condition"`, self-edge `next` | `cfgBuilder.service.js:102-107` | Self-loop edge rather than loop back-edge | `PARTIALLY IMPLEMENTED` |
| **For / For-In / For-Of** | Node `type: "condition"`, self-edge `next` | `cfgBuilder.service.js:102-107` | Loop condition & increment combined | `PARTIALLY IMPLEMENTED` |
| **Switch / Case** | Switch condition node + Case condition nodes | `cfgBuilder.service.js:111-125` | Fallthrough logic not modeled | `PARTIALLY IMPLEMENTED` |
| **Try / Catch / Finally** | Try node $\rightarrow$ Catch node (label: "error") | `cfgBuilder.service.js:76-94` | Edge labeled "error" | `IMPLEMENTED` |
| **Return Statement** | Node `type: "return"` | `cfgBuilder.service.js:60-63` | Terminal node | `IMPLEMENTED` |
| **Throw Statement** | Handled by fallback `default` expression | `cfgBuilder.service.js:141-144` | Not typed explicitly as exception exit | `PARTIALLY IMPLEMENTED` |
| **Break / Continue** | Unhandled specific node type (default) | `cfgBuilder.service.js:128-147` | Does not re-route to loop header/exit | `NOT IMPLEMENTED` |
| **Logical Short-circuit (`&&`, `\|\|`)** | Subsumed into parent Expression | `cyclomaticCalculator.service.js:38` | AST counts CC, but CFG creates no sub-nodes | `PARTIALLY IMPLEMENTED` |
| **Virtual Exit Sink** | Synthesized node `Virtual Exit` (`type: "exit"`) | `CFGCalculator.jsx:750-762` | Added dynamically on frontend | `IMPLEMENTED` |

---

## 8. McCabe Cyclomatic Complexity

### 8.1 Backend Calculation Engine ($CC = 1 + D$)
McCabe Cyclomatic Complexity is calculated on the backend by `server/src/services/cyclomaticCalculator.service.js:8-78` during snapshot ingestion or on-demand rebuilding (`buildCfg.service.js`).

Rather than relying purely on graph edge-node subtraction, the backend computes complexity directly from the Babel AST by accumulating **Decision Points** ($D$):
$$\text{Cyclomatic Complexity } (CC) = 1 + \text{Decision Points}$$

The AST visitor inspects every node within the function body and increments `decisionPoints` for:
1. `IfStatement` (+1)
2. `WhileStatement` and `DoWhileStatement` (+1)
3. `ForStatement`, `ForInStatement`, and `ForOfStatement` (+1)
4. `ConditionalExpression` (ternary operator `? :`) (+1)
5. `CatchClause` (+1)
6. `SwitchCase` where `node.test !== null && node.test !== undefined` (+1 per non-default case)
7. `LogicalExpression` with operators `&&`, `||`, or `??` (Nullish Coalescing) (+1 per operator)

```javascript
// Verification: cyclomaticCalculator.service.js:8-77
export function calculateComplexityFromAst(astNode) {
    let decisionPoints = 0;
    // ... traverses AST nodes and increments decisionPoints ...
    return {
        value: 1 + decisionPoints,
        decisionPoints
    };
}
```

### 8.2 Frontend Graph Equation Card ($M = E - N + 2P$)
When inspecting an individual function in the CFG view, the right-hand panel renders the **Graph Formula Card** (`CFGCalculator.jsx:1868-1942`):
$$M = E - N + 2P$$
Where:
- $E$: Total edges in the laid-out graph (`graphLayout.edges.length`).
- $N$: Total nodes in the laid-out graph (`graphLayout.nodes.length`).
- $P$: Connected exit components, hardcoded to $1$ (`graphLayout.exits` represented as single sink).

```javascript
// CFGCalculator.jsx:1884-1913
<span className="font-bold text-[var(--color-primary)] text-sm">{ccVal}</span>
<span className="text-[var(--color-text-muted)]">=</span>
<span className="font-semibold">{graphLayout.edges.length}</span> (E)
<span className="text-[var(--color-text-muted)]">-</span>
<span className="font-semibold">{graphLayout.nodes.length}</span> (N)
<span className="text-[var(--color-text-muted)]">+</span>
<span className="font-semibold">2</span> (P)
```

> [!IMPORTANT]
> **Discrepancy Analysis:** Notice that `ccVal` displayed on line 1886 comes from the stored backend record (`activeCc?.value || 1`), which was computed via AST decision points ($1 + D$), while the right side of the visual equation displays $E - N + 2(1)$ from the frontend Dagre layout. Because the frontend appends a `Virtual Exit` node connecting all leaf nodes, and loop nodes possess cycle edges, the topological edge/node count closely aligns with $1 + D$. However, if an unsupported statement contains short-circuit operators (`&&`, `||`), the AST score will be higher than the simplified CFG's $E - N + 2$ count.

### 8.3 Metric Specification
| Metric | Calculation | Source of Data | Display Location | Status |
|---|---|---|---|---|
| **McCabe CC (Function)** | $1 + \sum \text{Decisions}$ (AST) | `prisma.cyclomatic.value` | Radial meter & header pill | `IMPLEMENTED` |
| **Max McCabe CC (File)** | $\max(\{ c.\text{value} \mid c \in \text{fileCcs} \})$ | Computed in `useMemo` (`CFGCalculator.jsx:694`) | Right panel metric card | `IMPLEMENTED` |
| **Total Functions (File)** | `fileCfgs.length` | `cfgs` filtered by `selectedFile` | Right panel metric card | `IMPLEMENTED` |
| **Graph Edges (E)** | `graphLayout.edges.length` | Frontend Dagre graph state | Formula card & mini card | `IMPLEMENTED` |
| **Graph Nodes (N)** | `graphLayout.nodes.length` | Frontend Dagre graph state | Formula card & mini card | `IMPLEMENTED` |
| **Connected Exits (P)** | Hardcoded constant `1` | Graph design constant | Formula card & mini card | `IMPLEMENTED` |
| **Decision Points** | $\max(0, CC - 1)$ | Derived from active function CC | QA Guidance card | `IMPLEMENTED` |

---

## 9. Complexity Distribution

### 9.1 Risk Classification Thresholds
The platform establishes four discrete complexity risk tiers in `getComplexityMeta` (`CFGCalculator.jsx:129-191`):

| Complexity Tier | CC Range | Risk Classification | Color Token | UI Badge Style | Testing Recommendation |
|---|---|---|---|---|---|
| **Tier 1 (Low)** | $1 \le CC \le 4$ | Low Risk | `var(--color-success)` (Green) | `bg-[var(--color-success)]/10 text-[var(--color-success)]` | Minimal defect risk. Standard unit test cases provide sufficient coverage. |
| **Tier 2 (Moderate)** | $5 \le CC \le 10$ | Moderate Risk | `var(--color-warning)` (Amber) | `bg-[var(--color-warning)]/10 text-[var(--color-warning)]` | Thoroughly test all conditional branches (if / else / switch / loop). |
| **Tier 3 (High)** | $11 \le CC \le 20$ | High Risk | `var(--color-danger)` (Red) | `bg-[var(--color-danger)]/10 text-[var(--color-danger)]` | Refactoring recommended: decompose into smaller helper functions or services. |
| **Tier 4 (Critical)**| $CC > 20$ | Very High / Critical Risk | `var(--color-danger)` (Deep Red) | `bg-[var(--color-danger)]/15 text-[var(--color-danger)]` | Immediate refactoring mandatory before deploying to production. |

### 9.2 File-Level Distribution Rendering
In the Call Graph overview panel, the **Complexity Distribution** card (`CFGCalculator.jsx:1442-1497`) aggregates the functions of the selected file into three visual segments:
1. **Low Risk Segment:** `fileCcs.filter((c) => c.value <= 4).length`
2. **Moderate Risk Segment:** `fileCcs.filter((c) => c.value > 4 && c.value <= 10).length`
3. **High Risk Segment:** `fileCcs.filter((c) => c.value > 10).length` (combines High and Critical tiers)

The horizontal bar (`CFGCalculator.jsx:1455-1477`) computes proportional widths dynamically:
$$\text{Segment Width \%} = \frac{\text{Tier Count}}{\max(\text{fileCcs.length}, 1)} \times 100\%$$

In the screenshot:
- `Total Functions`: 15
- `Max McCabe CC`: 29 (triggers red text `text-[var(--color-danger)]` because $29 \ge 10$)
- `Low (11)` $\rightarrow 11 / 15 = 73.3\%$ green bar
- `Mod (3)` $\rightarrow 3 / 15 = 20.0\%$ amber bar
- `High (1)` $\rightarrow 1 / 15 = 6.7\%$ red bar
- Sub-label: `15 analyzed`

---

## 10. Decision-Path Analysis

### 10.1 Stated vs. Actual Decision Path Behavior
The Call Graph informational card explicitly promises:
> *"Select a function node in the Call Graph to inspect its internal Control Flow Graph, McCabe complexity index, **decision paths**, and recommended test cases."*

Static code investigation reveals how "decision paths" are actually handled:
1. **No Exhaustive Path Enumeration:** The system does **not** execute a path-enumeration algorithm (such as Depth-First Search cycle enumeration or symbolic execution) to list complete end-to-end paths ($P_1: \text{start} \rightarrow \text{if}_1 \rightarrow \text{stmt}_1 \rightarrow \text{exit}$).
2. **Decision Point Quantification:** In the QA & Testing Guidance card (`CFGCalculator.jsx:1968-1981`), the system displays the quantified number of conditional branches derived mathematically:
   ```javascript
   // CFGCalculator.jsx:1976
   Detected {Math.max(0, ccVal - 1)} conditional branches (if, switch, loop, ternary).
   ```
3. **Visual Decision Identification:** Decision points are visually differentiated on the CFG canvas using the `isDiamond` prop (`CFGCalculator.jsx:1342`), which renders condition nodes with rounded-md geometry and a warning-tinted `GitBranch` icon (`CFGCalculator.jsx:294-299`).
4. **Interactive Branch Inspection:** Clicking any decision node activates the **Node Inspector** (`CFGCalculator.jsx:1538-1718`), which classifies the node as `"Decision (Branch)"`, highlights its incoming/outgoing degrees, identifies its line number, and previews the exact source code expression.

### 10.2 Decision Path Feature Inventory
| Decision-Path Feature | Actual Behavior | Algorithm / Source | Limitation | Status |
|---|---|---|---|---|
| **Branch Identification** | Condition nodes highlighted with diamond icons | Node `type === "condition"` | High-level statement level | `IMPLEMENTED` |
| **Decision Point Count** | Quantifies total conditional branches ($CC - 1$) | Derived from `ccVal - 1` | Does not enumerate sub-branches | `IMPLEMENTED` |
| **Path Traversal / Trace** | User manually clicks successive CFG nodes | Manual graph navigation | No automated path tracing tool | `PARTIALLY IMPLEMENTED` |
| **Exhaustive Path Enumeration**| Absent from codebase | None | Path explosion prevention by omission | `NOT IMPLEMENTED` |
| **Basis Path Enumeration** | Mentions required independent test count | Basis path count $= CC$ | Does not list actual node paths | `PARTIALLY IMPLEMENTED` |
| **Infeasible Path Pruning** | Not performed | Static AST only | Unaware of variable runtime state | `NOT IMPLEMENTED` |

---

## 11. Test Case Recommendations

### 11.1 Workflow and Rule-Based Guidance
The interface references "recommended test cases" in two locations:
1. The static Call Graph navigation card (`CFGCalculator.jsx:1508`).
2. The **QA & Testing Guidance** card displayed when inspecting a function (`CFGCalculator.jsx:1945-1992`).

Code analysis of `CFGCalculator.jsx` confirms that test recommendations within this module operate via **deterministic heuristic rules** rather than dynamic AI generation or automated test file authoring:
- **Basis Path Count:** States the mathematical minimum number of independent test cases required for complete path coverage:
  $$\text{Required Tests} = CC$$
  *"Requires at least `{ccVal}` independent test cases to achieve 100% path coverage."* (`CFGCalculator.jsx:1963`)
- **Conditional Branch Directive:** Informs the engineer to construct test fixtures targeting all discovered branches (`ccVal - 1`).
- **Tier-Based Qualitative Advice:** Injects `meta.recommendation` from `getComplexityMeta` based on the complexity tier:
  - Low: Standard unit tests suffice.
  - Moderate: Test all conditional branches thoroughly.
  - High: Decompose routine before testing.
  - Critical: Immediate refactoring mandatory.

### 11.2 Separation of Logic Analysis and AI Test Generation Modules
To prevent architectural confusion, the stages of testing support across COVAI Studio are clearly separated:

```
[ LOGIC ANALYSIS (CFGCalculator) ]
   ├── Computes Cyclomatic Complexity (1 + D)
   ├── Renders CFG Nodes & Branches
   ├── Calculates Basis Path Count (CC)
   └── Yields Qualitative QA Guidance (Heuristic Rules)
           |
           x (Does NOT generate runnable test files directly in this modal)
           |
[ AI UNIT TEST GENERATION (AIUnitTestModal / unitTestSuggestion.service.js) ]
   ├── Receives File & Function Context
   ├── Calls Google Gemini LLM API
   ├── Generates Jest/Vitest Test Case Code
   └── Applies Patch via Monaco Editor / Disk
```

The Logic Analysis module itself does **not** dispatch AI prompts, execute test runners, or write test files to disk; it provides the formal structural and complexity metrics necessary for developers to evaluate test coverage requirements.

---

## 12. File Architecture Overview

### 12.1 Overview Panel Metrics
The right-hand panel in Call Graph mode provides macro-level architectural metrics for the currently selected file (`CFGCalculator.jsx:1403-1510`):

1. **`TOTAL FUNCTIONS`**:
   - Scope: Currently selected file only.
   - Calculation: `fileCfgs.length` (`CFGCalculator.jsx:1420`).
   - Behavior: Dynamically re-evaluates whenever `selectedFile` changes. In the screenshot, evaluates to `15`.
2. **`MAX MCCABE CC`**:
   - Scope: Currently selected file only.
   - Calculation: `Math.max(...fileCcs.map((c) => c.value))` (`CFGCalculator.jsx:694-697`).
   - Behavior: If `fileCcs` is empty, returns `0`. Dynamically colors the value red ($\ge 10$), amber ($\ge 5$), or green ($< 5$). In the screenshot, evaluates to `29`.
3. **`Complexity Distribution`**:
   - Scope: Currently selected file only.
   - Calculation: Groups `fileCcs` into Low ($\le 4$), Moderate ($5-10$), and High ($> 10$).
   - Behavior: Renders three-color bar and category counts alongside total analyzed functions count (`fileCcs.length analyzed`).
4. **`CALL GRAPH NAVIGATION`**:
   - Scope: Static informational guidance card.
   - Content: Explains how to interact with function nodes to drill into the CFG.

### 12.2 Overview Metric Specification
| UI Metric | Scope | Calculation | Update Trigger | Source Evidence |
|---|---|---|---|---|
| **Total Functions** | File-level | `fileCfgs.length` | `selectedFile` change | `CFGCalculator.jsx:1420` |
| **Max McCabe CC** | File-level | `Math.max(...fileCcs.map(c => c.value))` | `selectedFile` change | `CFGCalculator.jsx:694` |
| **Low Complexity Count** | File-level | `fileCcs.filter(c => c.value <= 4).length` | `selectedFile` change | `CFGCalculator.jsx:1481` |
| **Mod Complexity Count** | File-level | `fileCcs.filter(c => c.value > 4 && c.value <= 10).length` | `selectedFile` change | `CFGCalculator.jsx:1487` |
| **High Complexity Count**| File-level | `fileCcs.filter(c => c.value > 10).length` | `selectedFile` change | `CFGCalculator.jsx:1494` |
| **Analyzed Functions Count**| File-level | `fileCcs.length` | `selectedFile` change | `CFGCalculator.jsx:1452` |

---

## 13. Frontend-Backend Workflows

### 13.1 Detailed Workflow Sequences

#### Workflow A: Open Logic Analysis
1. User clicks the `GitBranch` icon on the IDE Activity Bar (`Layout.jsx:115-118`).
2. `setActiveActivity("logic-analysis")` mounts `CFGCalculator` as a full-screen overlay.
3. `useEffect` in `CFGCalculator.jsx:575-641` fires parallel API queries:
   - `getProjectCfgApi(project.id, "")` $\rightarrow$ `GET /api/projects/:id/cfg`
   - `getProjectCcApi(project.id, "")` $\rightarrow$ `GET /api/projects/:id/cc`
4. Backend `project.controller.js` retrieves `prisma.cfg` and `prisma.cyclomatic` records for the latest project snapshot.
5. On data arrival, `selectedFile` defaults to the first available file in `uniqueFiles`.
6. `getFileContentApi(project.id, selectedFile)` fetches physical source code.
7. Overview metrics and Call Graph function nodes are rendered on the canvas.

#### Workflow B: Select Another Source File
1. User clicks the file dropdown in the top bar and selects a new path (`CFGCalculator.jsx:930-947`).
2. `setSelectedFile(newPath)` and `setSelectedFunc(null)` are dispatched.
3. `getFileContentApi(project.id, newPath)` fetches the new source code.
4. `fileCfgs` and `fileCcs` recompute via `useMemo`.
5. Dagre recomputes the vertical layout for the new file's function list.
6. The right panel updates `TOTAL FUNCTIONS`, `MAX MCCABE CC`, and `Complexity Distribution`.

#### Workflow C: Select a Function Node
1. User clicks a `FuncNode` card on the canvas or an external deep link invokes `setSelectedFunc(funcName)`.
2. `activeCfg` is resolved from `fileCfgs.find(c => c.functionName === selectedFunc)`.
3. `activeCfg.graphJson` is parsed, virtual exit node is appended, and Dagre computes the CFG layout.
4. The canvas transitions from Call Graph view to the detailed CFG view with SVG edge routing.
5. Code pane auto-scrolls to `activeCfg.startLine` and applies the indicator arrow (`▶`).
6. Right panel transitions from Overview to `Complexity Analysis`, rendering the radial gauge, formula card, and QA guidance.

#### Workflow D: Navigate the Function Graph
1. **Zoom:** Clicking `+` / `-` buttons or scrolling mouse wheel updates `zoom` state ($0.2 \le \text{zoom} \le 3.0$).
2. **Pan:** Clicking canvas background and dragging updates `pan = { x: pan.x + dx, y: pan.y + dy }`.
3. **Reset:** Clicking `Reset` restores `zoom = 1` and `pan = { x: 0, y: 0 }`.

#### Workflow E: Open in Editor
1. User clicks `Open in Editor` button in the top bar (`CFGCalculator.jsx:960-977`).
2. `onClose()` is invoked, dismissing the `CFGCalculator` modal.
3. `onOpenFile(selectedFile, targetLine, selectedFunc, endLine)` is dispatched to `Layout.jsx:492`.
4. `Layout.jsx` sets `activeActivity = "explorer"`, loads the file into the Monaco Editor model, moves the editor cursor to `targetLine`, and centers the viewport.

### 13.2 Workflow Architecture Matrix
| Workflow | Frontend Entry Point | API / Service | Backend Handler | Analysis Result | UI Feedback |
|---|---|---|---|---|---|
| **A: Open Module** | Activity Bar click (`Layout.jsx`) | `getProjectCfgApi`, `getProjectCcApi` | `projectController.getCfg`, `getCc` | Stored CFG & Cyclomatic records | Loading spinner $\rightarrow$ Call Graph & Overview |
| **B: Select File** | File dropdown `<select>` | `getFileContentApi` | `projectController.getFileContent` | Plaintext source code | Code viewer update & metric recalculation |
| **C: Select Function** | `FuncNode.onClick` | Internal state resolution | None (pre-cached in DB) | Parsed CFG nodes & edges | Transition to CFG & radial gauge display |
| **D: Navigate Graph** | Canvas mouse drag / wheel | None (Pure client DOM) | None | Transform matrix translation | Smooth CSS pan/zoom transition |
| **E: Rebuild CFG** | "Rebuild CFG" button | `buildCfgApi` | `projectController.buildCfg` | BullMQ `BUILD_CFG` job | Spinner with "Rebuilding CFG..." label |
| **F: Open in Editor** | "Open in Editor" button | `onOpenFile` prop callback | None (Monaco IDE bridge) | Active Monaco buffer | Modal closes, Monaco editor opens at target line |

---

## 14. UI Specification Table

The following specification details every user interface element verified within the Logic Analysis module:

| No. | Field name | Type | Require | Target |
|---|---|---|---|---|
| 1 | `file-selector-dropdown` | Selector (`<select>`) | Lists `uniqueFiles` derived from CFGs; font-mono; updates `selectedFile` and resets `selectedFunc` to `null`. | Select source file for analysis. |
| 2 | `function-breadcrumb-tag` | Label / Tag | Visible only when `!isCallGraph`; displays `selectedFunc()` in bold primary color. | Indicate currently inspected function. |
| 3 | `open-in-editor-button` | Button | Visible when `onOpenFile` and `selectedFile` exist; icon `ExternalLink`; triggers editor navigation. | Dismiss modal and open file in Monaco Editor. |
| 4 | `close-modal-button` | Button | Always visible in top right; icon `X`; triggers `onClose` callback. | Close Logic Analysis overlay and return to previous IDE tab. |
| 5 | `source-code-panel` | Resizable Panel | Width controlled by `leftWidth` (200px–800px); contains header and scrollable code lines. | Host source code display and line synchronization. |
| 6 | `source-code-header-label` | Label | Text: `"Source Code"`; uppercase; tracking-wider; font-mono. | Identify left column contents. |
| 7 | `highlighted-line-tag` | Badge | Visible when `highlightedLine` is non-null; displays `"Line {N}"`. | Display active synced line number. |
| 8 | `js-ts-indicator-badge` | Badge | Static badge; text `"JS/TS"`; styled with primary tint and rounded border. | Indicate supported file syntax formats. |
| 9 | `source-code-line-row` | Interactive Row | Unique ID `cfg-source-line-${line.num}`; click syncs corresponding CFG node; hover state. | Render individual code lines with click-to-node sync. |
| 10 | `source-line-indicator` | Indicator | Animated pulse arrow `▶`; visible only on `highlightedLine`. | Visually pinpoint selected line of code. |
| 11 | `source-line-number` | Numeric Column | 1-indexed line number; width 44px; right-aligned; font-mono. | Display line coordinates. |
| 12 | `syntax-highlighted-code` | Text Viewer | Formatted via regex tokenizer into keywords, strings, numbers, and plain text. | Display readable source code with visual highlights. |
| 13 | `left-panel-resizer` | Resizer Handle | Draggable divider; width 6px; cursor `col-resize`; triggers `setIsResizingLeft`. | Adjust width between code panel and graph canvas. |
| 14 | `graph-middle-panel` | Canvas Viewport | Minimum width 550px; flex-1; relative positioning; handles mouse pan and wheel zoom. | Host Call Graph and CFG canvas rendering. |
| 15 | `graph-canvas-back-button` | Button | Visible only when `!isCallGraph`; icon `ArrowLeft`; text `"Back"`; resets `selectedFunc` to `null`. | Return from function CFG view to file Call Graph view. |
| 16 | `graph-canvas-title` | Heading | Text: `"Functions in File"` (Call Graph) or `"Control Flow Graph"` (CFG). | State current visualization mode. |
| 17 | `zoom-out-button` | Button | Icon `ZoomOut`; decrements zoom by 0.15 (clamped to minimum 0.2). | Decrease canvas zoom scale. |
| 18 | `zoom-percentage-display` | Text Display | Formatted as `Math.round(zoom * 100)%`; width 44px; font-mono bold. | Display active canvas scale factor. |
| 19 | `zoom-in-button` | Button | Icon `ZoomIn`; increments zoom by 0.15 (clamped to maximum 3.0). | Increase canvas zoom scale. |
| 20 | `zoom-reset-button` | Button | Icon `RotateCcw`; text `"Reset"`; resets `zoom = 1` and `pan = { x: 0, y: 0 }`. | Re-center and normalize canvas viewport. |
| 21 | `canvas-interactive-surface`| Interactive Container| Listens to `mousedown`, `mousemove`, `mouseup`, and `wheel`; cursor `grab`/`grabbing`. | Enable user panning and scroll-zooming of graph. |
| 22 | `call-graph-func-node` | Graph Node Card | Visible in Call Graph mode; icon `Network`; label `{name}()`; hover scale; click selects function. | Represent callable routine and trigger CFG drill-down. |
| 23 | `cfg-node-element` | Graph Node Card | Visible in CFG mode; displays label and line; diamond for conditions; rounded for statements. | Represent basic block / statement in control flow. |
| 24 | `cfg-svg-edge-layer` | SVG Layer | Renders directed cubic paths with arrowhead markers connecting CFG nodes. | Visualize control flow transitions between nodes. |
| 25 | `canvas-instruction-pill` | Floating Pill | Bottom-centered floating pill; icon `Sparkles`; text changes based on mode. | Provide interactive guidance to user. |
| 26 | `right-panel-resizer` | Resizer Handle | Draggable divider; width 6px; cursor `col-resize`; triggers `setIsResizingRight`. | Adjust width between canvas and metrics panel. |
| 27 | `metrics-right-panel` | Resizable Panel | Width controlled by `rightWidth` (200px–800px); scrollable container. | Host architecture overview or complexity metrics. |
| 28 | `overview-header-label` | Heading | Icon `Layers`; text `"File Architecture Overview"`; uppercase font-mono. | Identify Call Graph overview panel. |
| 29 | `total-functions-metric` | Metric Card | Displays `fileCfgs.length`; 2xl font-mono bold. | Show total callable routines in active file. |
| 30 | `max-mccabe-cc-metric` | Metric Card | Displays `maxCc`; dynamically colored red ($\ge 10$), amber ($\ge 5$), or green. | Show highest function cyclomatic complexity in file. |
| 31 | `complexity-distribution-card`| Card | Segmented progress bar (Low/Mod/High) + count breakdown + `{N} analyzed` label. | Show distribution of function complexity across file. |
| 32 | `call-graph-navigation-card`| Info Card | Icon `Info`; text detailing CFG inspection, McCabe index, decision paths, and tests. | Provide orientation instructions in Call Graph mode. |
| 33 | `cfg-node-inspector-card` | Inspector Card | Visible in CFG mode when node clicked; displays Type, Line, In/Out degree, and Source preview. | Provide detailed inspection of selected CFG node. |
| 34 | `radial-mccabe-gauge` | SVG Radial Gauge | Circular progress meter; displays numeric CC; risk pill; 4-tier interactive bar. | Visualize function cyclomatic complexity and risk level. |
| 35 | `graph-formula-card` | Card | Displays $M = E - N + 2P$ formula with live counts for Edges, Nodes, and Exits. | Demonstrate topological McCabe graph equation. |
| 36 | `qa-testing-guidance-card` | Guidance Card | Icon `ShieldCheck`; lists basis paths, decision point count, and qualitative advice. | Guide QA engineers on required test cases. |
| 37 | `loading-state-view` | Loading State | Centered rotating `RefreshCw` icon; text `"Loading analysis data..."` or `"Rebuilding CFG..."`. | Indicate ongoing data fetching or background jobs. |
| 38 | `error-state-view` | Error State | Centered error message in danger color + `"Rebuild CFG"` button. | Alert user to failure and provide rebuild recovery. |
| 39 | `empty-state-view` | Empty State | Icon `Network`; text `"No CFG Data Available"` + `"Build CFG & CC"` button. | Prompt user to generate initial CFG data for snapshot. |

---

## 15. Screenshot-to-Code Comparison

The following table compares the visual elements captured in the reference screenshot against verified implementation facts in the repository:

| UI Element | Screenshot Observation | Actual Implementation | Status | Evidence / Notes |
|---|---|---|---|---|
| **Top File Selector** | Dropdown with value `src/handlers/create-quickbooks-attachable.handler.ts` | Populated dynamically from `uniqueFiles` derived from `cfgs` | `MATCH` | `CFGCalculator.jsx:930-947` |
| **Open in Editor Button**| Button in top-right with icon and label `"Open in Editor"` | Renders `ExternalLink` icon and invokes `onOpenFile` callback | `MATCH` | `CFGCalculator.jsx:960-977` |
| **Top Close Button** | `"X"` icon button in upper-right corner | Renders `X` icon and invokes `onClose` callback | `MATCH` | `CFGCalculator.jsx:978-985` |
| **Source Code Header** | `"SOURCE CODE"` title with `"JS/TS"` indicator badge | Matches uppercase text and primary-tinted badge | `MATCH` | `CFGCalculator.jsx:1081-1093` |
| **Code Line Numbers** | 1-indexed lines 170–190 visible | Dynamically mapped from `sourceCode.split("\n")` | `MATCH` | `CFGCalculator.jsx:1098-1155` |
| **Syntax Highlighting** | Keywords (`if`, `else`), strings, and numbers colored | Regex tokenizer `syntaxHighlight()` applies colors | `MATCH` | `CFGCalculator.jsx:40-74` |
| **Comments Display** | Multi-line comments rendered as plain text | Regex tokenizer lacks comment rules, rendering plain text | `MATCH` (Visual limitation verified) | `CFGCalculator.jsx:43` |
| **Middle Panel Title** | `"FUNCTIONS IN FILE"` heading | Evaluates when `isCallGraph === true` | `MATCH` | `CFGCalculator.jsx:1184` |
| **Zoom Controls** | `Q-` zoom-out, `40%`, `Q+` zoom-in, `Reset` button | Zoom controls step by $\pm 15\%$; `Reset` resets to 100% | `MATCH` | `CFGCalculator.jsx:1187-1229` |
| **Function Canvas Nodes**| Vertical stack of `FuncNode` items (`sendDirectMessage()`, `<anonymous@L...>`, etc.) | `FuncNode` maps all file functions; synthetic chain aligns layout | `MATCH` | `CFGCalculator.jsx:725-735, 1277-1285` |
| **Anonymous Naming** | `<anonymous@L185C2>`, `<anonymous@L261C24>`, etc. | Derived from `cyclomaticFunctionExtractor.service.js:63` | `MATCH` | Exact coordinate syntax verified |
| **Canvas Footer Hint** | `"Click a function node to analyze its CFG • Drag canvas to pan"` | Renders inside floating pill with `Sparkles` icon | `MATCH` | `CFGCalculator.jsx:1357-1362` |
| **Overview Header** | `"FILE ARCHITECTURE OVERVIEW"` with `Layers` icon | Renders in right panel when `isCallGraph === true` | `MATCH` | `CFGCalculator.jsx:1404-1412` |
| **Total Functions Metric**| Value `15` displayed under `"TOTAL FUNCTIONS"` | Evaluates dynamically via `fileCfgs.length` | `MATCH` | `CFGCalculator.jsx:1420` |
| **Max McCabe CC Metric**| Value `29` displayed under `"MAX MCCABE CC"` in red | Evaluates dynamically via `Math.max(...fileCcs)`; red if $\ge 10$ | `MATCH` | `CFGCalculator.jsx:1425-1437` |
| **Complexity Distribution**| Bar with segments and `Low (11)`, `Mod (3)`, `High (1)` | Dynamically calculated from `fileCcs` thresholds ($\le 4, 5-10, > 10$) | `MATCH` | `CFGCalculator.jsx:1442-1497` |
| **Analyzed Functions Count**| Label `"15 analyzed"` on distribution card | Displays `fileCcs.length analyzed` | `MATCH` | `CFGCalculator.jsx:1452` |
| **Call Graph Navigation**| Card describing CFG inspection, McCabe index, and tests | Static text matches character-for-character | `MATCH` | `CFGCalculator.jsx:1500-1510` |
| **Dynamic Call Graph Edges**| Vertical linear chain between functions | Edges are synthetic layout guides, not actual call relationships | `PARTIAL MATCH` | Visual matches, semantics differ |
| **Decision Path Listing**| Navigation card promises decision paths | Only displays quantified count and highlights condition nodes | `PARTIAL MATCH` | No end-to-end path enumeration |
| **Test Case Recommendations**| Navigation card promises recommended test cases | Provides rule-based basis path count; no runnable tests | `PARTIAL MATCH` | Structural guidance only |

---

## 16. Limitations and Findings

### 16.1 Detailed Technical Findings

1. **Synthetic Chain Call Graph Representation:**
   - *Evidence:* `CFGCalculator.jsx:733-734` (`for (let i = 0; i < nodes.length - 1; i++) edges.push({ from: nodes[i].id, to: nodes[i + 1].id });`).
   - *Impact:* The `FUNCTIONS IN FILE` canvas is labeled as a "Call Graph" in the UI guidance card, but it does not perform static call graph analysis. Functions are chained sequentially regardless of whether invocation relationships exist.
2. **Calculation Discrepancy between AST Complexity and Topological Formula:**
   - *Evidence:* Backend calculates $CC = 1 + D$ (`cyclomaticCalculator.service.js:75`), while the frontend formula card displays $M = E - N + 2P$ (`CFGCalculator.jsx:1884-1913`).
   - *Impact:* While the virtual exit node and loop back-edges make the counts agree in simple functions, complex expressions with logical operators (`&&`, `||`, `??`) increment the AST score without adding nodes or edges to the CFG, causing the displayed equation to appear mathematically inconsistent to an astute user.
3. **Absence of Runnable Test Case Generation in Logic Module:**
   - *Evidence:* `CFGCalculator.jsx` contains no API calls to `aiTest.service.js` or unit test generator endpoints.
   - *Impact:* Users expecting automated test case generation from the "recommended test cases" label only receive qualitative rules (e.g., basis path count and general advice).
4. **Lightweight Tokenizer Comment Blindness:**
   - *Evidence:* `syntaxHighlight()` in `CFGCalculator.jsx:40-74` lacks regex rules for `//` and `/* ... */`.
   - *Impact:* Comments containing keywords (such as `if`, `return`, or strings) have their words highlighted as live code rather than muted as commentary.
5. **Physical Disk vs. Database Snapshot Divergence:**
   - *Evidence:* Source code is read directly from disk (`projectController.getFileContent`), whereas CFGs are queried from Prisma (`prisma.cfg.findMany`).
   - *Impact:* If repository files are modified on disk after snapshot generation, line numbers in the CFG nodes may no longer align with source lines until a rebuild is manually triggered.

### 16.2 Findings and Defect Inventory
| Finding | Evidence | Impact | Status | Recommendation |
|---|---|---|---|---|
| **Synthetic Call Graph Edges** | `CFGCalculator.jsx:734` | Edges do not reflect real function invocations | `VERIFIED LIMITATION` | Replace dummy chain with AST call expression extraction or rename UI to "Functions List". |
| **Equation Inconsistency on Short-Circuits** | `cyclomaticCalculator.service.js:38` vs `CFGCalculator.jsx:1886` | $E - N + 2P$ may not equal AST CC when logical operators exist | `VERIFIED DISCREPANCY` | Decompose logical expressions into CFG decision nodes in `cfgBuilder.service.js`. |
| **No Dynamic Path Enumeration** | `CFGCalculator.jsx:1976` | Decision paths are quantified, not enumerated | `VERIFIED LIMITATION` | Implement basis path enumeration algorithm (e.g., McCabe's baseline method). |
| **Syntax Highlighter Comment Flaw** | `CFGCalculator.jsx:43` | Comments are not tokenized or muted | `VERIFIED DEFECT` | Update regex tokenizer to strip or style `//` and `/* */` comments. |
| **Disk/Snapshot Drift Risk** | `project.controller.js:390` vs `:1510` | Code lines drift from stored CFG nodes if edited | `VERIFIED RISK` | Store source code snapshot in database alongside CFG records. |
| **Virtual Exit Frontend Mutation** | `CFGCalculator.jsx:750` | Backend CFG lacks exit nodes; patched in React | `ARCHITECTURAL OMISSION` | Shift virtual exit node generation to backend `cfgBuilder.service.js`. |

---

## 17. Recommendations

### 17.1 Short-Term Enhancements
1. **Accurate UI Nomenclature:**
   Update the label in `CFGCalculator.jsx:1503` from `Call Graph Navigation` to `File Function Catalog` or `Routine Navigation` to eliminate user confusion regarding call graph semantics.
2. **Comment-Aware Tokenizer:**
   Refactor `syntaxHighlight(text)` to support comment recognition prior to keyword matching:
   ```javascript
   if (part.startsWith("//") || part.startsWith("/*")) {
     return <span key={i} className="text-[var(--color-text-muted)] italic">{part}</span>;
   }
   ```
3. **Explicit Equation Rebalancing:**
   In the Graph Formula card, display an explicit modifier for logical operator decisions:
   $$M = (E - N + 2P) + D_{\text{logical}}$$
   This clarifies why the displayed $CC$ score exceeds the raw topological graph count when boolean short-circuits are present.

### 17.2 Long-Term Strategic Enhancements
1. **True Static Call Graph Extraction:**
   Integrate AST `CallExpression` scanning in `functionExtraction.service.js` to detect inter-function calls within the file and construct genuine caller-callee edges in the Call Graph mode.
2. **Direct Linkage to AI Test Generation:**
   Add a direct `"Generate Unit Tests for Function"` action button inside the `QA & Testing Guidance` card. Clicking this button would pass the function name, line range, and basis path count directly to `AIUnitTestModal.jsx`, closing the loop between static complexity analysis and automated test synthesis.
3. **McCabe Basis Path Enumeration:**
   Implement an automated basis path extractor that executes a fundamental cycle basis algorithm (such as Paton's or Horton's algorithm) on the CFG, displaying the exact sequence of decision nodes that form the linearly independent basis set.

---

## 18. Source References

The findings, metrics, and implementation behaviors documented in this report were verified against the following repository source files:

### Frontend Implementation Files
- [`client/src/components/dashboard/CFGCalculator.jsx`](file:///d:/NCKH/CovAI-/client/src/components/dashboard/CFGCalculator.jsx): Lines 1–2006 (Core Logic Analysis modal, Dagre layout, custom tokenizer, radial gauge, formula card, and sync handlers).
- [`client/src/components/dashboard/Layout.jsx`](file:///d:/NCKH/CovAI-/client/src/components/dashboard/Layout.jsx): Lines 18–19, 115–118, 130–134, 169–190, 492, 1144–1155 (IDE Activity Bar registration, deep linking, and Monaco editor integration).
- [`client/src/components/dashboard/ActivityBar.jsx`](file:///d:/NCKH/CovAI-/client/src/components/dashboard/ActivityBar.jsx): Line 20 (Logic Analysis navigation entry definition).
- [`client/src/services/project.service.js`](file:///d:/NCKH/CovAI-/client/src/services/project.service.js): Lines 14–16, 26–30 (Axios client endpoints for CFG, CC, source content, and rebuild triggers).
- [`client/src/components/dashboard/FileBranchCFGView.jsx`](file:///d:/NCKH/CovAI-/client/src/components/dashboard/FileBranchCFGView.jsx): Lines 1–60 (Secondary branch coverage CFG visualization).

### Backend Implementation Files
- [`server/src/routes/project.route.js`](file:///d:/NCKH/CovAI-/server/src/routes/project.route.js): Lines 23–25, 122–132 (REST route definitions for `/cfg`, `/cc`, `/cfg/build`, and `/file-content`).
- [`server/src/controllers/project.controller.js`](file:///d:/NCKH/CovAI-/server/src/controllers/project.controller.js): Lines 383–421 (`getFileContent`), 708–767 (`buildCfg`), 1480–1525 (`getCfg`), 1527–1573 (`getCc`).
- [`server/src/services/buildCfg.service.js`](file:///d:/NCKH/CovAI-/server/src/services/buildCfg.service.js): Lines 1–100 (Full project CFG & Cyclomatic pipeline orchestrator).
- [`server/src/services/buildCfgJob.service.js`](file:///d:/NCKH/CovAI-/server/src/services/buildCfgJob.service.js): Lines 1–91 (BullMQ job processor for asynchronous CFG generation).
- [`server/src/services/cfgBuilder.service.js`](file:///d:/NCKH/CovAI-/server/src/services/cfgBuilder.service.js): Lines 1–165 (AST-to-CFG recursive traversal, node/edge generation).
- [`server/src/services/cfgStorage.service.js`](file:///d:/NCKH/CovAI-/server/src/services/cfgStorage.service.js): Lines 1–74 (CFG database serialization and Prisma persistence).
- [`server/src/services/cyclomaticCalculator.service.js`](file:///d:/NCKH/CovAI-/server/src/services/cyclomaticCalculator.service.js): Lines 1–78 (AST decision point accumulation and CC formula calculation).
- [`server/src/services/cyclomaticFunctionExtractor.service.js`](file:///d:/NCKH/CovAI-/server/src/services/cyclomaticFunctionExtractor.service.js): Lines 1–82 (Babel parser function extraction and `<anonymous@L...>` coordinate naming).
- [`server/src/services/functionExtraction.service.js`](file:///d:/NCKH/CovAI-/server/src/services/functionExtraction.service.js): Lines 1–253 (Contextual function naming and AST metadata extraction).
- [`server/src/services/babelParser.service.js`](file:///d:/NCKH/CovAI-/server/src/services/babelParser.service.js): Lines 1–57 (Standard Babel parser options and plugin array).
- [`server/src/services/cyclomaticAnalysis.service.js`](file:///d:/NCKH/CovAI-/server/src/services/cyclomaticAnalysis.service.js): Lines 1–51 (Snapshot cyclomatic file scanning and storage runner).
- [`server/prisma/schema.prisma`](file:///d:/NCKH/CovAI-/server/prisma/schema.prisma): Lines 246–260 (`model Cfg`), lines 262–275 (`model Cyclomatic`).
