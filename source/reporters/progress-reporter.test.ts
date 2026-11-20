import { type TestScope as OverkillScope, suite, test } from '@overkill-dev/test';

import ansiEscapes from 'ansi-escapes';
import figures from 'figures';
import colors from 'yoctocolors';

import { defaultFailureArtifactPolicy } from '../packages/engine/engine.entry-point.ts';
import { resolveRootTestAnnotations } from '../engine/test-data.ts';
import type { CaseId } from '../engine/identity.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import type { TerminalOutput } from './terminal.ts';
import { createProgressReporter } from './progress-reporter.ts';

type FakeTerminal = {
    readonly output: TerminalOutput;
    readonly text: () => string;
};

const definitionLocation = { kind: 'unknown' as const };
const passingCaseId: CaseId = { file: null, params: null, suite: [ 'root' ], title: 'passes' };
const failingCaseId: CaseId = { file: null, params: null, suite: [ 'root' ], title: 'fails' };

function createFakeTerminal(): FakeTerminal {
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
                return true;
            }
        },
        text() {
            return text;
        }
    };
}

function suitePathFromCase(
    id: CaseId
): readonly { readonly definitionLocations: readonly [typeof definitionLocation]; readonly title: string; }[] {
    return id.suite.map(function toSuitePathEntry(title) {
        return { definitionLocations: [ definitionLocation ], title };
    });
}

async function reportProgressRun(terminal: FakeTerminal): Promise<void> {
    const reporter = createProgressReporter({
        interactive: true,
        stdout: terminal.output
    }, { showPassing: false, verbose: false })({
        failureArtifacts: defaultFailureArtifactPolicy,
        relativizeLocationPath(location) {
            return location.file;
        }
    });

    await reporter.onEvent({
        facts: { cases: [ passingCaseId, failingCaseId ] },
        kind: 'run-start',
        root: { annotations: resolveRootTestAnnotations({}), title: 'root' },
        startedAt: '2026-07-15T00:00:00.000Z'
    });
    await reporter.onEvent({
        property: null,
        benchmark: null,
        completion: 'final',
        attempt: 0,
        artifacts: [],
        case: passingCaseId,
        definitionLocations: [ definitionLocation ],
        durationMicroseconds: 1000,
        kind: 'test-end',
        outcome: { kind: 'pass' },
        suitePath: suitePathFromCase(passingCaseId),
        verdict: 'pass'
    });
    await reporter.onEvent({
        property: null,
        benchmark: null,
        completion: 'final',
        attempt: 0,
        artifacts: [],
        case: failingCaseId,
        definitionLocations: [ definitionLocation ],
        durationMicroseconds: 2000,
        kind: 'test-end',
        outcome: {
            failures: [
                {
                    actual: 0,
                    code: 'no-assertions',
                    expected: 'at least one assertion',
                    kind: 'test-contract',
                    summary: 'Expected at least one assertion.'
                }
            ],
            kind: 'fail'
        },
        suitePath: suitePathFromCase(failingCaseId),
        verdict: 'fail'
    });
    await reporter.onFinish?.({
        context: { id: null, startedAt: null, facts: null },
        result: runResultFactory.build({
            perTest: [
                { id: passingCaseId },
                { id: failingCaseId, outcome: { kind: 'fail' }, verdict: 'fail' }
            ],
            summary: { discovered: 2, failed: 1, passed: 1, planned: 2 },
            totalWallTimeMicroseconds: 3000
        })
    });
}

export const testNode = suite('source/reporters/progress-reporter.test.ts', [
    test('progress reporter redraws a live bar and prints final tree output', async function (scope: OverkillScope) {
        const terminal = createFakeTerminal();

        await reportProgressRun(terminal);

        scope.assert.equal(
            terminal.text(),
            [
                '[....................] 0/2 failed=0',
                ansiEscapes.eraseLines(1),
                '[==========..........] 1/2 failed=0',
                ansiEscapes.eraseLines(1),
                '[====================] 2/2 failed=1',
                ansiEscapes.eraseLines(1),
                '<unknown>\n',
                '  root\n',
                `    ${colors.red(figures.cross)} fails (0 ms)\n`,
                'Problems\n',
                '  root > fails (source/example.test.ts)\n',
                '    Check failed\n',
                '    source: source/example.test.ts\n',
                '    expected: null\n',
                '    actual: null\n',
                `${colors.red(figures.cross)} 2 discovered, 2 planned, 2 executed ` +
                '(1 pass, 1 fail, 0 skip) in 3 ms (total 3 ms, execution 0 ms, overhead 3 ms)\n'
            ]
                .join('')
        );

        return scope.assert.collect();
    }),
    test('progress reporter prints runner errors in non-interactive output', async function (scope: OverkillScope) {
        const terminal = createFakeTerminal();
        const reporter = createProgressReporter({
            interactive: false,
            stdout: terminal.output
        }, { showPassing: true, verbose: false })({
            failureArtifacts: defaultFailureArtifactPolicy,
            relativizeLocationPath(location) {
                return location.file;
            }
        });

        await reporter.onEvent({
            error: {
                attributedToAttempt: null,
                attributedTo: null,
                cause: null,
                diagnostics: [],
                message: 'worker died',
                subtype: 'crash'
            },
            kind: 'runner-error'
        });

        scope.assert.equal(terminal.text(), `${colors.red(figures.warning)} Runner error: worker died\n`);

        return scope.assert.collect();
    }),
    test('progress reporter skips live bars in non-interactive output', async function (scope: OverkillScope) {
        const terminal = createFakeTerminal();
        const reporter = createProgressReporter({
            interactive: false,
            stdout: terminal.output
        }, { showPassing: true, verbose: false })({
            failureArtifacts: defaultFailureArtifactPolicy,
            relativizeLocationPath(location) {
                return location.file;
            }
        });

        await reporter.onEvent({
            facts: { cases: [ passingCaseId ] },
            kind: 'run-start',
            root: { annotations: resolveRootTestAnnotations({}), title: 'root' },
            startedAt: '2026-07-15T00:00:00.000Z'
        });

        scope.assert.equal(terminal.text(), '');

        return scope.assert.collect();
    }),
    test('progress reporter keeps interactive runner errors for the final tree', async function (scope: OverkillScope) {
        const terminal = createFakeTerminal();
        const reporter = createProgressReporter({
            interactive: true,
            stdout: terminal.output
        }, { showPassing: true, verbose: false })({
            failureArtifacts: defaultFailureArtifactPolicy,
            relativizeLocationPath(location) {
                return location.file;
            }
        });

        await reporter.onEvent({
            facts: { cases: [] },
            kind: 'run-start',
            root: { annotations: resolveRootTestAnnotations({}), title: 'root' },
            startedAt: '2026-07-15T00:00:00.000Z'
        });
        await reporter.onEvent({
            error: {
                attributedToAttempt: null,
                attributedTo: null,
                cause: null,
                diagnostics: [],
                message: 'worker died',
                subtype: 'crash'
            },
            kind: 'runner-error'
        });

        scope.assert.equal(terminal.text(), '[....................] 0/0 failed=0');

        return scope.assert.collect();
    }),
    test('progress reporter renders unknown and empty planned counts', async function (scope: OverkillScope) {
        const unknownTerminal = createFakeTerminal();
        const emptyTerminal = createFakeTerminal();
        const unknownReporter = createProgressReporter({
            interactive: true,
            stdout: unknownTerminal.output
        }, { showPassing: true, verbose: false })({
            failureArtifacts: defaultFailureArtifactPolicy,
            relativizeLocationPath(location) {
                return location.file;
            }
        });
        const emptyReporter = createProgressReporter({
            interactive: true,
            stdout: emptyTerminal.output
        }, { showPassing: true, verbose: false })({
            failureArtifacts: defaultFailureArtifactPolicy,
            relativizeLocationPath(location) {
                return location.file;
            }
        });

        await unknownReporter.onEvent({
            facts: {},
            kind: 'run-start',
            root: { annotations: resolveRootTestAnnotations({}), title: 'root' },
            startedAt: '2026-07-15T00:00:00.000Z'
        });
        await emptyReporter.onEvent({
            facts: { cases: [] },
            kind: 'run-start',
            root: { annotations: resolveRootTestAnnotations({}), title: 'root' },
            startedAt: '2026-07-15T00:00:00.000Z'
        });

        scope.assert.equal(unknownTerminal.text(), '[....................] 0/? failed=0');
        scope.assert.equal(emptyTerminal.text(), '[....................] 0/0 failed=0');

        return scope.assert.collect();
    })
]);
