import { type TestScope, suite, test } from '@overkill-dev/test';

import figures from 'figures';
import colors from 'yoctocolors';

import type { RealTimeReporter } from '../engine/reporter.ts';

import { defaultFailureArtifactPolicy } from '../engine/failure-artifact-policy.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { createLineReporter } from './line-reporter.ts';

type LineFixture = { readonly lines: readonly string[]; readonly reporter: RealTimeReporter; };
function lineFixture(): LineFixture {
    const lines: string[] = [];
    const reporter = createLineReporter({
        columns: 120,
        verbose: false,
        formatOptions: { color: false, wrap: true },
        stdoutConsole: {
            log(...values) {
                lines.push(values.join(' '));
            }
        }
    })({
        failureArtifacts: defaultFailureArtifactPolicy,
        relativizeLocationPath(location) {
            return location.file;
        }
    });
    return { lines, reporter };
}
export const testNode = suite('line reporter completion policy', [
    test('renders retry completion without presenting it as a final result', async function (scope: TestScope) {
        const { lines, reporter } = lineFixture();
        scope.require.notNull(reporter.onEvent);
        await reporter.onEvent({
            kind: 'test-end',
            case: { file: null, suite: [], title: 'retry case', params: null },
            workId: {
                familyVariant: null,
                case: { file: null, suite: [], title: 'retry case', params: null },
                runtimes: [],
                workload: null
            },
            attempt: 1,
            definitionLocations: [ { kind: 'unknown' } ],
            suitePath: [],
            completion: 'retry',
            artifacts: [],
            outcome: { kind: 'pass' },
            verdict: 'pass',
            property: null,
            benchmark: null,
            durationMicroseconds: 1
        });
        scope.assert.equal(lines.length, 1);
        scope.assert.includes(lines[0] ?? '', 'Retry after attempt 2: retry case');
        return scope.assert.collect();
    }),
    test('prints successful summaries', async function (scope: TestScope) {
        const { lines, reporter } = lineFixture();
        scope.require.notNull(reporter.onFinish);
        await reporter.onFinish({
            result: runResultFactory.build({ status: 'passed', summary: { planned: 1, passed: 1 } }),
            context: { id: null, startedAt: null, facts: null }
        });
        scope.assert.includes(lines.join('\n'), '1 pass');
        scope.assert.equal(lines[0]?.startsWith(`${colors.green(figures.tick)} `), true);
        return scope.assert.collect();
    })
]);
