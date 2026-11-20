import { table, type TestNode, suite, test, type TestScope } from '@overkill-dev/test';

import figures from 'figures';
import colors from 'yoctocolors';
import type { RunResult, ReporterEvent } from '../packages/engine/engine.entry-point.ts';

import { runResultFactory } from '../test-support/run-result-factory.ts';
import { createReportingContext } from '../engine/reporting-context.ts';
import { resultWithAttemptHistory } from '../engine/test-attempt-history.ts';
import { createBriefReporter } from './brief-reporter.ts';
import { createDotReporter } from './dot-reporter.ts';

const metadata = { definitionLocations: [ { kind: 'unknown' } ] } as const;
const context = createReportingContext({ projectRoot: null });
type TestEndEvent = Extract<ReporterEvent, { readonly kind: 'test-end'; }>;

function recoveredResult(): RunResult {
    const result = runResultFactory.build({
        perTest: [ { outcome: { kind: 'pass' } } ],
        summary: { discovered: 1, planned: 1, passed: 1 }
    });
    return {
        ...result,
        perTest: result.perTest.map(function recoveredTest(testResult) {
            return resultWithAttemptHistory(testResult, [ {
                property: null,
                benchmark: null,
                attempt: { index: 0 },
                durationMicroseconds: 1,
                outcome: {
                    kind: 'fail',
                    failures: [ { kind: 'timeout', deadlineMilliseconds: 1, elapsedMilliseconds: 2 } ]
                },
                verdict: 'fail'
            }, {
                property: null,
                benchmark: null,
                attempt: { index: 1 },
                durationMicroseconds: 1,
                outcome: { kind: 'pass' },
                verdict: 'pass'
            } ]);
        })
    };
}

function retryEvent(result: RunResult): TestEndEvent {
    const testResult = result.perTest[0];
    if (testResult === undefined) {
        throw new Error('Retry reporting requires one logical test.');
    }
    return {
        property: null,
        benchmark: null,
        completion: 'retry',
        attempt: 0,
        artifacts: [],
        case: testResult.id,
        definitionLocations: metadata.definitionLocations,
        durationMicroseconds: 1,
        kind: 'test-end',
        outcome: testResult.attempts[0].outcome,
        suitePath: [],
        verdict: 'fail'
    };
}

export const testNode: TestNode = suite('Retry reporting', [
    table({
        title: 'renders terminal retry verdicts',
        cases: [ 'process-exhausted', 'crashed', 'runtime-policy' ] as const,
        caseTitle(verdict) {
            return verdict;
        },
        async test(scope) {
            const verdict = scope.parameters;

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
    }),
    test(
        'brief progress counts a final failure once after an intermediate retry',
        async function (scope: TestScope) {
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
    ),
    test(
        'brief summary reports recovered retries without failure annotations',
        async function (scope: TestScope) {
            const reporter = createBriefReporter()(context);
            const { onFinish } = reporter;
            scope.require.defined(onFinish);
            const output = await onFinish({
                context: {
                    id: null,
                    startedAt: null,
                    facts: null
                },
                result: recoveredResult()
            });
            scope.require.defined(output);
            scope.assert.includes(output[0]?.text ?? '', 'retried=1');
            scope.assert.includes(output[0]?.text ?? '', 'failed=0');
            scope.assert.equal(output[0]?.annotation, null);
            return scope.assert.collect();
        }
    ),
    test(
        'dot reporter omits retry marks and reports recovered logical counts',
        async function (scope: TestScope) {
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
            await onFinish({ context: { id: null, startedAt: null, facts: null }, result });
            scope.assert.includes(text, '1 executed (1 pass, 0 fail, 0 skip), 1 retried');
            return scope.assert.collect();
        }
    )
]);
