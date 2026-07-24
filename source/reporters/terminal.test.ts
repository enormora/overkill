import assert from 'node:assert/strict';
import ansiEscapes from 'ansi-escapes';
import { registerTest } from '../test-support/register-test.ts';
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

registerTest('visibleTerminalWidth() ignores ANSI escapes and counts Unicode display width', function () {
    assert.equal(visibleTerminalWidth('\u{1B}[31m✓\u{1B}[39m漢'), 3);
});

registerTest('terminal progress renderer redraws the full block on interactive resize', function () {
    const terminal = createFakeTerminal(4);
    const renderer = createTerminalProgressRenderer({
        interactive: true,
        output: terminal.output
    });

    renderer.writeMark('a');
    renderer.writeMark('b');
    renderer.writeMark('c');
    terminal.resize();

    assert.equal(terminal.text(), `abc${ansiEscapes.eraseLines(1)}ab\nc`);
});

registerTest('terminal progress renderer ignores resize before progress and after finish', function () {
    const terminal = createFakeTerminal(4);
    const renderer = createTerminalProgressRenderer({
        interactive: true,
        output: terminal.output
    });

    terminal.resize();
    renderer.writeMark('a');
    renderer.finish();
    terminal.resize();

    assert.equal(terminal.text(), 'a\n');
});

registerTest('terminal progress renderer does not emit cursor escapes in non-interactive output', function () {
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

    assert.equal(terminal.text(), 'ab\nc\n');
});

registerTest('terminal progress renderer falls back when output columns are invalid', function () {
    const terminal = createFakeTerminal(0);
    const renderer = createTerminalProgressRenderer({
        interactive: false,
        output: terminal.output
    });

    renderer.writeMark('a');
    renderer.writeMark('b');
    renderer.writeMark('c');

    assert.equal(terminal.text(), 'abc');
});

registerTest('terminal progress renderer treats finish as idempotent', function () {
    const terminal = createFakeTerminal(4);
    const renderer = createTerminalProgressRenderer({
        interactive: false,
        output: terminal.output
    });

    renderer.finish();
    renderer.finish();
    renderer.writeMark('a');

    assert.equal(terminal.text(), 'a');
});

registerTest('terminal progress renderer removes resize listener on dispose', function () {
    const terminal = createFakeTerminal(4);
    const renderer = createTerminalProgressRenderer({
        interactive: true,
        output: terminal.output
    });

    assert.equal(terminal.listenerCount(), 1);
    renderer.dispose();
    renderer.dispose();

    assert.equal(terminal.listenerCount(), 0);
});
