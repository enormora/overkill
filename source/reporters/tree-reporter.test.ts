import { suite, test } from '@overkill-dev/test';

import figures from 'figures';
import colors from 'yoctocolors';

import { defaultFailureArtifactPolicy } from '../packages/engine/engine.entry-point.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { createTreeReporter } from './tree-reporter.ts';

type LogFunction = (...values: readonly unknown[]) => void;
type LogRecorder = {
    readonly lines: () => readonly string[];
    readonly log: LogFunction;
};

function createLogRecorder(): LogRecorder {
    const lines: string[] = [];

    return {
        lines() {
            return lines;
        },
        log(...values) {
            lines.push(values.join(' '));
        }
    };
}

export const testNode = suite('Tree reporter', [
    test('prints logical final results', async function (scope) {
        const recorder = createLogRecorder();
        const reporter = createTreeReporter({
            stdoutConsole: { log: recorder.log }
        }, { showPassing: true, verbose: false })({
            failureArtifacts: defaultFailureArtifactPolicy,
            relativizeLocationPath(location) {
                return location.file;
            }
        });

        await reporter.onResult({
            context: {
                id: null,
                startedAt: null,
                facts: null
            },
            result: runResultFactory.build({
                perTest: [
                    {
                        durationMicroseconds: 2000,
                        id: { file: 'source/example.test.ts', params: null, suite: [ 'root' ], title: 'passes' }
                    },
                    {
                        durationMicroseconds: 3000,
                        id: {
                            file: 'source/example.test.ts',
                            params: 'row=1',
                            suite: [ 'root' ],
                            title: 'fails'
                        },
                        outcome: { kind: 'fail' },
                        verdict: 'fail'
                    }
                ],
                summary: { discovered: 2, failed: 1, passed: 1, planned: 2 },
                totalWallTimeMicroseconds: 5000
            })
        });

        scope.assert.deepEqual(recorder.lines(), [
            'source/example.test.ts',
            '  root',
            `    ${colors.green(figures.tick)} passes (2 ms)`,
            `    ${colors.red(figures.cross)} fails [row=1] (3 ms)`,
            'Problems',
            '  source/example.test.ts: root > fails [row=1] (source/example.test.ts)',
            '    Check failed',
            '    source: source/example.test.ts',
            '    expected: null',
            '    actual: null',
            `${colors.red(figures.cross)} 2 discovered, 2 planned, 2 executed ` +
            '(1 pass, 1 fail, 0 skip) in 5 ms (total 5 ms, execution 0 ms, overhead 5 ms)'
        ]);

        return scope.assert.collect();
    }),
    test('can hide passing results', async function (scope) {
        const recorder = createLogRecorder();
        const reporter = createTreeReporter({
            stdoutConsole: { log: recorder.log }
        }, { showPassing: false, verbose: false })({
            failureArtifacts: defaultFailureArtifactPolicy,
            relativizeLocationPath(location) {
                return location.file;
            }
        });

        await reporter.onResult({
            context: {
                id: null,
                startedAt: null,
                facts: null
            },
            result: runResultFactory.build({
                perTest: [
                    {
                        id: { file: null, params: null, suite: [ 'root' ], title: 'passes' }
                    },
                    {
                        id: { file: null, params: null, suite: [ 'root' ], title: 'crashes' },
                        outcome: null,
                        verdict: 'crashed'
                    }
                ],
                summary: { crashed: 1, discovered: 2, passed: 1, planned: 2 }
            })
        });

        scope.assert.deepEqual(recorder.lines(), [
            '<unknown>',
            '  root',
            `    ${colors.red(figures.warning)} crashes (0 ms)`,
            'Problems',
            '  root > crashes (source/example.test.ts)',
            '    crashed',
            `${colors.red(figures.cross)} 2 discovered, 2 planned, 2 executed ` +
            '(1 pass, 0 fail, 0 skip, 1 crash) in 0 ms (total 0 ms, execution 0 ms, overhead 0 ms)'
        ]);

        return scope.assert.collect();
    }),
    test('renders skip and inconclusive symbols', async function (scope) {
        const recorder = createLogRecorder();
        const reporter = createTreeReporter({
            stdoutConsole: { log: recorder.log }
        }, { showPassing: true, verbose: false })({
            failureArtifacts: defaultFailureArtifactPolicy,
            relativizeLocationPath(location) {
                return location.file;
            }
        });

        await reporter.onResult({
            context: {
                id: null,
                startedAt: null,
                facts: null
            },
            result: runResultFactory.build({
                perTest: [
                    {
                        id: { file: null, params: null, suite: [], title: 'skips' },
                        outcome: { kind: 'skip' },
                        verdict: 'skip'
                    },
                    {
                        id: { file: null, params: null, suite: [], title: 'maybe' },
                        outcome: { kind: 'inconclusive' },
                        verdict: 'inconclusive'
                    }
                ],
                summary: { discovered: 2, inconclusive: 1, planned: 2, skipped: 1 }
            })
        });

        scope.assert.deepEqual(recorder.lines(), [
            '<unknown>',
            `  ${colors.cyan('°')} skips (0 ms)`,
            `  ${colors.cyan('?')} maybe (0 ms)`,
            'Problems',
            '  maybe (source/example.test.ts)',
            '    Inconclusive',
            `${colors.green(figures.tick)} 2 discovered, 2 planned, 2 executed ` +
            '(0 pass, 0 fail, 1 skip, 1 inconclusive) in 0 ms ' +
            '(total 0 ms, execution 0 ms, overhead 0 ms)'
        ]);

        return scope.assert.collect();
    })
]);
