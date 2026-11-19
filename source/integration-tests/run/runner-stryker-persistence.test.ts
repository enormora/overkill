import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, suite as authoredSuite } from '@overkill-dev/test';

import { adapterUrl, engineUrl, configUrl } from './stryker-lifecycle-fixture.test.ts';
import { executeMutationScript } from './stryker-script.test.ts';
import { strykerPersistenceScript } from './stryker-persistence-scripts.test.ts';

const modes = [
    { processModel: 'in-process', freshState: false },
    { processModel: 'in-process', freshState: true },
    { processModel: 'supervised-process', freshState: false }
];
export const testNode = authoredSuite(
    'Stryker diagnostic persistence',
    modes.flatMap(function executionMode(mode) {
        const persistenceModes = [ 'off', 'failures', 'all', 'blocked', 'failed-dry', 'blocked-dry' ];
        if (mode.processModel === 'supervised-process') {
            persistenceModes.push('timeout', 'blocked-timeout', 'forbidden-output');
        }
        return persistenceModes.map(function persistenceMode(persistence) {
            return test(
                `${mode.processModel} freshState ${String(mode.freshState)} ${persistence}`,
                async function (scope) {
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
            );
        });
    })
);
