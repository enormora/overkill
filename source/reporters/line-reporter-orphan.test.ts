import figures from 'figures';
import colors from 'yoctocolors';
import { doubleUsage, testDouble, type TestDouble } from '../packages/doubles/doubles.entry-point.ts';
import { createLineReporter as createOverkillLineReporter } from '../packages/reporter-line/reporter-line.entry-point.ts';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type RealTimeReporter,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { createLineReporter, type LineReporterDependencies } from './line-reporter.ts';

type LogFunction = (...values: readonly unknown[]) => void;
type Log = TestDouble<LogFunction>;

const infoSymbol = colors.cyan(figures.info);

function lineReporterWithLog(log: Log): RealTimeReporter {
    const fakeDependencies = { stdoutConsole: { log } } as unknown as LineReporterDependencies;

    return createLineReporter(fakeDependencies);
}

function assertOrphanOutput(scope: OverkillScope, log: Log): void {
    scope.assert(doubleUsage.callCount, log, 3);
    scope.assert(doubleUsage.nthCallWithExactly, log, 0, [
        infoSymbol,
        '0 discovered, 0 planned, 0 executed (0 pass, 0 fail, 0 skip), 1 orphaned in 0 ms'
    ]);
    scope.assert(doubleUsage.nthCallWithExactly, log, 1, [
        infoSymbol,
        'test: unused (<unknown>) (source/macro.test.ts:10)'
    ]);
    scope.assert(doubleUsage.nthCallWithExactly, log, 2, [
        '  constructed at source/example.test.ts:20'
    ]);
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { column: null, file: '', line: null } ],
    title: 'source/reporters/line-reporter-orphan.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { column: null, file: '', line: null } ],
            title: 'line reporter prints orphan details once the run finishes',
            metadata: {},
            async body(scope: OverkillScope) {
                const log = testDouble<LogFunction>();
                const reporter = lineReporterWithLog(log);
                const { onFinish } = reporter;

                if (onFinish === null) {
                    throw new TypeError('Expected line reporter to expose onFinish.');
                }

                await onFinish(runResultFactory.build({
                    orphans: [
                        {
                            definitionLocations: [
                                { column: null, file: 'source/macro.test.ts', line: 10 },
                                { column: null, file: 'source/example.test.ts', line: 20 }
                            ],
                            file: null,
                            kind: 'test',
                            title: 'unused'
                        }
                    ],
                    summary: {
                        discovered: 0,
                        planned: 0
                    }
                }));

                assertOrphanOutput(scope, log);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain } = await import('../test-support/run-if-main.ts');

await runIfMain(import.meta, testNode, { reporters: [ createOverkillLineReporter() ] });
