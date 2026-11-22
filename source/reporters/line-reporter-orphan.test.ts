import {
    type TestNode,
    type TestScope,
    suite,
    test,
    doubleUsage,
    testDouble,
    type TestDouble
} from '@overkill-dev/test';

import figures from 'figures';
import colors from 'yoctocolors';

import type { RealTimeReporter } from '../packages/engine/engine.entry-point.ts';
import { createReportingContext } from '../engine/reporting-context.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { createLineReporter, type LineReporterDependencies } from './line-reporter.ts';

type LogFunction = (...values: readonly unknown[]) => void;
type Log = TestDouble<LogFunction>;

const infoSymbol = colors.cyan(figures.info);
const errorSymbol = colors.red(figures.cross);

function lineReporterWithLog(log: Log): RealTimeReporter {
    const fakeDependencies: LineReporterDependencies = {
        columns: 200,
        formatOptions: { color: false, wrap: true },
        interactive: false,
        showPassing: true,
        stdoutConsole: { log },
        verbose: false
    };

    return createLineReporter(fakeDependencies)(createReportingContext({ projectRoot: null }));
}

function assertOrphanOutput(scope: TestScope, log: Log): void {
    scope.assert(doubleUsage.callCount, log, 5);
    scope.assert(doubleUsage.nthCallWithExactly, log, 0, [
        errorSymbol,
        'Run failed · 2 orphaned · 0 ms'
    ]);
    scope.assert(doubleUsage.nthCallWithExactly, log, 1, [ '  0 executed · 0 ms execution · 0 ms overhead' ]);
    scope.assert(doubleUsage.nthCallWithExactly, log, 2, [
        infoSymbol,
        'test: unused (<unknown>) (source/macro.test.ts:10)'
    ]);
    scope.assert(doubleUsage.nthCallWithExactly, log, 3, [
        '  constructed at source/example.test.ts:20'
    ]);
    scope.assert(doubleUsage.nthCallWithExactly, log, 4, [
        infoSymbol,
        'suite: detached (source/detached.test.ts)'
    ]);
}

export const testNode: TestNode = suite('Line reporter orphan', [
    test('prints orphan details once the run finishes', async function (scope) {
        const log = testDouble<LogFunction>();
        const reporter = lineReporterWithLog(log);
        const { onFinish } = reporter;

        if (onFinish === null) {
            throw new TypeError('Expected line reporter to expose onFinish.');
        }

        await onFinish({
            context: { id: null, startedAt: null, facts: null },
            result: runResultFactory.build({
                orphans: [
                    {
                        definitionLocations: [
                            { column: null, file: 'source/macro.test.ts', kind: 'known' as const, line: 10 },
                            { column: null, file: 'source/example.test.ts', kind: 'known' as const, line: 20 }
                        ],
                        file: null,
                        kind: 'test',
                        title: 'unused'
                    },
                    {
                        definitionLocations: [ { kind: 'unknown' as const } ],
                        file: 'source/detached.test.ts',
                        kind: 'suite',
                        title: 'detached'
                    }
                ],
                summary: {
                    discovered: 0,
                    planned: 0
                }
            })
        });

        assertOrphanOutput(scope, log);

        return scope.assert.collect();
    })
]);
