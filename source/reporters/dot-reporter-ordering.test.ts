import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type ResolvedMetadata,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { createDotReporter } from './dot-reporter.ts';
import type { TerminalOutput } from './terminal.ts';

type FakeTerminal = {
    readonly output: TerminalOutput;
    readonly text: () => string;
};

const rootMetadata: ResolvedMetadata = {
    baselines: [],
    capabilities: [],
    capture: null,
    debug: false,
    extra: {},
    kind: null,
    ownership: [],
    priority: 'standard',
    runtimes: [],
    stability: 'stable',
    tags: [],
    timeoutMilliseconds: null
};

function createFakeTerminal(columns: number): FakeTerminal {
    let text = '';

    return {
        output: {
            columns,
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
    title: 'source/reporters/dot-reporter-ordering.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'dot reporter prints order and seed on run start',
            metadata: {},
            async body(scope: OverkillScope) {
                const terminal = createFakeTerminal(80);
                const reporter = createDotReporter({
                    interactive: false,
                    stdout: terminal.output
                })({
                    relativizeLocationPath(location) {
                        return location.file;
                    }
                });

                await reporter.onEvent({
                    facts: {
                        execution: { order: 'seeded' },
                        reproducibility: { seed: '123' }
                    },
                    kind: 'run-start',
                    root: { metadata: rootMetadata, title: 'source' },
                    startedAt: '2026-07-15T00:00:00.000Z'
                });

                scope.assert.equal(terminal.text(), 'order=seeded seed=123\n');

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
