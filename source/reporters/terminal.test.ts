import ansiEscapes from 'ansi-escapes';
import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import {
    createTerminalProgressRenderer,
    type TerminalOutput,
    visibleTerminalWidth
} from './terminal.ts';

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

export const testSuite = createOverkillSuite({
    name: 'source/reporters/terminal.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'visibleTerminalWidth() ignores ANSI escapes and counts Unicode display width',
            metadata: {},
            body(scope: OverkillScope) {
                scope.assert.equal(visibleTerminalWidth('\u{1B}[31m✓\u{1B}[39m漢'), 3);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'terminal progress renderer redraws the full block on interactive resize',
            metadata: {},
            body(scope: OverkillScope) {
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
            }
        }),
        createOverkillTestCase({
            name: 'terminal progress renderer ignores resize before progress and after finish',
            metadata: {},
            body(scope: OverkillScope) {
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
            }
        }),
        createOverkillTestCase({
            name: 'terminal progress renderer does not emit cursor escapes in non-interactive output',
            metadata: {},
            body(scope: OverkillScope) {
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
        }),
        createOverkillTestCase({
            name: 'terminal progress renderer falls back when output columns are invalid',
            metadata: {},
            body(scope: OverkillScope) {
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
            }
        }),
        createOverkillTestCase({
            name: 'terminal progress renderer treats finish as idempotent',
            metadata: {},
            body(scope: OverkillScope) {
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
            }
        }),
        createOverkillTestCase({
            name: 'terminal progress renderer removes resize listener on dispose',
            metadata: {},
            body(scope: OverkillScope) {
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
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
