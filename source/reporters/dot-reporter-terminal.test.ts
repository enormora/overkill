import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import type { TerminalOutput } from './terminal.ts';
import { createDotReporter } from './dot-reporter.ts';

type FakeTerminal = {
    readonly listenerCount: () => number;
    readonly output: TerminalOutput;
};

function createFakeTerminal(columns: number): FakeTerminal {
    let resizeListeners: readonly (() => void)[] = [];

    return {
        listenerCount() {
            return resizeListeners.length;
        },
        output: {
            columns,
            off(_event, listener) {
                resizeListeners = resizeListeners.filter(function keepRegistered(candidate) {
                    return candidate !== listener;
                });
            },
            on(_event, listener) {
                resizeListeners = [ ...resizeListeners, listener ];
            },
            write() {
                return true;
            }
        }
    };
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/reporters/dot-reporter-terminal.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'dot reporter disposes its resize listener',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const terminal = createFakeTerminal(80);
                const reporter = createDotReporter({
                    interactive: true,
                    stdout: terminal.output
                })({
                    relativizeLocationPath(location) {
                        return location.file;
                    }
                });

                scope.assert.equal(terminal.listenerCount(), 1);
                const { dispose } = reporter;

                if (dispose === null) {
                    throw new TypeError('Expected dot reporter to expose dispose.');
                }

                await dispose();

                scope.assert.equal(terminal.listenerCount(), 0);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
