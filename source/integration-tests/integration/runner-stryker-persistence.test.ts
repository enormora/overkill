import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { table, type TestNode, suite } from '@overkill-dev/test';

import { adapterUrl, engineUrl, configUrl } from './support/stryker-lifecycle-fixture.ts';
import { executeMutationScript } from './support/stryker-script.ts';
import { strykerPersistenceScript } from './support/stryker-persistence-scripts.ts';

const modes = [
    { processModel: 'in-process', freshState: false },
    { processModel: 'in-process', freshState: true },
    { processModel: 'supervised-process', freshState: false }
];
const persistenceCases = modes.flatMap(function (mode) {
    const persistenceModes = [ 'off', 'failures', 'all', 'blocked', 'failed-dry', 'blocked-dry' ];
    if (mode.processModel === 'supervised-process') {
        persistenceModes.push('timeout', 'blocked-timeout', 'forbidden-output');
    }
    return persistenceModes.map(function (persistence) {
        return { mode, persistence };
    });
});
export const testNode: TestNode = suite('Stryker diagnostic persistence', [
    table({
        title: 'retains diagnostics across execution and persistence policies',
        cases: persistenceCases,
        caseTitle({ mode, persistence }) {
            return `${mode.processModel}, fresh state ${String(mode.freshState)}, ${persistence}`;
        },
        async test(scope) {
            const { mode, persistence } = scope.parameters;
            const cwd = await realpath(await mkdtemp(join(tmpdir(), 'overkill-stryker-persistence-')));
            scope.cleanup(async function removeProject() {
                await rm(cwd, { recursive: true, force: true });
            });
            const output = await executeMutationScript(strykerPersistenceScript, [
                adapterUrl,
                engineUrl,
                configUrl,
                import.meta.resolve('@stryker-mutator/instrumenter'),
                mode.processModel,
                String(mode.freshState),
                persistence
            ], cwd);
            scope.assert.equal(output, 'persistence passed\n');
            return scope.assert.collect();
        }
    })
]);
