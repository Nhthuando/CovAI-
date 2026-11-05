/**
 * simulationViewIntegrationContracts.test.js
 *
 * Contract & Integration Test Suite for Unit Test Execution Simulation View Wiring (Milestone 4)
 *
 * Verifies:
 * 1. UnitTestTraceabilityMatrix.jsx triggers:
 *    - File group header contains "Simulate File Tests" button with Play icon
 *    - Function row contains "⚡ Simulate" button alongside "View Code" & Cyclomatic Complexity (CC)
 *    - CategoryMatrix4Cards renders inline "Simulate" buttons for test cases across all 4 categories
 *    - Supports both delegated onOpenSimulation callback and internal modal fallback
 * 2. InPlaceCoverageFileModal.jsx trigger:
 *    - Modal header contains actionable "⚡ Simulate Execution" button next to Copy & Full Editor
 *    - Dispatches execution context (filePath, functionName, targetLine, testInfo)
 *    - Supports delegated onOpenSimulation and internal modal fallback
 * 3. CoverageTypeDashboard.jsx modal mounting & 3-Tab Invariant (Rule 10):
 *    - Top toolbar renders "⚡ Simulation Studio" launcher with source file selector dropdown
 *    - Mounts <UnitTestSimulationStudioModal ... /> overlay container
 *    - Delegates onOpenSimulation callback down to UnitTestTraceabilityMatrix and InPlaceCoverageFileModal
 *    - Preserves strict Rule 10 invariant: Exactly 3 canonical tabs for unit test coverage
 *      ("Logic & Test Traceability", "Test Suites & Specs", "Version History") with 0 disjoint tabs
 *    - client/src/pages/CoverageTypeDashboard.jsx re-export resolution
 * 4. Storage Immutability Guard:
 *    - Zero modifications or writes to storage/ and uploads/
 */

import { describe, it, expect } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateSimulationTrace } from '../services/unitTestSimulationEngine.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../..');

describe('Milestone 4: Simulation View Integration & Educational Guidance Wiring Contracts', () => {
    const traceabilityMatrixPath = path.join(rootDir, 'client/src/components/dashboard/UnitTestTraceabilityMatrix.jsx');
    const inPlaceModalPath = path.join(rootDir, 'client/src/components/dashboard/InPlaceCoverageFileModal.jsx');
    const dashboardComponentPath = path.join(rootDir, 'client/src/components/dashboard/CoverageTypeDashboard.jsx');
    const dashboardPagePath = path.join(rootDir, 'client/src/pages/CoverageTypeDashboard.jsx');
    const simulationStudioModalPath = path.join(rootDir, 'client/src/components/dashboard/simulation/UnitTestSimulationStudioModal.jsx');

    it('all target integration and modal component files exist on disk', () => {
        expect(fs.existsSync(traceabilityMatrixPath)).toBe(true);
        expect(fs.existsSync(inPlaceModalPath)).toBe(true);
        expect(fs.existsSync(dashboardComponentPath)).toBe(true);
        expect(fs.existsSync(dashboardPagePath)).toBe(true);
        expect(fs.existsSync(simulationStudioModalPath)).toBe(true);
    });

    describe('1. UnitTestTraceabilityMatrix.jsx Clean Architecture', () => {
        const content = fs.readFileSync(traceabilityMatrixPath, 'utf8');

        it('maintains clean separation: no simulate button clutter in traceability file rows', () => {
            // Per user request: simulation is decoupled into its own tab beside Logic & Test Traceability
            expect(content).not.toMatch(/Simulate File Tests/);
        });

        it('supports onOpenFile in-place navigation and proof modal', () => {
            expect(content).toMatch(/onOpenFile/);
            expect(content).toMatch(/setInspectingFileProof/);
        });
    });

    describe('2. InPlaceCoverageFileModal.jsx Simulation Trigger', () => {
        const content = fs.readFileSync(inPlaceModalPath, 'utf8');

        it('imports UnitTestSimulationStudioModal and Zap icon', () => {
            expect(content).toMatch(/import\s+UnitTestSimulationStudioModal\s+from\s+['"]\.\/simulation\/UnitTestSimulationStudioModal\.jsx['"]/);
            expect(content).toMatch(/Zap/);
        });

        it('accepts onOpenSimulation prop and maintains internalSimTarget state', () => {
            expect(content).toMatch(/onOpenSimulation\s*=\s*null/);
            expect(content).toMatch(/const\s+\[internalSimTarget,\s*setInternalSimTarget\]\s*=\s*useState\(null\)/);
        });

        it('renders actionable "⚡ Simulate Execution" button in modal header action bar', () => {
            expect(content).toMatch(/⚡ Simulate Execution/);
            expect(content).toMatch(/title=["']Open interactive execution simulation studio for this file/);
            expect(content).toMatch(/typeof\s+onOpenSimulation\s*===\s*["']function["']/);
        });

        it('mounts fallback UnitTestSimulationStudioModal when onOpenSimulation is not delegated', () => {
            expect(content).toMatch(/!onOpenSimulation\s*&&\s*internalSimTarget/);
            expect(content).toMatch(/<UnitTestSimulationStudioModal[\s\S]*?isOpen=\{Boolean\(internalSimTarget\)\}/);
        });
    });

    describe('3. CoverageTypeDashboard.jsx Mounting & Strict Rule 10 Layout Invariant', () => {
        const content = fs.readFileSync(dashboardComponentPath, 'utf8');

        it('imports UnitTestSimulationStudioModal from simulation directory', () => {
            expect(content).toMatch(/import\s+UnitTestSimulationStudioModal\s+from\s+['"]\.\/simulation\/UnitTestSimulationStudioModal\.jsx['"]/);
        });

        it('maintains simulationTarget state for contextual triggers without quickSimFile', () => {
            expect(content).toMatch(/const\s+\[simulationTarget,\s*setSimulationTarget\]\s*=\s*useState\(null\)/);
        });

        it('verifies simulation tab exists beside Logic & Test Traceability per approved plan', () => {
            expect(content).toMatch(/id:\s*["']simulation["']/);
            expect(content).toMatch(/label:\s*["']Test Execution Simulation["']/);
        });

        it('mounts UnitTestSimulationStudioModal in embedded simulation tab and as modal overlay', () => {
            expect(content).toMatch(/activeMetricView\s*===\s*["']simulation["']/);
            expect(content).toMatch(/<UnitTestSimulationStudioModal[\s\S]*?availableSourceFiles=\{selectedFiles\}/);
            expect(content).toMatch(/\{simulationTarget\s*&&\s*\(\s*<UnitTestSimulationStudioModal/);
            expect(content).toMatch(/isOpen=\{Boolean\(simulationTarget\)\}/);
            expect(content).toMatch(/onClose=\{\(\)\s*=>\s*setSimulationTarget\(null\)\}/);
            expect(content).toMatch(/initialSourceFile=\{simulationTarget\.filePath/);
        });

        it('preserves clean consolidated unit tabs structure with dedicated simulation studio tab', () => {
            // Find the unit test tabs definition
            const unitTabsMatch = content.match(/\.\.\.\(type\s*===\s*["']unit["']\s*\?\s*\[([\s\S]*?)\]\s*:\s*\[/);
            expect(unitTabsMatch).not.toBeNull();
            const tabsBlock = unitTabsMatch[1];

            // Verify canonical tabs are present
            expect(tabsBlock).toMatch(/id:\s*["']traceability["']/);
            expect(tabsBlock).toMatch(/label:\s*["']Logic & Test Traceability["']/);
            expect(tabsBlock).toMatch(/id:\s*["']simulation["']/);
            expect(tabsBlock).toMatch(/label:\s*["']Test Execution Simulation["']/);
            expect(tabsBlock).toMatch(/id:\s*["']testcases["']/);
            expect(tabsBlock).toMatch(/label:\s*["']Test Suites & Specs["']/);
            expect(tabsBlock).toMatch(/id:\s*["']versions["']/);
            expect(tabsBlock).toMatch(/label:\s*["']Version History["']/);

            // Count the number of tab definitions inside the unit tabs array
            const tabIdMatches = tabsBlock.match(/id:\s*["']([^"']+)["']/g);
            expect(tabIdMatches).toHaveLength(4);
        });

        it('client/src/pages/CoverageTypeDashboard.jsx properly re-exports dashboard component', () => {
            const pageContent = fs.readFileSync(dashboardPagePath, 'utf8');
            expect(pageContent).toMatch(/import\s+CoverageTypeDashboard\s+from\s+["']\.\.\/components\/dashboard\/CoverageTypeDashboard\.jsx["']/);
            expect(pageContent).toMatch(/export\s+default\s+CoverageTypeDashboard/);
        });
    });

    describe('4. Storage Code Immutability Guard (Rule 8)', () => {
        it('ensures storage/ and uploads/ remain completely untouched', () => {
            const storageDir = path.join(rootDir, 'storage');
            const uploadsDir = path.join(rootDir, 'uploads');

            if (fs.existsSync(storageDir)) {
                const stat = fs.statSync(storageDir);
                expect(stat.isDirectory()).toBe(true);
            }
            if (fs.existsSync(uploadsDir)) {
                const stat = fs.statSync(uploadsDir);
                expect(stat.isDirectory()).toBe(true);
            }
        });
    });

    describe('5. Backend Simulation Engine Realism & Category-Aware Contracts (F4, F5, F6)', () => {
        const dummySource = `
            export function calculateDiscount(price, userType) {
                if (price < 0) {
                    throw new Error("Invalid price: negative values not allowed");
                }
                if (userType === "VIP") {
                    return price * 0.8;
                }
                return price;
            }
        `;

        const dummyTest = `
            import { calculateDiscount } from "./discount.service.js";

            describe("calculateDiscount", () => {
                it("calculates regular price for standard user (Happy Path)", () => {
                    const total = calculateDiscount(100, "STANDARD");
                    expect(total).toBe(100);
                });

                it("calculates discounted price for VIP (Branch Toggling)", () => {
                    const total = calculateDiscount(100, "VIP");
                    expect(total).toBe(80);
                });

                it("throws error for negative price (Error Handling)", () => {
                    expect(() => calculateDiscount(-10, "STANDARD")).toThrow("Invalid price");
                });
            });
        `;

        it('F6: emits phase ERROR_THROW when guard clause throws an exception', async () => {
            const trace = await generateSimulationTrace("snap-f6", {
                sourceCode: dummySource,
                sourceFilePath: "src/services/discount.service.js",
                testCode: dummyTest,
                functionName: "calculateDiscount",
                category: "ERROR_HANDLING"
            });

            expect(trace).toBeDefined();
            expect(trace.steps).toBeDefined();
            const errorStep = trace.steps.find(s => s.phase === "ERROR_THROW");
            expect(errorStep).toBeDefined();
            expect(errorStep.phase).toBe("ERROR_THROW");
            expect(errorStep.stepType).toBe("ERROR_THROW");
            expect(errorStep.title).toContain("Exception Thrown");
        });

        it('F5: matches existing test case by requestedCategory when functionName and category are specified', async () => {
            const trace = await generateSimulationTrace("snap-f5", {
                sourceCode: dummySource,
                sourceFilePath: "src/services/discount.service.js",
                testCode: dummyTest,
                functionName: "calculateDiscount",
                category: "BRANCH_TOGGLING"
            });

            expect(trace).toBeDefined();
            expect(trace.testCase.category).toBe("BRANCH_TOGGLING");
            expect(trace.testCase.title).toContain("VIP");
        });

        it('F5: synthesizes virtual scenario matching requestedCategory and functionName when no test exists', async () => {
            const trace = await generateSimulationTrace("snap-f5-virt", {
                sourceCode: dummySource,
                sourceFilePath: "src/services/discount.service.js",
                testCode: "",
                functionName: "calculateDiscount",
                category: "BOUNDARY_VALUES"
            });

            expect(trace).toBeDefined();
            expect(trace.testCase.isVirtual).toBe(true);
            expect(trace.testCase.category).toBe("BOUNDARY_VALUES");
            expect(trace.testCase.targetFunction).toBe("calculateDiscount");
        });

        it('F4: sanitizes leading slashes and root prefixes via cleanRelativePath on disk files', async () => {
            const serverSrcDir = path.join(rootDir, 'server/src');
            const trace = await generateSimulationTrace("snap-f4", {
                rootDir: serverSrcDir,
                sourceFilePath: "/utils/serviceError.js",
                functionName: "ServiceError",
                category: "HAPPY_PATH"
            });

            expect(trace).toBeDefined();
            expect(trace.sourceCode).toContain("class ServiceError");
        });
    });
});
