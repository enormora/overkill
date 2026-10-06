import { createSuite, createTestCase, type RunResult, type TestScope } from '../packages/engine/engine.entry-point.ts';
import { createFakeSupervisedChildProcess } from '../test-support/fake-supervised-child-process.ts';
import { fakeWorkerPoolRuntimeDependencies } from '../test-support/worker-pool-runtime-fixtures.ts';
import { createDeterministicRunOrchestrator } from '../test-support/create-deterministic-run-orchestrator.ts';
import { defaultRunConfig, defaultRunRequest, defaultMicrotestProfile } from '../test-support/run-command-factory.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { createSupervisedRunCommand } from './run-isolated-command.ts';
import { runSupervisedCommand } from './supervised-run.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
const file = 'source/integration-tests/run/fixtures/passing.test.ts';
const profile = defaultMicrotestProfile();
const command = {
    config: defaultRunConfig(),
    cwd: process.cwd(),
    engine: { kind: 'default' },
    request: defaultRunRequest({ paths: [ file ] })
} as const;
const supervisedCommand = createSupervisedRunCommand(
    command,
    profile,
    [ { file, fileSet: null, href: `virtual:${file}`, path: file } ],
    { kind: 'configured-files' }
);
const collectionError = {
    attributedTo: null,
    attributedToAttempt: null,
    attributedToWork: null,
    cause: null,
    diagnostics: [],
    message: 'Collection failed before planning.',
    subtype: 'loader'
} as const;
const phases = [ 'before-collection', 'active-attempt', 'missing-results', 'collection-error' ] as const;
type Phase = typeof phases[number] | 'collection-timing';

async function executeProtocolPhase(phase: Phase): Promise<RunResult> {
    const resolved = await createDeterministicRunOrchestrator().resolve(command);
    if (resolved.plan.kind === 'local') {
        throw new Error('Expected a supervised plan.');
    }
    const { collectedPlan } = resolved.plan;
    const result = runResultFactory.build({
        perTest: resolved.facts.cases.map(function completedCase(testCase) {
            return { id: testCase.id, workId: testCase.workId, verdict: 'pass' };
        }),
        status: 'passed'
    });
    const child = createFakeSupervisedChildProcess({
        collect(input) {
            if (phase === 'before-collection') {
                input.emitMessage({ kind: 'result', result });
            } else if (phase === 'collection-error') {
                input.emitMessage({ kind: 'event', event: { kind: 'runner-error', error: collectionError } });
            } else if (phase === 'collection-timing') {
                input.emitMessage({
                    kind: 'timing',
                    span: {
                        kind: 'collection.import',
                        durationMicroseconds: 1,
                        label: null,
                        processId: null,
                        resource: null,
                        startOffsetMicroseconds: null,
                        startTimeUnixMicroseconds: 0,
                        status: 'success',
                        workerId: null
                    }
                });
            }
            return { collectedPlan, runnerErrors: [] };
        },
        run(context) {
            if (phase === 'active-attempt') {
                context.emitMessage({
                    kind: 'event',
                    event: {
                        kind: 'test-start',
                        attempt: 0,
                        case: result.perTest[0]?.id ?? { file, params: null, suite: [], title: 'missing' },
                        definitionLocations: metadata.definitionLocations,
                        suitePath: []
                    }
                });
            }
            context.emitMessage({
                kind: 'result',
                result: phase === 'missing-results' ? { ...result, perTest: [] } : result
            });
            context.emitExit();
        }
    });
    return await runSupervisedCommand(
        supervisedCommand,
        {
            ...fakeWorkerPoolRuntimeDependencies(),
            async startSupervisedChild() {
                return child;
            }
        },
        async function resolveCollectedRun() {
            return resolved;
        },
        {
            coverage: null,
            timing: null,
            async finalizeResult(_run, completed) {
                return completed;
            }
        }
    );
}

async function assertProtocolOrder(scope: TestScope, phase: Phase): Promise<void> {
    if (phase === 'before-collection') {
        await scope.assert.rejects(async function rejectPrematureResult() {
            return await executeProtocolPhase(phase);
        }, { message: 'Invalid supervised child IPC lifecycle.' });
    } else {
        const completed = await executeProtocolPhase(phase);
        scope.assert.equal(completed.status, 'failed');
        const error = completed.runnerErrors[0];
        scope.require.defined(error);
        scope.assert.equal(
            error.subtype,
            phase === 'collection-error' ? 'loader' : 'runtime-policy'
        );
        scope.assert.equal(error.attributedTo, null);
        if (phase === 'active-attempt') {
            scope.assert.equal(completed.perTest[0]?.verdict, 'crashed');
        }
    }
}

export const testNode = createSuite({
    ...metadata,
    title: 'supervised child protocol order',
    children: [
        ...phases.map(function protocolPhase(phase) {
            return createTestCase({
                ...metadata,
                title: `validates child messages during ${phase}`,
                async body(scope: TestScope) {
                    await assertProtocolOrder(scope, phase);
                    return scope.assert.collect();
                }
            });
        }),
        createTestCase({
            ...metadata,
            title: 'collection timings remain valid when parent timing collection is absent',
            async body(scope) {
                const completed = await executeProtocolPhase('collection-timing');
                scope.assert.equal(completed.status, 'passed');
                scope.assert.deepEqual(completed.runnerErrors, []);
                return scope.assert.collect();
            }
        })
    ]
});
const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
