import { createDeterministicClock } from '@enormora/clock';
import { runIfMain } from '#test-runner';
import { createReporterDispatcher } from '../engine/reporter-dispatcher.ts';
import { createPlainOutputRenderer, type OutputLineIntent } from '../engine/reporter-output.ts';
import { createSuite, createTestCase, type TestScope } from '../packages/engine/engine.entry-point.ts';
import { createReportingContext } from '../engine/reporting-context.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { createBriefFinalResultReporter } from '../packages/reporter-brief/reporter-brief.entry-point.ts';
import { createBriefReporter } from './brief-reporter.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
const context = createReportingContext({ projectRoot: '/project' });

function texts(output: unknown): readonly string[] {
    return Array.isArray(output)
        ? output.map(function text(intent: OutputLineIntent) {
            return intent.text;
        })
        : [];
}

function assertLocatedFailure(scope: TestScope, output: readonly OutputLineIntent[]): void {
    scope.assert.equal(output.length, 4);
    scope.assert.true(output[0]?.text.startsWith('fail source/example.test.ts:7:3 '));
    scope.assert.true(output[0]?.text.endsWith(': mismatch'));
    const annotation = output[0]?.annotation;
    scope.require.defined(annotation);
    scope.assert.deepEqual(
        annotation,
        {
            location: { kind: 'known', file: '/project/source/example.test.ts', line: 7, column: 3 },
            severity: 'error',
            title: 'root > passes'
        } as const
    );
}

function assertFinalDiagnostics(scope: TestScope, output: readonly OutputLineIntent[]): void {
    assertLocatedFailure(scope, output);
    scope.assert.true(output[1]?.text.endsWith(': no assertions'));
    scope.assert.equal(output[1]?.annotation?.location, null);
    scope.assert.equal(output[2]?.text, 'runner-error missing shard');
    scope.assert.true(output[3]?.text.startsWith('done status=failed discovered=10 planned=8 executed=3 '));
}

export const testNode = createSuite({
    ...metadata,
    title: 'brief final-result reporter',
    children: [
        createTestCase({
            ...metadata,
            title: 'delivers managed final output through the dispatcher',
            async body(scope: TestScope) {
                const lines: string[] = [];
                const dispatcher = createReporterDispatcher({
                    stdout: {
                        writeLine(line) {
                            lines.push(line);
                        }
                    },
                    stderr: {
                        writeLine(line) {
                            lines.push(line);
                        }
                    },
                    wallClock: createDeterministicClock({ initialUnixEpochMicroseconds: 0n })
                });
                const delivery = await dispatcher.createDelivery(
                    [ createBriefFinalResultReporter() ],
                    createPlainOutputRenderer()
                );
                scope.assert.deepEqual(
                    await delivery.reportEvent({
                        kind: 'suite-start',
                        suitePath: []
                    }),
                    []
                );
                scope.assert.deepEqual(Array.from(lines), []);
                scope.assert.deepEqual(await delivery.reportResult(runResultFactory.build()), []);
                scope.assert.equal(lines.length, 1);
                scope.assert.true(lines[0]?.startsWith('done '));
                scope.assert.deepEqual(await delivery.disposeReporters(), []);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'declares a final-result managed primary sink',
            body(scope: TestScope) {
                const reporter = createBriefFinalResultReporter()(context);
                scope.assert.equal(reporter.kind, 'final-result');
                scope.assert.equal(reporter.name, 'brief-final-result');
                scope.assert.equal(reporter.dispose, null);
                scope.assert.deepEqual(reporter.sinks, [ { kind: 'stdout-managed-primary' } ]);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'rejects conflicting managed primary reporters',
            async body(scope: TestScope) {
                const dispatcher = createReporterDispatcher({
                    stdout: {
                        writeLine() {
                            return undefined;
                        }
                    },
                    stderr: {
                        writeLine() {
                            return undefined;
                        }
                    },
                    wallClock: createDeterministicClock({ initialUnixEpochMicroseconds: 0n })
                });
                await scope.assert.rejects(async function conflictingPrimaries() {
                    return await dispatcher.createDelivery(
                        [ createBriefReporter(), createBriefFinalResultReporter() ],
                        createPlainOutputRenderer()
                    );
                }, { message: 'Reporter sink conflict: stdout is claimed by incompatible reporters.' });
                return scope.assert.collect();
            }
        }),

        createTestCase({
            ...metadata,
            title: 'renders final causes and runner errors before counts with located annotations',
            async body(scope: TestScope) {
                const result = runResultFactory.build({
                    perTest: [ {
                        outcome: {
                            kind: 'fail',
                            failures: [
                                {
                                    checks: [ {
                                        summary: 'mismatch',
                                        sourceLocations: [
                                            {
                                                kind: 'known',
                                                file: '/project/source/example.test.ts',
                                                line: 7,
                                                column: 3
                                            }
                                        ]
                                    } ]
                                },
                                { kind: 'test-contract', code: 'no-assertions', summary: 'no assertions' }
                            ]
                        },
                        verdict: 'fail'
                    } ],
                    runnerErrors: [ { message: 'missing shard' } ],
                    summary: { discovered: 10, planned: 8, failed: 1, passed: 2 }
                });
                const reporter = createBriefFinalResultReporter()(context);
                const output = await reporter.onResult(result) ?? [];
                assertFinalDiagnostics(scope, output);
                scope.assert.deepEqual(await reporter.onResult(result) ?? [], output);
                scope.assert.true(createBriefFinalResultReporter()(context) !== reporter);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'preserves summary output without progress or duplicate failures',
            async body(scope: TestScope) {
                for (const planStatus of [ 'empty-shard', 'planned' ] as const) {
                    const result = runResultFactory.build({ planStatus });
                    const realTime = createBriefReporter()(context);
                    scope.require.notNull(realTime.onFinish);
                    const output = await createBriefFinalResultReporter()(context).onResult(result);
                    scope.assert.deepEqual(output ?? [], await realTime.onFinish(result) ?? []);
                    scope.assert.equal(texts(output).length, 1);
                    scope.assert.true(texts(output)[0]?.startsWith('done '));
                }
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'uses final outcomes instead of retry failures or terminal diagnostics',
            async body(scope: TestScope) {
                const initial = runResultFactory.build({
                    perTest: [
                        { outcome: { kind: 'pass' }, verdict: 'pass' },
                        { outcome: { kind: 'inconclusive', reason: 'unavailable' }, verdict: 'inconclusive' },
                        { outcome: null, verdict: 'crashed' },
                        { outcome: { kind: 'fail', checks: [ { summary: 'final failure' } ] }, verdict: 'fail' }
                    ],
                    summary: { passed: 1, failed: 1, inconclusive: 1, crashed: 1 }
                });
                const failed = runResultFactory.build({ perTest: [ { outcome: { kind: 'fail' }, verdict: 'fail' } ] });
                const failedAttempt = failed.perTest[0]?.attempts[0];
                scope.require.defined(failedAttempt);
                const result = {
                    ...initial,
                    perTest: initial.perTest.map(function withRetry(testResult) {
                        return {
                            ...testResult,
                            retried: { attempts: 2, finalVerdict: testResult.verdict },
                            attempts: [
                                failedAttempt,
                                ...testResult.attempts
                            ] as const
                        };
                    })
                };
                const output = texts(await createBriefFinalResultReporter()(context).onResult(result));
                scope.assert.deepEqual(output, [
                    'fail source/example.test.ts root > passes: final failure',
                    'done status=failed discovered=0 planned=0 executed=4 passed=1 failed=1 retried=4 skipped=0 inconclusive=1 processExhausted=0 runtimePolicy=0 crashed=1 ms=0 timing="total 0 ms, execution 0 ms, overhead 0 ms"'
                ]);
                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testNode);
