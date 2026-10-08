import {
    createSuite,
    createTestCase,
    type TestScope
} from '../../packages/engine/engine.entry-point.ts';
import { createLineReporter } from '../../packages/reporter-line/reporter-line.entry-point.ts';
import { orchestrator } from '../../run/run-orchestrator.entry-point.ts';
import {
    defaultMicrotestProfile,
    defaultRunConfig,
    defaultRunRequest
} from '../../test-support/run-command-factory.ts';
import { runIfMain } from '../direct-launcher.test.ts';
import type { RunCommand, RunRequest } from '../../run/run-types.ts';
import type { TimeoutPolicy } from '../../config/types.ts';

const endlessLoopFixturePath = 'source/integration-tests/run/fixtures/endless-loop.test.ts';
const staggeredTimeoutFixturePath = 'source/integration-tests/run/fixtures/staggered-timeout.test.ts';
const emptyTestData = { annotations: {}, controls: {} } as const;

function supervisedRunCommand(
    paths: readonly string[],
    request: Partial<RunRequest>,
    timeouts: TimeoutPolicy
): RunCommand {
    return {
        config: defaultRunConfig({
            profiles: {
                microtest: defaultMicrotestProfile({
                    execution: {
                        maxConcurrency: 2,
                        processModel: 'supervised-process',
                        scheduling: 'concurrent'
                    },
                    timeouts
                })
            },
            reporters: []
        }),
        cwd: process.cwd(),
        engine: { kind: 'default' },
        request: defaultRunRequest({
            order: 'lexical',
            paths,
            ...request
        })
    };
}

function plainData(value: unknown): unknown {
    return structuredClone(value);
}

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/integration-tests/run/runner-supervised-timeouts.test.ts',
    ...emptyTestData,
    children: [
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'runner gives each admitted supervised microtest its full hard timeout',
            ...emptyTestData,
            async body(scope: TestScope) {
                const result = await orchestrator.run(supervisedRunCommand(
                    [ staggeredTimeoutFixturePath ],
                    { capabilityRestrictions: { mode: 'disabled' } },
                    {
                        collectionMilliseconds: 5000,
                        hardMilliseconds: 1000,
                        softMilliseconds: 900
                    }
                ));

                scope.assert.equal(result.status, 'passed', {
                    message: JSON.stringify(result.runnerErrors)
                });
                scope.assert.equal(result.summary.passed, 3);
                scope.assert.equal(result.summary.crashed, 0);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'runner kills a supervised microtest that blocks past hard timeout',
            ...emptyTestData,
            async body(scope: TestScope) {
                const result = await orchestrator.run(supervisedRunCommand(
                    [ endlessLoopFixturePath ],
                    {},
                    {
                        collectionMilliseconds: 5000,
                        hardMilliseconds: 50,
                        softMilliseconds: 10
                    }
                ));
                const error = result.runnerErrors[0];

                scope.require.defined(error);
                scope.assert.equal(error.subtype, 'crash');
                scope.assert.deepEqual(plainData(error.attributedTo), {
                    file: endlessLoopFixturePath,
                    title: 'loops',
                    params: null,
                    suite: []
                });
                scope.assert.deepEqual(result.summary, {
                    crashed: 1,
                    defined: 1,
                    discovered: 1,
                    failed: 0,
                    inconclusive: 0,
                    passed: 0,
                    planned: 1,
                    resourceExhausted: 0,
                    runtimePolicy: 0,
                    skipped: 0
                });

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testNode, [ createLineReporter() ]);
