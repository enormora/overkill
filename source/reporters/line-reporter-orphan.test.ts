import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { suite, test, testDouble, type TestDouble } from '@overkill-dev/test';

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

const orphanOutput = defineCompositeAssertion({
    name: 'orphan summary and construction locations',
    assert(check, log: Log) {
        return check.deepEqual(
            log.calls.map(function argumentsForCall(call) {
                return call.arguments;
            }),
            [
                [ errorSymbol, 'Run failed · 2 orphaned · 0 ms' ],
                [ '  0 executed · 0 ms execution · 0 ms overhead' ],
                [ infoSymbol, 'test: unused (<unknown>) (source/macro.test.ts:10)' ],
                [ '  constructed at source/example.test.ts:20' ],
                [ infoSymbol, 'suite: detached (source/detached.test.ts)' ]
            ]
        );
    }
});

export const testNode = suite('Line reporter orphan', [
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
        scope.assert(orphanOutput, log);

        return scope.assert.collect();
    })
]);
