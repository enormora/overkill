import { suite } from '@overkill-dev/test';

import { testNode as processExecution } from './run/process-execution.test.ts';
import { testNode as processLifetime } from './run/process-lifetime.test.ts';
import { testNode as processOwnerDeath } from './run/process-owner-death.test.ts';
import { testNode as runnerExternalProcess } from './run/runner-external-process.test.ts';
import { testNode as runnerModuleImports } from './run/runner-module-imports.test.ts';

export const testNode = suite('cross-platform process integration', [
    processExecution,
    processLifetime,
    processOwnerDeath,
    runnerExternalProcess,
    runnerModuleImports
]);
