import figures from 'figures';
import colors from 'yoctocolors';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { preciseTimingReport, runTimingSummary } from '../engine/run-timings.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { createDotReporter } from './dot-reporter.ts';
import type { TerminalOutput } from './terminal.ts';

type CapturedOutput = {
    readonly output: TerminalOutput;
    readonly text: () => string;
};

function capturedOutput(): CapturedOutput {
    let text = '';

    return {
        output: {
            columns: 80,
            off() {
                return undefined;
            },
            on() {
                return undefined;
            },
            write(value) {
                text = `${text}${value}`;
            }
        },
        text() {
            return text;
        }
    };
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/reporters/dot-reporter-timing.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'dot reporter prints slow runner overhead after the summary',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const terminal = capturedOutput();
                const reporter = createDotReporter({ interactive: false, stdout: terminal.output })({
                    relativizeLocationPath(location) {
                        return location.file;
                    }
                });
                const summary = runTimingSummary({
                    testExecutionWallTimeMicroseconds: 1_000_000,
                    totalWallTimeMicroseconds: 2_000_000
                });
                const result = runResultFactory.build({
                    timings: {
                        precise: preciseTimingReport({
                            aggregationMicroseconds: 0,
                            recordingMicroseconds: 0,
                            slowestSpanLimit: 50,
                            spanLimit: 5000,
                            spans: [ {
                                durationMicroseconds: 750_000,
                                kind: 'config.load',
                                label: null,
                                processId: null,
                                resource: null,
                                startOffsetMicroseconds: 0,
                                status: 'success',
                                workerId: null
                            } ]
                        }),
                        summary
                    }
                });
                const { onFinish } = reporter;

                scope.require.notNull(onFinish);
                await onFinish(result);

                scope.assert.equal(
                    terminal.text(),
                    [
                        `${colors.red(figures.cross)} 0 discovered, 0 planned, 0 executed ` +
                        '(0 pass, 0 fail, 0 skip) in 2000 ms ' +
                        '(total 2000 ms, execution 1000 ms, overhead 1000 ms)',
                        'Slow runner overhead:',
                        '  config load: 750 ms',
                        ''
                    ]
                        .join('\n')
                );

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
