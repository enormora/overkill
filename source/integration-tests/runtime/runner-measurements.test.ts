import type { CompositeAssertionReturn } from '@overkill-dev/test/assert';
import { type CompositeCheckBuilder } from '@overkill-dev/test/assert';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { table, suite } from '@overkill-dev/test';

import { defineReporter, type ReporterEvent } from '../../packages/engine/engine.entry-point.ts';

import {
    normalizeConfig,
    orchestrator,
    type BenchmarkExecution,
    type RunCommand
} from '../../packages/run/run.entry-point.ts';
import { defaultRunRequest } from '../../test-support/run-command-factory.ts';
import { artifactReferenceKey } from '../../engine/run-artifact.ts';

const fixture = 'source/integration-tests/runtime/fixtures/measurement.bench.test.ts';
const lifecycleFile = 'target/measurement-lifecycle.txt';

const executions: readonly BenchmarkExecution[] = [
    { processModel: 'supervised-process', maxConcurrency: 1, scheduling: 'serial' },
    {
        assignmentPolicy: 'case-count-balanced',
        dispatchPolicy: 'dynamic-lease',
        hedging: { mode: 'off' },
        hostProcess: { kind: 'direct' },
        maxConcurrency: 1,
        maxWorkers: 2,
        processModel: 'worker-pool',
        scheduling: 'serial',
        workDistribution: { mode: 'case' },
        workerLifecycle: 'reuse'
    }
];

function measurementCommand(
    execution: BenchmarkExecution,
    directory: string,
    record: (event: ReporterEvent) => void
): RunCommand {
    const reporter = defineReporter(function () {
        return {
            dispose: null,
            kind: 'real-time',
            name: 'measurement-observer',
            onFinish: null,
            sinks: [ { kind: 'memory' } ],
            onEvent(event) {
                record(event);
            }
        };
    });
    const config = normalizeConfig({
        profiles: { measurements: { testFamily: 'benchmark', files: { include: [ fixture ] } } },
        reporters: [ reporter ],
        runtimeStateDir: directory
    });
    const profile = config.profiles.measurements;
    if (profile?.testFamily !== 'benchmark') {
        throw new Error('Missing benchmark profile.');
    }
    return {
        config: { ...config, profiles: { measurements: { ...profile, execution } } },
        cwd: process.cwd(),
        engine: { kind: 'default' },
        request: defaultRunRequest({ profile: 'measurements', order: 'lexical' })
    };
}

const listedMeasurementsChecks = async (
    check: CompositeCheckBuilder<'assert'>,
    command: RunCommand,
    events: readonly ReporterEvent[]
): Promise<CompositeAssertionReturn<'assert'>> => {
    const listed = await orchestrator.bench.list(command, { timing: null });
    return check.group([
        check.equal(listed.facts.cases.length, 4),
        check.deepEqual(await readdir(command.config.runtimeStateDir), []),
        check.equal(events.length, 0),
        await check.rejects(async function () {
            return readFile(lifecycleFile);
        }, { code: 'ENOENT' })
    ]);
};

const measurementLifecycleChecks = async (
    check: CompositeCheckBuilder<'assert'>
): Promise<CompositeAssertionReturn<'assert'>> => {
    const lifecycleText = await readFile(lifecycleFile, 'utf8');
    const lifecycle = lifecycleText.trim().split('\n').toSorted(function (left, right) {
        return left.localeCompare(right);
    });
    return check.group([ check.deepEqual(lifecycle, [ 'acquire:1', 'acquire:2', 'dispose:1', 'dispose:2' ]) ]);
};

const invocationEvidenceChecks = (
    check: CompositeCheckBuilder<'assert'>,
    test: Awaited<ReturnType<typeof orchestrator.bench.run>>['perTest'][number]
): CompositeAssertionReturn<'assert'> => {
    const measurement = test.benchmark?.lifecycle?.measurement;
    if (measurement === undefined || measurement === null) {
        return check.defined(measurement);
    }
    return check.group([
        check.equal(measurement.invocations.length, 160),
        check.equal(measurement.omitted, 0),
        check.true(measurement.invocations.every(function attributedInvocation(entry) {
            return entry.status === 'complete' && entry.invocation.attempt.index === 0 &&
                JSON.stringify(entry.invocation.work) === JSON.stringify(test.workId);
        }))
    ]);
};

const warmupEvidenceChecks = (
    check: CompositeCheckBuilder<'assert'>,
    result: Awaited<ReturnType<typeof orchestrator.bench.run>>
): CompositeAssertionReturn<'assert'> => {
    const [ firstCheck, ...remainingChecks ] = result.perTest.map((test) => {
        const lifecycle = test.benchmark?.lifecycle;
        if (lifecycle === undefined || lifecycle === null) {
            return check.defined(lifecycle);
        }
        const initialChecks = check.group([
            check.defined(lifecycle),
            check.equal(lifecycle.warmup.samples, 32),
            invocationEvidenceChecks(check.annotated('invocation evidence'), test),
            check.equal(lifecycle.warmup.rawSamples.status, 'recorded'),
            check.deepEqual(lifecycle.cleanup, { callbacks: 160, failures: 0 })
        ]);
        const artifact = result.artifacts.find(function warmupArtifact(candidate) {
            return artifactReferenceKey(candidate.id) ===
                artifactReferenceKey(JSON.parse(lifecycle.warmup.rawSamples.reference ?? 'null'));
        });
        if (artifact === undefined || artifact === null) {
            return check.group([ initialChecks, check.defined(artifact) ]);
        }
        return check.group([
            initialChecks,
            check.defined(artifact),
            check.partialDeepEqual(artifact.payload, {
                kind: 'runtime-attachment',
                name: 'benchmark-warmup-samples'
            })
        ]);
    });
    if (firstCheck === undefined) {
        throw new Error('Expected at least one recorded check.');
    }
    return check.group([ firstCheck, ...remainingChecks ]);
};

const measurementProgressChecks = (
    check: CompositeCheckBuilder<'assert'>,
    events: readonly ReporterEvent[]
): CompositeAssertionReturn<'assert'> => {
    return check.group([
        check.equal(
            events
                .filter(function (event) {
                    return event.kind === 'benchmark-progress';
                })
                .length,
            16
        ),
        check.equal(
            events
                .filter(function (event) {
                    return event.kind === 'test-end' && event.benchmark?.status === 'complete';
                })
                .length,
            4
        )
    ]);
};

const assertMeasurements = defineCompositeAssertion({
    name: 'measurements',
    async assert(check, command: RunCommand, events: readonly ReporterEvent[]) {
        const initialChecks = await listedMeasurementsChecks(check.annotated('listed measurements'), command, events);
        const result = await orchestrator.bench.run(command, { timing: null });
        return check.group([
            initialChecks,
            check.equal(result.summary.passed, 4),
            check.deepEqual(result.runnerErrors, []),
            check.true(
                result.perTest.every(function (entry) {
                    return entry.benchmark?.samples === 128 && entry.attempts[0].benchmark?.status === 'complete';
                })
            ),
            check.true(result.perTest.every(function (entry) {
                return entry.benchmark?.rawSamples.status === 'recorded';
            })),
            check.equal(
                result
                    .artifacts
                    .filter(function (artifact) {
                        return artifact.payload.kind === 'runtime-attachment' &&
                            artifact.payload.name === 'benchmark-samples';
                    })
                    .length,
                4
            ),
            measurementProgressChecks(check.annotated('measurement progress'), events),
            warmupEvidenceChecks(check.annotated('warmup evidence'), result),
            await measurementLifecycleChecks(check.annotated('measurement lifecycle'))
        ]);
    }
});

export const testNode = suite(
    'measurement runner integration',
    [ table({
        title: 'retains measurements across execution boundaries',
        cases: executions,
        caseTitle(execution) {
            return execution.processModel;
        },
        async test(scope) {
            const directory = await mkdtemp(join(tmpdir(), 'overkill-measurement-'));
            const events: ReporterEvent[] = [];
            const command = measurementCommand(scope.parameters, directory, function (event) {
                events.push(event);
            });
            await mkdir('target', { recursive: true });
            await rm(lifecycleFile, { force: true });
            try {
                await scope.assert(assertMeasurements, command, events);
                return scope.assert.collect();
            } finally {
                await rm(lifecycleFile, { force: true });
                await rm(directory, { recursive: true, force: true });
            }
        }
    }) ]
);
