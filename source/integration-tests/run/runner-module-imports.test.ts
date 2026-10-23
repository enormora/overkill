import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { suite, test, type TestScope } from '../../packages/test/test.entry-point.ts';
import { normalizeConfig, orchestrator, type RunCommand } from '../../packages/run/run.entry-point.ts';
import { createLineReporter } from '../../packages/reporter-line/reporter-line.entry-point.ts';
import { defaultRunRequest } from '../../test-support/run-command-factory.ts';
import { runIfMain } from '#test-runner';
import { assertModuleBenchmark, assertFailedTimeline } from './module-import-assertions.test.ts';

async function commandFor(
    scope: TestScope,
    boundary: 'fresh-worker-per-unit' | 'reuse' | 'supervised-process',
    filename: string
): Promise<RunCommand> {
    const directory = await mkdtemp(join(tmpdir(), 'overkill-module-'));
    scope.cleanup(async function () {
        await rm(directory, { recursive: true, force: true });
    });
    return {
        cwd: process.cwd(),
        engine: { kind: 'default' },
        request: defaultRunRequest({ profile: 'imports' }),
        config: normalizeConfig({
            runtimeStateDir: directory,
            profiles: {
                imports: {
                    testFamily: 'benchmark',
                    files: { include: [ filename ] },
                    execution: boundary === 'supervised-process'
                        ? { processModel: 'supervised-process' }
                        : { processModel: 'worker-pool', workerLifecycle: boundary }
                }
            }
        })
    };
}

const boundaries = [ 'reuse', 'fresh-worker-per-unit', 'supervised-process' ] as const;
export const testNode = suite(
    'cold module imports',
    [
        test('retains failed bodies, cleanup, and forced GC in a partial timeline', async function (scope: TestScope) {
            const command = await commandFor(
                scope,
                'reuse',
                'source/integration-tests/run/fixtures/timeline-failure.bench.test.ts'
            );
            assertFailedTimeline(scope, await orchestrator.bench.run(command, { timing: null }));
            return scope.assert.collect();
        }),
        ...boundaries.map(
            function boundary(value) {
                const selected = value;
                return test(`imports a fresh module graph with ${selected}`, async function (scope: TestScope) {
                    const command = await commandFor(
                        scope,
                        selected,
                        'source/integration-tests/run/fixtures/cold-import.bench.test.ts'
                    );
                    const listed = await orchestrator.bench.list(command, { timing: null });
                    if (listed.plan.kind === 'local') {
                        throw new Error('Expected isolated module plan.');
                    }
                    scope.assert.equal(
                        listed.plan.collectedPlan.files[0]?.cases[0]?.benchmark?.measurement.mode,
                        'module'
                    );
                    const result = await orchestrator.bench.run(command, { timing: null });
                    assertModuleBenchmark(scope, result);
                    return scope.assert.collect();
                });
            }
        )
    ]
);

await runIfMain(import.meta, testNode, { reporters: [ createLineReporter() ] });
