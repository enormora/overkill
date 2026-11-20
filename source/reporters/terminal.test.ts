import { type TestNode, suite, test } from '@overkill-dev/test';

import ansiEscapes from 'ansi-escapes';

import { createTerminalProgressRenderer, type TerminalOutput, visibleTerminalWidth } from './terminal.ts';

type FakeTerminal = {
    readonly listenerCount: () => number;
    readonly output: TerminalOutput;
    readonly resize: () => void;
    readonly text: () => string;
};

function createFakeTerminal(columns: number): FakeTerminal {
    let currentColumns = columns;
    let text = '';
    let resizeListeners: readonly (() => void)[] = [];

    return {
        listenerCount() {
            return resizeListeners.length;
        },
        output: {
            get columns() {
                return currentColumns;
            },
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
        resize() {
            currentColumns = 2;
            for (const listener of resizeListeners) {
                listener();
            }
        },
        text() {
            return text;
        }
    };
}

export const testNode: TestNode = suite('Terminal', [
    test(
        'visibleTerminalWidth() ignores ANSI escapes and counts Unicode display width',
        function (scope) {
            scope.assert.equal(visibleTerminalWidth('\u{1B}[31m✓\u{1B}[39m漢'), 3);

            return scope.assert.collect();
        }
    ),
    test('terminal progress renderer redraws the full block on interactive resize', function (scope) {
        const terminal = createFakeTerminal(4);
        const renderer = createTerminalProgressRenderer({
            interactive: true,
            output: terminal.output
        });

        renderer.writeMark('a');
        renderer.writeMark('b');
        renderer.writeMark('c');
        terminal.resize();

        scope.assert.equal(terminal.text(), `abc${ansiEscapes.eraseLines(1)}ab\nc`);

        return scope.assert.collect();
    }),
    test('terminal progress renderer ignores resize before progress and after finish', function (scope) {
        const terminal = createFakeTerminal(4);
        const renderer = createTerminalProgressRenderer({
            interactive: true,
            output: terminal.output
        });

        terminal.resize();
        renderer.writeMark('a');
        renderer.finish();
        terminal.resize();

        scope.assert.equal(terminal.text(), 'a\n');

        return scope.assert.collect();
    }),
    test(
        'terminal progress renderer does not emit cursor escapes in non-interactive output',
        function (scope) {
            const terminal = createFakeTerminal(2);
            const renderer = createTerminalProgressRenderer({
                interactive: false,
                output: terminal.output
            });

            renderer.writeMark('a');
            renderer.writeMark('b');
            renderer.writeMark('c');
            terminal.resize();
            renderer.finish();

            scope.assert.equal(terminal.text(), 'ab\nc\n');

            return scope.assert.collect();
        }
    ),
    test('terminal progress renderer falls back when output columns are invalid', function (scope) {
        const terminal = createFakeTerminal(0);
        const renderer = createTerminalProgressRenderer({
            interactive: false,
            output: terminal.output
        });

        renderer.writeMark('a');
        renderer.writeMark('b');
        renderer.writeMark('c');

        scope.assert.equal(terminal.text(), 'abc');

        return scope.assert.collect();
    }),
    test('terminal progress renderer treats finish as idempotent', function (scope) {
        const terminal = createFakeTerminal(4);
        const renderer = createTerminalProgressRenderer({
            interactive: false,
            output: terminal.output
        });

        renderer.finish();
        renderer.finish();
        renderer.writeMark('a');

        scope.assert.equal(terminal.text(), 'a');

        return scope.assert.collect();
    }),
    test('terminal progress renderer removes resize listener on dispose', function (scope) {
        const terminal = createFakeTerminal(4);
        const renderer = createTerminalProgressRenderer({
            interactive: true,
            output: terminal.output
        });

        scope.assert.equal(terminal.listenerCount(), 1);
        renderer.dispose();
        renderer.dispose();

        scope.assert.equal(terminal.listenerCount(), 0);

        return scope.assert.collect();
    })
]);
