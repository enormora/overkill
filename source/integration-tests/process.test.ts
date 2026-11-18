import { runIfMain } from '#test-runner';
import { createSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as processExecution } from './run/process-execution.test.ts';
import { testNode as processLifetime } from './run/process-lifetime.test.ts';
import { testNode as processOwnerDeath } from './run/process-owner-death.test.ts';
import { testNode as runnerExternalProcess } from './run/runner-external-process.test.ts';
import { testNode as runnerModuleImports } from './run/runner-module-imports.test.ts';

export const testNode = createSuite({
    title: 'cross-platform process integration',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [ processExecution, processLifetime, processOwnerDeath, runnerExternalProcess, runnerModuleImports ]
});

await runIfMain(import.meta, testNode);
