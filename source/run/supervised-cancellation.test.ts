import { createSuite, createTestCase } from '../packages/engine/engine.entry-point.ts';
import { createDeterministicRunOrchestrator } from '../test-support/create-deterministic-run-orchestrator.ts';
import { createFakeSupervisedChildProcess } from '../test-support/fake-supervised-child-process.ts';
import { fakeWorkerPoolRuntimeDependencies } from '../test-support/worker-pool-runtime-fixtures.ts';
import { defaultRunConfig, defaultRunRequest, defaultMicrotestProfile } from '../test-support/run-command-factory.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { createSupervisedRunCommand } from './run-isolated-command.ts';
import { runSupervisedCommand } from './supervised-run.ts';
import { SupervisedCollectionError, supervisedCancellationMessage } from './run-errors.ts';
import type { RunOrchestrator } from './run-types.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
const file = 'source/integration-tests/run/fixtures/passing.test.ts';
const command = {
    config: defaultRunConfig(),
    cwd: process.cwd(),
    engine: { kind: 'default' },
    request: defaultRunRequest({ paths: [ file ] })
} as const;
const phases = [ 'startup', 'collection', 'resolution', 'active', 'draining', 'completed' ] as const;
type Phase = typeof phases[number];

async function cancelAt(phase: Phase): ReturnType<RunOrchestrator['run']> {
    const controller = new AbortController();
    const resolved = await createDeterministicRunOrchestrator().resolve(command);
    if (resolved.plan.kind !== 'supervised') {
        throw new Error('Expected supervised fixture collection.');
    }
    const { collectedPlan } = resolved.plan;
    const result = runResultFactory.build({
        perTest: resolved.facts.cases.map(function completedCase(testCase) {
            return { id: testCase.id, workId: testCase.workId, verdict: 'pass' };
        }),
        status: 'passed'
    });
    const child = createFakeSupervisedChildProcess({
        collect() {
            if (phase === 'collection') {
                controller.abort();
            }
            return { collectedPlan, runnerErrors: [] };
        },
        run(context) {
            const [ testCase ] = resolved.facts.cases;
            if (testCase === undefined) {
                throw new Error('Expected a selected fixture case.');
            }
            if (phase === 'active') {
                context.emitMessage({
                    kind: 'event',
                    event: {
                        kind: 'test-start',
                        attempt: 0,
                        case: testCase.id,
                        workId: testCase.workId,
                        definitionLocations: metadata.definitionLocations,
                        suitePath: []
                    }
                });
                controller.abort();
            }
            context.emitMessage({ kind: 'result', result });
            if (phase === 'draining') {
                controller.abort();
            }
            context.emitExit();
        }
    });
    const completion = await runSupervisedCommand(
        createSupervisedRunCommand(
            command,
            defaultMicrotestProfile(),
            [ { file, fileSet: null, href: `virtual:${file}`, path: file } ],
            { kind: 'configured-files' }
        ),
        {
            ...fakeWorkerPoolRuntimeDependencies(),
            async startSupervisedChild() {
                if (phase === 'startup') {
                    controller.abort();
                }
                return child;
            }
        },
        async function resolveCollectedRun() {
            if (phase === 'resolution') {
                controller.abort();
            }
            return resolved;
        },
        {
            coverage: null,
            signal: controller.signal,
            timing: null,
            async finalizeResult(_run, completed) {
                return completed;
            }
        }
    );
    controller.abort();
    return completion;
}

export const testNode = createSuite({
    ...metadata,
    title: 'supervised invocation cancellation',
    children: phases.map(function cancellationPhase(phase) {
        return createTestCase({
            ...metadata,
            title: `cancellation during ${phase} respects child completion`,
            async body(scope) {
                if (phase === 'startup' || phase === 'collection') {
                    await scope.assert.rejects(async function cancelCollection() {
                        return await cancelAt(phase);
                    }, { type: SupervisedCollectionError });
                } else {
                    const result = await cancelAt(phase);
                    scope.assert.equal(result.status, phase === 'completed' ? 'passed' : 'failed');
                    scope.assert.deepEqual(
                        result.runnerErrors.map(function cancellationDiagnostic(error) {
                            return { message: error.message, attribution: error.attributedTo, subtype: error.subtype };
                        }),
                        phase === 'completed' ? [] : [ {
                            message: supervisedCancellationMessage,
                            attribution: null,
                            subtype: 'crash'
                        } ]
                    );
                    if (phase === 'active') {
                        scope.assert.equal(result.summary.crashed, 1);
                    }
                }
                return scope.assert.collect();
            }
        });
    })
});
