import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { attachmentFixture, attachmentWork, type AttachmentFixture } from '../test-support/attachment-fixture.ts';
import { defaultAttachmentLimits } from '../engine/runtime-attachment.ts';
import { runWithAttachmentExecution } from '../run/resource-lifecycle-state.ts';
import { timelineMeasurement } from './timeline-measurement.ts';
import { withBenchmarkTimeline } from './timeline-execution.ts';
import { timelineContext } from './timeline-context.ts';
import { createProcessSamplingSession, type ProcessSamplingSession } from './process-sampling.ts';
import { processMeasurement } from './process-measurement.ts';
import { benchmarkTimelineReportSchema } from './timeline-schema.ts';

type ProcessTimelineOperation = (processes: ProcessSamplingSession) => Promise<void>;

async function captureProcessTimeline(
    scope: TestScope,
    operation: ProcessTimelineOperation,
    instrumentation: 'node' | 'off'
): Promise<AttachmentFixture> {
    const fixture = await attachmentFixture(scope, defaultAttachmentLimits);
    await runWithAttachmentExecution(fixture.execution, async function ownedRun() {
        await fixture.execution.runAttempt(attachmentWork, { index: 0 }, async function attempt() {
            await withBenchmarkTimeline(
                timelineMeasurement(processMeasurement({ instrumentation }), {
                    maximumEvents: 128
                }),
                async function recordProcess() {
                    const processes = createProcessSamplingSession(
                        processMeasurement({ instrumentation }),
                        scope.signal
                    );
                    await using disposal = new AsyncDisposableStack();
                    disposal.defer(processes.dispose);
                    timelineContext.getStore()?.invocation('measured', 0);
                    await operation(processes);
                    await disposal.disposeAsync();
                    await timelineContext.getStore()?.retain();
                }
            );
        });
    });
    return fixture;
}

function helperEvents(fixture: AttachmentFixture): readonly string[] {
    const artifact = fixture.store.artifacts().find(function timelineArtifact(candidate) {
        return candidate.payload.name === 'benchmark-timeline';
    });
    if (artifact?.payload.content.kind !== 'json') {
        throw new Error('Expected retained process timeline.');
    }
    const report = benchmarkTimelineReportSchema.parse(artifact.payload.content.value);
    return report
        .events
        .filter(function helperClock(event) {
            return event.clockDomain.startsWith('process:');
        })
        .map(function eventIdentity(event) {
            return `${event.clockDomain}/${event.name}/${event.outcome}`;
        });
}

export const testNode = suite('process timeline checkpoints', [
    test('retains Node telemetry at a ready checkpoint before child shutdown', async function (scope: TestScope) {
        const fixture = await captureProcessTimeline(scope, async function readyCheckpoint(processes) {
            const sample = processes.sample('measured');
            await using disposal = new AsyncDisposableStack();
            disposal.defer(sample.dispose);
            const result = await sample.sample.process({
                command: [ process.execPath, '-e', "process.stdout.write('ready>'); setInterval(() => {}, 100);" ],
                cwd: process.cwd(),
                env: null,
                io: { kind: 'pipes' },
                completion: { kind: 'ready', marker: { stream: 'stdout', text: 'ready>' } }
            });
            scope.assert.equal(result.value.completion.kind, 'ready');
            scope.assert.equal(result.metrics.startupMilliseconds.availability, 'available');
            scope.assert.equal(result.metrics.processCpuTotalMicroseconds.availability, 'available');
            sample.ensureMeasured();
        }, 'node');
        scope.assert.deepEqual(helperEvents(fixture), [ 'process:measured:0/readiness/complete' ]);
        scope.assert.deepEqual(await fixture.execution.finish(), []);
        return scope.assert.collect();
    }),
    test('retains readiness and named interactions on the helper clock', async function (scope: TestScope) {
        const fixture = await captureProcessTimeline(scope, async function interact(processes) {
            const sample = processes.sample('measured');
            await using disposal = new AsyncDisposableStack();
            disposal.defer(sample.dispose);
            await sample.sample.process({
                command: [
                    process.execPath,
                    '-e',
                    "process.stdout.write('ready>'); process.stdin.once('data', () => process.stdout.write('done>'));"
                ],
                cwd: process.cwd(),
                env: null,
                io: { kind: 'pipes' },
                completion: {
                    kind: 'interaction',
                    readiness: { stream: 'stdout', text: 'ready>' },
                    steps: [ {
                        kind: 'interaction',
                        name: 'roundtrip',
                        input: 'go\n',
                        marker: { stream: 'stdout', text: 'done>' }
                    } ]
                }
            });
            sample.ensureMeasured();
        }, 'off');
        scope.assert.deepEqual(helperEvents(fixture), [
            'process:measured:0/readiness/complete',
            'process:measured:0/interaction:roundtrip/complete'
        ]);
        scope.assert.deepEqual(await fixture.execution.finish(), []);
        return scope.assert.collect();
    }),
    test('retains the selected exit checkpoint on the helper clock', async function (scope: TestScope) {
        const fixture = await captureProcessTimeline(scope, async function exit(processes) {
            const sample = processes.sample('measured');
            await using disposal = new AsyncDisposableStack();
            disposal.defer(sample.dispose);
            const result = await sample.sample.process({
                command: [ process.execPath, '-e', "process.stdout.write('exit');" ],
                cwd: process.cwd(),
                env: null,
                io: { kind: 'pipes' },
                completion: { kind: 'exit', readiness: null, steps: [], expectedExitCodes: [ 0 ] }
            });
            scope.assert.equal(result.metrics.processCpuTotalMicroseconds.availability, 'available');
            sample.ensureMeasured();
        }, 'node');
        scope.assert.deepEqual(helperEvents(fixture), [ 'process:measured:0/exit/complete' ]);
        scope.assert.deepEqual(await fixture.execution.finish(), []);
        return scope.assert.collect();
    }),
    test('retains scripted input and output checkpoints in execution order', async function (scope: TestScope) {
        const fixture = await captureProcessTimeline(scope, async function scriptedInput(processes) {
            const sample = processes.sample('measured');
            await using disposal = new AsyncDisposableStack();
            disposal.defer(sample.dispose);
            await sample.sample.process({
                command: [
                    process.execPath,
                    '-e',
                    "process.stdin.on('data', () => process.stdout.write('received>')); process.stdin.resume();"
                ],
                cwd: process.cwd(),
                env: null,
                io: { kind: 'pipes' },
                completion: {
                    kind: 'exit',
                    readiness: null,
                    steps: [
                        { kind: 'write', text: 'input\n' },
                        { kind: 'expect', marker: { stream: 'stdout', text: 'received>' } },
                        { kind: 'close-input' }
                    ],
                    expectedExitCodes: [ 0 ]
                }
            });
            sample.ensureMeasured();
        }, 'off');
        scope.assert.deepEqual(helperEvents(fixture), [
            'process:measured:0/write/complete',
            'process:measured:0/expect/complete',
            'process:measured:0/close-input/complete',
            'process:measured:0/exit/complete'
        ]);
        scope.assert.deepEqual(await fixture.execution.finish(), []);
        return scope.assert.collect();
    }),
    test('retains terminal resize checkpoints alongside interactive output', async function (scope: TestScope) {
        const fixture = await captureProcessTimeline(scope, async function terminalInput(processes) {
            const sample = processes.sample('measured');
            await using disposal = new AsyncDisposableStack();
            disposal.defer(sample.dispose);
            const result = await sample.sample.process({
                command: [
                    process.execPath,
                    '-e',
                    "process.stdout.write('ready>'); process.stdin.on('data', () => process.stdout.write('received>'));"
                ],
                cwd: process.cwd(),
                env: null,
                io: { kind: 'pty', name: 'xterm', columns: 80, rows: 24 },
                completion: {
                    kind: 'interaction',
                    readiness: { stream: 'terminal', text: 'ready>' },
                    steps: [
                        { kind: 'resize', columns: 100, rows: 30 },
                        { kind: 'write', text: 'input\n' },
                        { kind: 'expect', marker: { stream: 'terminal', text: 'received>' } }
                    ]
                }
            });
            scope.assert.equal(result.value.output.kind, 'terminal');
            sample.ensureMeasured();
        }, 'off');
        scope.assert.deepEqual(
            helperEvents(fixture).toSorted(function alphabetical(left, right) {
                return left.localeCompare(right);
            }),
            [
                'process:measured:0/expect/complete',
                'process:measured:0/readiness/complete',
                'process:measured:0/resize/complete',
                'process:measured:0/write/complete'
            ]
        );
        scope.assert.deepEqual(await fixture.execution.finish(), []);
        return scope.assert.collect();
    }),
    test('retains failed readiness without inventing a successful checkpoint', async function (scope: TestScope) {
        const fixture = await captureProcessTimeline(scope, async function missingOutput(processes) {
            const sample = processes.sample('measured');
            await using disposal = new AsyncDisposableStack();
            disposal.defer(sample.dispose);
            await scope.assert.rejects(async function awaitReadiness() {
                await sample.sample.process({
                    command: [ process.execPath, '-e', "process.stdout.write('unexpected');" ],
                    cwd: process.cwd(),
                    env: null,
                    io: { kind: 'pipes' },
                    completion: { kind: 'ready', marker: { stream: 'stdout', text: 'missing' } }
                });
            }, { type: Error });
        }, 'off');
        scope.assert.deepEqual(helperEvents(fixture), [ 'process:measured:0/readiness/failed' ]);
        scope.assert.deepEqual(await fixture.execution.finish(), []);
        return scope.assert.collect();
    }),
    test('rejects duplicate process regions without launching another command', async function (scope: TestScope) {
        const fixture = await captureProcessTimeline(scope, async function duplicateCommand(processes) {
            const sample = processes.sample('measured');
            await using disposal = new AsyncDisposableStack();
            disposal.defer(sample.dispose);
            const request = {
                command: [ process.execPath, '-e', '' ],
                cwd: process.cwd(),
                env: null,
                io: { kind: 'pipes' },
                completion: { kind: 'exit', readiness: null, steps: [], expectedExitCodes: [ 0 ] }
            } as const;
            await sample.sample.process(request);
            await scope.assert.rejects(async function duplicateRegion() {
                return await sample.sample.process(request);
            }, { message: 'Each process sample must await exactly one process region.' });
            scope.assert.throws(sample.ensureMeasured, {
                message: 'Each process sample must await exactly one complete process region.'
            });
        }, 'off');
        scope.assert.deepEqual(helperEvents(fixture), [ 'process:measured:0/exit/complete' ]);
        scope.assert.deepEqual(await fixture.execution.finish(), []);
        return scope.assert.collect();
    }),
    test('contains launch failures and leaves the sample safely disposable', async function (scope: TestScope) {
        const fixture = await captureProcessTimeline(scope, async function missingExecutable(processes) {
            const sample = processes.sample('measured');
            await using disposal = new AsyncDisposableStack();
            disposal.defer(sample.dispose);
            await scope.assert.rejects(async function launchMissingCommand() {
                return await sample.sample.process({
                    command: [ '/overkill-missing-benchmark-executable' ],
                    cwd: process.cwd(),
                    env: null,
                    io: { kind: 'pipes' },
                    completion: { kind: 'exit', readiness: null, steps: [], expectedExitCodes: [ 0 ] }
                });
            }, { message: /ENOENT/u });
            scope.assert.throws(sample.ensureMeasured, {
                message: 'Each process sample must await exactly one complete process region.'
            });
        }, 'off');
        scope.assert.deepEqual(await fixture.execution.finish(), []);
        return scope.assert.collect();
    }),
    test('cancels unawaited commands when their sample closes', async function (scope: TestScope) {
        const fixture = await captureProcessTimeline(scope, async function abandonedCommand(processes) {
            const sample = processes.sample('measured');
            const pending = sample.sample.process({
                command: [ process.execPath, '-e', 'setInterval(() => {}, 100);' ],
                cwd: process.cwd(),
                env: null,
                io: { kind: 'pipes' },
                completion: { kind: 'exit', readiness: null, steps: [], expectedExitCodes: [ 0 ] }
            });
            const checked = scope.assert.rejects(async function unawaitedCommand() {
                return await pending;
            }, { message: 'Process sample was not awaited.' });
            await sample.dispose();
            await checked;
            scope.assert.throws(sample.ensureMeasured, {
                message: 'Each process sample must await exactly one complete process region.'
            });
        }, 'off');
        scope.assert.deepEqual(await fixture.execution.finish(), []);
        return scope.assert.collect();
    }),
    test('keeps closed sessions closed after repeated disposal', async function (scope: TestScope) {
        const fixture = await captureProcessTimeline(scope, async function closedSession(processes) {
            await processes.dispose();
            await processes.dispose();
            const sample = processes.sample('measured');
            await using disposal = new AsyncDisposableStack();
            disposal.defer(sample.dispose);
            await scope.assert.rejects(async function reuseClosedSession() {
                return await sample.sample.process({
                    command: [ process.execPath, '-e', '' ],
                    cwd: process.cwd(),
                    env: null,
                    io: { kind: 'pipes' },
                    completion: { kind: 'exit', readiness: null, steps: [], expectedExitCodes: [ 0 ] }
                });
            }, { message: 'Process sampling session is closed.' });
        }, 'off');
        scope.assert.deepEqual(helperEvents(fixture), []);
        scope.assert.deepEqual(await fixture.execution.finish(), []);
        return scope.assert.collect();
    })
]);
