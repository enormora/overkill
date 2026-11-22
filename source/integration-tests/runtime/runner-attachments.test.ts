import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import {
    type CompositeAssertionReturn,
    type CompositeCheckBuilder,
    defineCompositeAssertion
} from '@overkill-dev/test/assert';

import { table, suite } from '@overkill-dev/test';
import { executionTitle } from '../../test-support/execution-profile-title.ts';

import {
    defineReporter,
    type RunResult,
    type RunArtifact,
    type ReporterEvent
} from '../../packages/engine/engine.entry-point.ts';

import { orchestrator } from '../../run/run-orchestrator.entry-point.ts';
import type { IntegrationExecution } from '../../config/types.ts';
import {
    defaultIntegrationProfile,
    defaultRunConfig,
    defaultRunRequest
} from '../../test-support/run-command-factory.ts';

const fixture = 'source/integration-tests/runtime/fixtures/runtime-attachments.test.ts';
const failureFixture = 'source/integration-tests/runtime/fixtures/integration-failure-artifacts.test.ts';

const workerExecution: IntegrationExecution = {
    assignmentPolicy: 'case-count-balanced',
    dispatchPolicy: 'dynamic-lease',
    hedging: { mode: 'off' },
    hostProcess: { kind: 'direct' },
    maxConcurrency: 1,
    maxWorkers: 1,
    processModel: 'worker-pool',
    scheduling: 'serial',
    workDistribution: { mode: 'case' },
    workerLifecycle: 'reuse'
};
const executions: readonly IntegrationExecution[] = [
    { maxConcurrency: 1, processModel: 'supervised-process', scheduling: 'serial' },
    workerExecution,
    { ...workerExecution, workerLifecycle: 'fresh-worker-per-unit' },
    { ...workerExecution, hostProcess: { kind: 'child', nodeArguments: [] } }
];

async function runAttachmentFixture(
    execution: IntegrationExecution,
    runtimeStateDir: string,
    file: string
): Promise<{ readonly result: RunResult; readonly events: readonly ReporterEvent[]; }> {
    const events: ReporterEvent[] = [];
    const reporter = defineReporter(function createAttachmentObserver() {
        return {
            dispose: null,
            kind: 'real-time',
            name: 'attachment-observer',
            onEvent(event: ReporterEvent) {
                events.push(event);
            },
            onFinish: null,
            sinks: [ { kind: 'memory' } ]
        };
    });
    const result = await orchestrator.run({
        config: defaultRunConfig({
            profiles: {
                integration: defaultIntegrationProfile({
                    execution,
                    files: { include: [ file ], exclude: [] }
                })
            },
            reporters: [ reporter ],
            runtimeStateDir
        }),
        cwd: process.cwd(),
        engine: { kind: 'default' },
        request: defaultRunRequest({ profile: 'integration', paths: [ file ], order: 'lexical' })
    });
    return { events, result };
}

const assertAttemptArtifacts = defineCompositeAssertion({
    name: 'attempt artifacts',
    async assert(check, artifacts: readonly RunArtifact[]) {
        const [ firstLoopCheck, ...remainingLoopChecks ] = await Promise.all(artifacts.map(async function (artifact) {
            const initialChecksBeforeNextAction = check.equal(artifact.id.scope.kind, 'case');
            if (artifact.id.attempt === null) {
                return check.group([ initialChecksBeforeNextAction, check.defined(artifact.id.attempt) ]);
            }
            const intermediateChecks = check.group([
                check.defined(artifact.id.attempt),
                check.deepEqual(artifact.id.attempt, { index: 0 })
            ]);
            if (artifact.payload.kind === 'runtime-attachment' && artifact.payload.name === 'service-file') {
                const { content } = artifact.payload;
                if (content.kind !== 'file') {
                    throw new Error('Expected retained service file.');
                }
                return check.group([
                    initialChecksBeforeNextAction,
                    intermediateChecks,
                    check.equal(
                        await readFile(path.resolve(content.path), 'utf8'),
                        'retained after teardown'
                    )
                ]);
            }
            return check.group([ initialChecksBeforeNextAction, intermediateChecks ]);
        }));
        if (firstLoopCheck === undefined) {
            throw new Error('Expected at least one recorded check.');
        }
        const initialChecksBeforeNextAction = check.group([ firstLoopCheck, ...remainingLoopChecks ]);
        return initialChecksBeforeNextAction;
    }
});

const assertRecordExists = defineCompositeAssertion({
    name: 'record exists',
    async assert(check, runtimeStateDir: string) {
        const recordNames = await readdir(path.join(runtimeStateDir, 'runs'));
        const records = recordNames.filter(function recordFile(name) {
            return name.endsWith('.json');
        });
        return check.true(records.length > 0);
    }
});

const assertReportedAttachments = defineCompositeAssertion({
    name: 'reported attachments',
    assert(check, artifacts: readonly RunArtifact[], events: readonly ReporterEvent[]) {
        const initialChecks = check.equal(artifacts.length, 7);
        const completion = events.find(function completedCase(event) {
            return event.kind === 'test-end';
        });
        if (completion === undefined) {
            return check.group([ initialChecks, check.defined(completion) ]);
        }
        return check.group([ initialChecks, check.defined(completion), check.equal(completion.artifacts.length, 7) ]);
    }
});

const witnessEvidenceChecks = async function (
    check: CompositeCheckBuilder<'assert'>,
    artifact: RunArtifact
): Promise<CompositeAssertionReturn<'assert'>> {
    if (artifact.payload.kind !== 'runtime-attachment' || artifact.payload.content.kind !== 'file') {
        throw new Error('Expected witness file.');
    }
    const witness: unknown = JSON.parse(await readFile(path.resolve(artifact.payload.content.path), 'utf8'));
    return check.group([
        check.partialDeepEqual(witness, { version: 1, kind: 'simulation', seed: null, scenario: 'default' }),
        check.true(artifact.payload.content.path.includes('witnesses/'))
    ]);
};
const failureArtifactChecks = async function (
    check: CompositeCheckBuilder<'assert'>,
    artifact: RunArtifact
): Promise<CompositeAssertionReturn<'assert'>> {
    if (artifact.payload.kind !== 'runtime-attachment') {
        throw new Error('Expected failure artifact.');
    }
    const owner = [ 'attempt', 'lifetime' ].includes(artifact.payload.name)
        ? check.deepEqual(artifact.payload.content, { kind: 'json', value: { secret: 'owner-only' }, byteLength: 23 })
        : null;
    const witness = artifact.payload.content.kind === 'file' ? await witnessEvidenceChecks(check, artifact) : null;
    return check.group([
        check.equal(artifact.payload.capture, 'automatic'),
        ...owner === null ? [] : [ owner ],
        ...witness === null ? [] : [ witness ]
    ]);
};
const assertFailureEvidence = defineCompositeAssertion({
    name: 'failure artifacts',
    async assert(check, artifacts: readonly RunArtifact[]) {
        const names = artifacts
            .map(function artifactName(artifact) {
                return artifact.payload.kind === 'runtime-attachment' ? artifact.payload.name : '';
            })
            .toSorted(function (left, right) {
                return left.localeCompare(right);
            });
        const observed = await Promise.all(artifacts.map(async function artifactChecks(artifact) {
            return await failureArtifactChecks(check, artifact);
        }));
        return check.group([
            check.deepEqual(names, [
                'attempt',
                'http-transcript',
                'lifetime',
                'scenario-witness',
                'stderr',
                'stdout'
            ]),
            ...observed
        ]);
    }
});

const assertCrashEvidence = defineCompositeAssertion({
    name: 'crash evidence',
    async assert(check, execution: IntegrationExecution, index: number) {
        const { result } = await runAttachmentFixture(
            execution,
            `target/failure-artifact-crash-${index}`,
            'source/integration-tests/runtime/fixtures/integration-artifact-crash.test.ts'
        );
        const initialChecks = check.equal(result.status, 'failed');
        const artifact = result.artifacts.find(function capturedPrefix(entry) {
            return entry.payload.kind === 'runtime-attachment' && entry.payload.name === 'http-transcript';
        });
        if (artifact?.payload.kind !== 'runtime-attachment' || artifact.payload.content.kind !== 'text') {
            throw new Error('Owner crash must retain the checkpointed HTTP transcript prefix.');
        }
        return check.group([
            initialChecks,
            check.true(artifact.payload.content.text.includes(Buffer.from('{"ready":true}').toString('base64'))),
            check.deepEqual(artifact.payload.content.completion, { kind: 'incomplete', reason: 'interrupted' })
        ]);
    }
});

export const testNode = suite('Runner attachments', [
    table({
        title: 'retains attachments across execution boundaries',
        cases: executions.map(function executionTest(execution, index) {
            return { execution, index };
        }),
        caseTitle({ execution }) {
            return executionTitle(execution);
        },
        async test(scope) {
            const { execution, index } = scope.parameters;

            const runtimeStateDir = `target/attachment-integration-${index}`;
            const { events, result } = await runAttachmentFixture(execution, runtimeStateDir, fixture);
            scope.assert.equal(result.status, 'passed', { message: JSON.stringify(result.runnerErrors) });
            const artifacts = result.artifacts.filter(function runtimeArtifact(artifact) {
                return artifact.payload.kind === 'runtime-attachment';
            });
            scope.assert(assertReportedAttachments, artifacts, events);
            await scope.assert(assertAttemptArtifacts, artifacts);
            await scope.assert(assertRecordExists, runtimeStateDir);
            return scope.assert.collect();
        }
    }),
    table({
        title: 'captures failed resource evidence across execution boundaries',
        cases: executions.map(function failureExecutionTest(execution, index) {
            return { execution, index };
        }),
        caseTitle({ execution }) {
            return executionTitle(execution);
        },
        async test(scope) {
            const { execution, index } = scope.parameters;

            const { result } = await runAttachmentFixture(
                execution,
                `target/failure-artifact-integration-${index}`,
                failureFixture
            );
            scope.assert.equal(result.status, 'failed');
            scope.assert.deepEqual(result.runnerErrors, []);
            const artifacts = result.artifacts.filter(function evidenceArtifact(artifact) {
                return artifact.payload.kind === 'runtime-attachment';
            });
            scope.assert.equal(artifacts.length, 6, { message: JSON.stringify(result) });
            await scope.assert(assertFailureEvidence, artifacts);
            return scope.assert.collect();
        }
    }),
    table({
        title: 'retains checkpointed HTTP prefixes after owner crashes',
        cases: executions.map(function crashExecutionTest(execution, index) {
            return { execution, index };
        }),
        caseTitle({ execution }) {
            return executionTitle(execution);
        },
        async test(scope) {
            const { execution, index } = scope.parameters;

            await scope.assert(assertCrashEvidence, execution, index);
            return scope.assert.collect();
        }
    })
]);
