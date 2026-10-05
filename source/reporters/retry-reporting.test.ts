import figures from 'figures';
import colors from 'yoctocolors';
import {
    createSuite,
    createTestCase,
    type RunResult,
    type ReporterEvent,
    type TestScope
} from '../packages/engine/engine.entry-point.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { createReportingContext } from '../engine/reporting-context.ts';
import { resultWithAttemptHistory } from '../engine/test-attempt-history.ts';
import { createBriefReporter } from './brief-reporter.ts';
import { createDotReporter } from './dot-reporter.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
const context = createReportingContext({ projectRoot: null });
type TestEndEvent = Extract<ReporterEvent, { readonly kind: 'test-end'; }>;

function recoveredResult(): RunResult {
    const result = runResultFactory.build({
        perTest: [ { outcome: { kind: 'pass' } } ],
        summary: { discovered: 1, planned: 1, passed: 1 }
    });
    return {
        ...result,
        perTest: result.perTest.map(function recoveredTest(test) {
            return resultWithAttemptHistory(test, [ {
                attempt: { index: 0 },
                durationMicroseconds: 1,
                outcome: {
                    kind: 'fail',
                    failures: [ { kind: 'timeout', deadlineMilliseconds: 1, elapsedMilliseconds: 2 } ]
                },
                verdict: 'fail'
            }, { attempt: { index: 1 }, durationMicroseconds: 1, outcome: { kind: 'pass' }, verdict: 'pass' } ]);
        })
    };
}

function retryEvent(result: RunResult): TestEndEvent {
    const test = result.perTest[0];
    if (test === undefined) {
        throw new Error('Retry reporting requires one logical test.');
    }
    return {
        completion: 'retry',
        attempt: 0,
        artifacts: [],
        case: test.id,
        definitionLocations: metadata.definitionLocations,
        durationMicroseconds: 1,
        kind: 'test-end',
        outcome: test.attempts[0].outcome,
        suitePath: [],
        verdict: 'fail'
    };
}

export const testNode = createSuite({
    ...metadata,
    title: 'source/reporters/retry-reporting.test.ts',
    children: [
        ...([ 'resource-exhausted', 'crashed', 'runtime-policy' ] as const).map(function terminalRetry(verdict) {
            return createTestCase({
                ...metadata,
                title: `dot reporter renders terminal retry ${verdict}`,
                async body(scope: TestScope) {
                    let text = '';
                    const reporter = createDotReporter({
                        interactive: false,
                        stdout: {
                            columns: 80,
                            on() {
                                return undefined;
                            },
                            off() {
                                return undefined;
                            },
                            write(value) {
                                text += value;
                            }
                        }
                    })(context);
                    const event = retryEvent(recoveredResult());
                    await reporter.onEvent({ ...event, completion: 'final', attempt: 1, outcome: null, verdict });
                    scope.assert.equal(
                        text,
                        verdict === 'runtime-policy' ? colors.cyan('?') : colors.red(figures.warning)
                    );
                    return scope.assert.collect();
                }
            });
        }),
        createTestCase({
            ...metadata,
            title: 'brief progress counts a final failure once after an intermediate retry',
            async body(scope: TestScope) {
                const reporter = createBriefReporter()(context);
                const event = retryEvent(recoveredResult());
                for (let index = 0; index < 99; index += 1) {
                    await reporter.onEvent({
                        ...event,
                        completion: 'final',
                        outcome: { kind: 'pass' },
                        verdict: 'pass'
                    });
                }
                await reporter.onEvent(event);
                const output = await reporter.onEvent({ ...event, completion: 'final', attempt: 1 });
                scope.require.defined(output);
                scope.assert.includes(
                    output
                        .map(function text(intent) {
                            return intent.text;
                        })
                        .join('\n'),
                    'progress 100/? failed=1'
                );
                scope.assert.equal(output[0]?.annotation?.severity, 'error');
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'brief summary reports recovered retries without failure annotations',
            async body(scope: TestScope) {
                const reporter = createBriefReporter()(context);
                const { onFinish } = reporter;
                scope.require.defined(onFinish);
                const output = await onFinish(recoveredResult());
                scope.require.defined(output);
                scope.assert.includes(output[0]?.text ?? '', 'retried=1');
                scope.assert.includes(output[0]?.text ?? '', 'failed=0');
                scope.assert.equal(output[0]?.annotation, null);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'dot reporter omits retry marks and reports recovered logical counts',
            async body(scope: TestScope) {
                let text = '';
                const reporter = createDotReporter({
                    interactive: false,
                    stdout: {
                        columns: 80,
                        on() {
                            return undefined;
                        },
                        off() {
                            return undefined;
                        },
                        write(value) {
                            text += value;
                        }
                    }
                })(context);
                const result = recoveredResult();
                await reporter.onEvent(retryEvent(result));
                scope.assert.equal(text, '');
                const { onFinish } = reporter;
                scope.require.defined(onFinish);
                await onFinish(result);
                scope.assert.includes(text, '1 executed (1 pass, 0 fail, 0 skip), 1 retried');
                return scope.assert.collect();
            }
        })
    ]
});
const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
