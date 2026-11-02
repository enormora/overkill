import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { normalizeConfig, orchestrator, type RunCommand } from '../packages/run/run.entry-point.ts';
import { defaultRunRequest } from '../test-support/run-command-factory.ts';

async function corpusCommand(scope: TestScope, processModel: 'in-process' | 'supervised-process'): Promise<RunCommand> {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'overkill-corpus-run-'));
    scope.cleanup(async function removeState() {
        await rm(directory, { recursive: true, force: true });
    });
    const fixture = 'source/integration-tests/run/fixtures/property-regression.test.ts';
    return {
        config: {
            ...normalizeConfig({
                runtimeStateDir: directory,
                profiles: {
                    laws: {
                        testFamily: 'property',
                        files: { include: [ fixture ] },
                        execution: { processModel, scheduling: 'serial' },
                        timeouts: { collectionMilliseconds: 10_000, softMilliseconds: 5000, hardMilliseconds: 10_000 }
                    }
                }
            }),
            reporters: []
        },
        cwd: process.cwd(),
        engine: { kind: 'default' },
        request: defaultRunRequest({ profile: 'laws', paths: [ fixture ], order: 'plan' })
    };
}

function shrinkStatus(result: Awaited<ReturnType<typeof orchestrator.run>>): string | null {
    return result.perTest[0]?.property?.invocations[0]?.shrinkStatus ?? null;
}

export const testNode = suite(
    'runner property corpus',
    ([ 'in-process', 'supervised-process' ] as const).map(function processExecution(processModel) {
        return test(`${processModel} saves and replays confirmed failures`, async function (scope) {
            const command = await corpusCommand(scope, processModel);
            const first = await orchestrator.run(command);
            const replay = await orchestrator.run(command);
            scope.assert.deepEqual(first.runnerErrors, []);
            scope.assert.deepEqual(replay.runnerErrors, []);
            scope.assert.equal(first.summary.failed, 1);
            scope.assert.equal(replay.summary.failed, 1);
            scope.assert.equal(shrinkStatus(first), 'search-exhausted');
            scope.assert.equal(shrinkStatus(replay), 'shrink-state-unavailable');
            return scope.assert.collect();
        });
    })
);
await runIfMain(import.meta, testNode);
