import figures from 'figures';
import colors from 'yoctocolors';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { createDotReporter } from './dot-reporter.ts';
import type { TerminalOutput } from './terminal.ts';

type FakeTerminal = {
    readonly output: TerminalOutput;
    readonly text: () => string;
};

function createFakeTerminal(): FakeTerminal {
    let text = '';
    let resizeListeners: readonly (() => void)[] = [];

    return {
        output: {
            columns: 80,
            off(_event, listener) {
                resizeListeners = resizeListeners.filter(function keepRegistered(candidate) {
                    return candidate !== listener;
                });
            },
            on(_event, listener) {
                resizeListeners = [ ...resizeListeners, listener ];
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
    title: 'source/reporters/dot-reporter-interrupted-summary.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'dot reporter prints green summaries and interrupted test details',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const terminal = createFakeTerminal();
                const reporter = createDotReporter({
                    interactive: false,
                    stdout: terminal.output
                })({
                    relativizeLocationPath(location) {
                        return location.file;
                    }
                });
                const { onFinish } = reporter;

                if (onFinish === null) {
                    throw new TypeError('Expected dot reporter to expose onFinish.');
                }

                await onFinish(runResultFactory.build({
                    perTest: [
                        {
                            id: { file: null, title: 'passes', params: null, suite: [ 'root' ] },
                            outcome: { kind: 'pass' }
                        }
                    ],
                    summary: { discovered: 1, passed: 1, planned: 1 },
                    totalWallTimeMicroseconds: 5000
                }));
                await onFinish(runResultFactory.build({
                    perTest: [
                        {
                            id: { file: null, title: 'heap ceiling', params: null, suite: [ 'root' ] },
                            outcome: null,
                            verdict: 'resource-exhausted'
                        },
                        {
                            id: { file: null, title: 'worker death', params: null, suite: [ 'root' ] },
                            outcome: null,
                            verdict: 'crashed'
                        }
                    ],
                    summary: { crashed: 1, discovered: 2, planned: 2, resourceExhausted: 1 },
                    totalWallTimeMicroseconds: 9000
                }));

                scope.assert.equal(
                    terminal.text(),
                    [
                        `${colors.green(figures.tick)} 1 discovered, 1 planned, 1 executed ` +
                        '(1 pass, 0 fail, 0 skip) in 5 ms (total 5 ms, execution 0 ms, overhead 5 ms)',
                        `${colors.red(figures.cross)} 2 discovered, 2 planned, 2 executed ` +
                        '(0 pass, 0 fail, 0 skip, 1 resource-exhausted, 1 crash) in 9 ms ' +
                        '(total 9 ms, execution 0 ms, overhead 9 ms)',
                        'Problems',
                        '  root > heap ceiling (source/example.test.ts)',
                        '    resource-exhausted',
                        '  root > worker death (source/example.test.ts)',
                        '    crashed',
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
