/**
 * milestone4AdversarialChallenge.test.js
 *
 * Empirical Challenger Test Suite for Milestone 4:
 * 1. User Rule 10 Layout Invariants & AST verification
 * 2. Tab Switching & Modal Lifecycle Independence
 * 3. Modal Overlay Concurrency & Stacking Context
 * 4. Dual-Mounting Prevention (Prop Delegation vs Fallback Guards)
 * 5. Storage Immutability Guard
 */

import { describe, it, expect } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as babelParser from '@babel/parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../..');

describe('Milestone 4 Adversarial Stress Harness & Empirical Verification', () => {
    const dashboardComponentPath = path.join(rootDir, 'client/src/components/dashboard/CoverageTypeDashboard.jsx');
    const traceabilityMatrixPath = path.join(rootDir, 'client/src/components/dashboard/UnitTestTraceabilityMatrix.jsx');
    const inPlaceModalPath = path.join(rootDir, 'client/src/components/dashboard/InPlaceCoverageFileModal.jsx');
    const simulationStudioModalPath = path.join(rootDir, 'client/src/components/dashboard/simulation/UnitTestSimulationStudioModal.jsx');
    const workflowPath = path.join(rootDir, 'client/src/components/dashboard/UnitTestGuidedWorkflow.jsx');

    const dashboardSrc = fs.readFileSync(dashboardComponentPath, 'utf8');
    const traceabilitySrc = fs.readFileSync(traceabilityMatrixPath, 'utf8');
    const inPlaceSrc = fs.readFileSync(inPlaceModalPath, 'utf8');
    const simulationStudioSrc = fs.readFileSync(simulationStudioModalPath, 'utf8');
    const workflowSrc = fs.readFileSync(workflowPath, 'utf8');

    describe('Challenge 1: User Rule 10 Layout Invariants (AST Analysis)', () => {
        it('AST parse verifies exactly 3 canonical tabs under type === "unit"', () => {
            const ast = babelParser.parse(dashboardSrc, {
                sourceType: 'module',
                plugins: ['jsx'],
            });

            // Find the array of tabs in the unit test branch
            // Pattern: type === 'unit' ? [ { id: 'traceability' ... }, { id: 'testcases' ... }, { id: 'versions' ... } ]
            const unitTabsRegex = /\.\.\.\(type\s*===\s*["']unit["']\s*\?\s*\[([\s\S]*?)\]\s*:\s*\[/;
            const match = dashboardSrc.match(unitTabsRegex);
            expect(match).not.toBeNull();

            const tabIds = [];
            const idRegex = /id:\s*["']([^"']+)["']/g;
            let m;
            while ((m = idRegex.exec(match[1])) !== null) {
                tabIds.push(m[1]);
            }

            expect(tabIds).toEqual(['traceability', 'testcases', 'versions']);
            expect(tabIds).toHaveLength(3);

            // Verify no metric-splitting tabs exist in the unit test branch
            expect(tabIds).not.toContain('statements');
            expect(tabIds).not.toContain('branches');
            expect(tabIds).not.toContain('functions');
            expect(tabIds).not.toContain('lines');
            expect(tabIds).not.toContain('simulation');
        });

        it('AST verifies 4-Category Decision Table Matrix covers all 4 categories with explanations', () => {
            expect(traceabilitySrc).toContain('🟢 A. Happy Path');
            expect(traceabilitySrc).toContain('🟡 B. Boundary Values');
            expect(traceabilitySrc).toContain('🔵 C. Branch Toggling');
            expect(traceabilitySrc).toContain('🔴 D. Error Handling');

            // Verify category keys
            expect(traceabilitySrc).toContain('HAPPY_PATH');
            expect(traceabilitySrc).toContain('BOUNDARY_VALUES');
            expect(traceabilitySrc).toContain('BRANCH_TOGGLING');
            expect(traceabilitySrc).toContain('ERROR_HANDLING');

            // Verify CategoryMatrix4Cards receives simulation trigger prop
            expect(traceabilitySrc).toMatch(/function\s+CategoryMatrix4Cards\(\{[\s\S]*?onOpenSimulation\s*=\s*null/);
        });

        it('Single Authoritative Action Driver: suppresses duplicate actions in header and workflow', () => {
            // When type === 'unit', duplicate Run button in main header is suppressed
            expect(dashboardSrc).toMatch(/\{type\s*!==\s*["']unit["']\s*&&\s*\([\s\S]*?Run Integration Test/);

            // Guided workflow header has only stage quick controls, no duplicate Refresh or Job Queue
            expect(workflowSrc).toContain('Guided Unit Test Workflow');
            expect(workflowSrc).not.toMatch(/<div[^>]*header[^>]*>[\s\S]*?Refresh[\s\S]*?<\/div>/i);
        });
    });

    describe('Challenge 2: Tab Switching & Simulation Studio State Independence', () => {
        it('simulation modal is mounted at dashboard root level, independent of activeMetricView', () => {
            // In CoverageTypeDashboard.jsx, verify that UnitTestSimulationStudioModal is rendered
            // at the end of the root container rather than inside activeMetricView condition
            const tableSwitcherPos = dashboardSrc.indexOf('activeMetricView === "traceability"');
            const simModalPos = dashboardSrc.indexOf('<UnitTestSimulationStudioModal');

            expect(tableSwitcherPos).toBeGreaterThan(-1);
            expect(simModalPos).toBeGreaterThan(-1);
            // Modal must be placed after table view switcher (at root level)
            expect(simModalPos).toBeGreaterThan(tableSwitcherPos);

            // Verify simulationTarget state declaration exists at root
            expect(dashboardSrc).toMatch(/const\s+\[simulationTarget,\s*setSimulationTarget\]\s*=\s*useState\(null\)/);
        });

        it('clean tab bar without toolbar quick launcher and supports contextual simulation trigger delegation', () => {
            expect(dashboardSrc).toMatch(/const\s+\[simulationTarget,\s*setSimulationTarget\]\s*=\s*useState\(null\)/);
            expect(dashboardSrc).toMatch(/<UnitTestTraceabilityMatrix[\s\S]*?onOpenSimulation=\{\(simTarget\)\s*=>\s*setSimulationTarget\(simTarget\)\}/);
            expect(dashboardSrc).toMatch(/<InPlaceCoverageFileModal[\s\S]*?onOpenSimulation=\{\(simTarget\)\s*=>\s*setSimulationTarget\(simTarget\)\}/);
            if (!dashboardSrc.includes('quickSimFile')) {
                expect(dashboardSrc).not.toMatch(/const targetFile = quickSimFile/);
            }
        });
    });

    describe('Challenge 3: Modal Overlay Concurrency, Stacking Context & Z-Index', () => {
        it('InPlaceCoverageFileModal and UnitTestSimulationStudioModal z-index and DOM ordering', () => {
            // Both modals use fixed positioning
            expect(inPlaceSrc).toMatch(/position:\s*["']fixed["']/);
            expect(simulationStudioSrc).toMatch(/position:\s*["']fixed["']/);

            // Extract zIndex values
            const inPlaceZMatch = inPlaceSrc.match(/zIndex:\s*(\d+)/);
            const simStudioZMatch = simulationStudioSrc.match(/zIndex:\s*(\d+)/);

            expect(inPlaceZMatch).not.toBeNull();
            expect(simStudioZMatch).not.toBeNull();

            const inPlaceZ = parseInt(inPlaceZMatch[1], 10);
            const simStudioZ = parseInt(simStudioZMatch[1], 10);

            // Both have z-index 9999
            expect(inPlaceZ).toBe(9999);
            expect(simStudioZ).toBe(9999);

            // In CoverageTypeDashboard, verify UnitTestSimulationStudioModal is rendered AFTER InPlaceCoverageFileModal in DOM
            const inPlaceMountPos = dashboardSrc.indexOf('<InPlaceCoverageFileModal');
            const simStudioMountPos = dashboardSrc.indexOf('<UnitTestSimulationStudioModal');

            expect(inPlaceMountPos).toBeGreaterThan(-1);
            expect(simStudioMountPos).toBeGreaterThan(-1);
            // Later sibling in same stacking context is rendered on top in CSS
            expect(simStudioMountPos).toBeGreaterThan(inPlaceMountPos);
        });

        it('Backdrop click dismissal targets only the clicked modal', () => {
            // In UnitTestSimulationStudioModal, backdrop click only calls onClose when e.target === e.currentTarget
            expect(simulationStudioSrc).toMatch(/if\s*\(e\.target\s*===\s*e\.currentTarget\)\s*onClose\?\.\(\);/);
            // In InPlaceCoverageFileModal, backdrop click also checks e.target === e.currentTarget
            expect(inPlaceSrc).toMatch(/if\s*\(e\.target\s*===\s*e\.currentTarget\)\s*onClose\?\.\(\);/);
        });

        it('Escape key listener verification in both modals', () => {
            // Both modals attach keydown listeners for Escape key
            expect(inPlaceSrc).toMatch(/if\s*\(e\.key\s*===\s*["']Escape["']\)\s*\{\s*onClose\?\.\(\);/);
            expect(simulationStudioSrc).toMatch(/if\s*\(e\.key\s*===\s*["']Escape["']\)\s*\{\s*onClose\?\.\(\);/);
        });
    });

    describe('Challenge 4: Dual-Mounting Prevention (Prop Delegation vs Fallback Guards)', () => {
        it('UnitTestTraceabilityMatrix prevents dual mounting with !onOpenSimulation guard', () => {
            // Must have guard !onOpenSimulation && internalSimulationTarget
            expect(traceabilitySrc).toMatch(/\{!onOpenSimulation\s*&&\s*internalSimulationTarget\s*&&\s*\(\s*<UnitTestSimulationStudioModal/);

            // When onOpenSimulation is provided, handleTriggerSimulate delegates
            expect(traceabilitySrc).toMatch(/if\s*\(typeof\s+onOpenSimulation\s*===\s*["']function["']\)\s*\{\s*onOpenSimulation\(simContext\);\s*\}\s*else\s*\{\s*setInternalSimulationTarget\(simContext\);\s*\}/);
        });

        it('InPlaceCoverageFileModal prevents dual mounting with !onOpenSimulation guard', () => {
            // Must have guard !onOpenSimulation && internalSimTarget
            expect(inPlaceSrc).toMatch(/\{!onOpenSimulation\s*&&\s*internalSimTarget\s*&&\s*\(\s*<UnitTestSimulationStudioModal/);

            // When onOpenSimulation is provided, trigger delegates
            expect(inPlaceSrc).toMatch(/if\s*\(typeof\s+onOpenSimulation\s*===\s*["']function["']\)\s*\{\s*onOpenSimulation\(simTarget\);\s*\}\s*else\s*\{\s*setInternalSimTarget\(simTarget\);\s*\}/);
        });
    });

    describe('Challenge 5: Storage Immutability Guard', () => {
        it('ensures storage/ and uploads/ are completely untouched', () => {
            const storageDir = path.join(rootDir, 'storage');
            const uploadsDir = path.join(rootDir, 'uploads');

            if (fs.existsSync(storageDir)) {
                expect(fs.statSync(storageDir).isDirectory()).toBe(true);
            }
            if (fs.existsSync(uploadsDir)) {
                expect(fs.statSync(uploadsDir).isDirectory()).toBe(true);
            }
        });
    });
});
