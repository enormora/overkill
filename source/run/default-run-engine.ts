import * as publicEngine from '../packages/engine/engine.entry-point.ts';
import type { Engine } from '../engine/engine.ts';

export const defaultRunEngine: Engine = {
    createRoot: publicEngine.createRoot,
    createSuite: publicEngine.createSuite,
    createTable: publicEngine.createTable,
    createTestCase: publicEngine.createTestCase,
    createTestPlan: publicEngine.createTestPlan,
    createTestPlanFromTestFiles: publicEngine.createTestPlanFromTestFiles,
    execute: publicEngine.execute,
    formatCaseId: publicEngine.formatCaseId,
    ownsTestNode: publicEngine.ownsTestNode,
    runIfMain: publicEngine.runIfMain
};
