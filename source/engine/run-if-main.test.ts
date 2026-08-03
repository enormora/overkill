import assert from 'node:assert/strict';
import { createDeterministicWallClock } from '@enormora/wall-clock';
import sinon from 'sinon';
import { registerTest } from '../test-support/register-test.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { createEngine, type Engine } from './engine.ts';
import type { Execute } from './execution.ts';
import type { RunResult } from './run-result.ts';
import type { TestNode } from './test-node.ts';

type RunIfMainFixture = {
    readonly engine: Engine;
    readonly execute: sinon.SinonSpy<Parameters<Execute>, ReturnType<Execute>>;
    readonly readExitCode: () => number | string | null | undefined;
    readonly testNode: TestNode;
};

function importMeta(main: boolean): ImportMeta {
    return {
        dirname: '/test',
        filename: '/test/file.test.ts',
        main,
        resolve(specifier) {
            return specifier;
        },
        url: 'file:///test/file.test.ts'
    };
}

function createRunIfMainFixture(
    result: RunResult,
    initialExitCode: number | string | null | undefined
): RunIfMainFixture {
    let exitCode = initialExitCode;
    const wallClock = createDeterministicWallClock({
        initialCurrentTimestampInMilliseconds: Date.UTC(2026, 6, 15, 12, 30, 0)
    });
    const execute = sinon.fake<Parameters<Execute>, ReturnType<Execute>>(
        async function executeRun(): Promise<RunResult> {
            return result;
        }
    );
    const engine = createEngine({
        execute,
        nodeVersion: '26.1.1',
        readExitCode() {
            return exitCode;
        },
        wallClock,
        writeExitCode(nextExitCode) {
            exitCode = nextExitCode;
        }
    });
    const testNode = engine.createTestCase({
        body(testContext) {
            testContext.assert.true(true, { message: 'passes' });
            return testContext.assert.collect();
        },
        metadata: {},
        name: 'passes'
    });

    return {
        engine,
        execute,
        readExitCode() {
            return exitCode;
        },
        testNode
    };
}

registerTest('runIfMain() does nothing when the module is imported', async function () {
    const fixture = createRunIfMainFixture(runResultFactory.build(), '7');

    await fixture.engine.runIfMain(importMeta(false), fixture.testNode);

    assert.equal(fixture.execute.callCount, 0);
    assert.equal(fixture.readExitCode(), '7');
});

registerTest('runIfMain() executes the test node when the module is main', async function () {
    const fixture = createRunIfMainFixture(runResultFactory.build(), undefined);

    await fixture.engine.runIfMain(importMeta(true), fixture.testNode);

    assert.equal(fixture.execute.callCount, 1);
    assert.equal(fixture.execute.firstCall.args[0].cases[0].id.name, 'passes');
});

registerTest('runIfMain() defaults to no reporters and auto run facts', async function () {
    const fixture = createRunIfMainFixture(runResultFactory.build(), undefined);

    await fixture.engine.runIfMain(importMeta(true), fixture.testNode);

    assert.deepStrictEqual(fixture.execute.firstCall.args[1], {
        reporters: [],
        runFacts: { nodeVersion: '26.1.1' },
        startedAt: '2026-07-15T12:30:00.000Z'
    });
});

registerTest('runIfMain() passes reporters and merges run facts', async function () {
    const fixture = createRunIfMainFixture(runResultFactory.build(), undefined);
    const reporter = {
        dispose: null,
        kind: 'final-result' as const,
        name: 'final',
        onResult() {
            return undefined;
        },
        sinks: []
    };

    await fixture.engine.runIfMain(importMeta(true), fixture.testNode, {
        reporters: [ reporter ],
        runFacts: {
            nodeVersion: '0.0.0',
            seed: 42
        }
    });

    assert.deepStrictEqual(fixture.execute.firstCall.args[1], {
        reporters: [ reporter ],
        runFacts: {
            nodeVersion: '26.1.1',
            seed: 42
        },
        startedAt: '2026-07-15T12:30:00.000Z'
    });
});

registerTest('runIfMain() leaves exit code unchanged when the run passes', async function () {
    const fixture = createRunIfMainFixture(runResultFactory.build(), undefined);

    await fixture.engine.runIfMain(importMeta(true), fixture.testNode);

    assert.equal(fixture.readExitCode(), undefined);
});

registerTest('runIfMain() sets exit code when tests fail', async function () {
    const fixture = createRunIfMainFixture(runResultFactory.build({ summary: { failed: 1 } }), 0);

    await fixture.engine.runIfMain(importMeta(true), fixture.testNode);

    assert.equal(fixture.readExitCode(), 1);
});

registerTest('runIfMain() sets exit code when runner errors are reported', async function () {
    const fixture = createRunIfMainFixture(runResultFactory.build({ runnerErrors: [ {} ] }), '0');

    await fixture.engine.runIfMain(importMeta(true), fixture.testNode);

    assert.equal(fixture.readExitCode(), 1);
});

registerTest('runIfMain() treats a null exit code as unset', async function () {
    const fixture = createRunIfMainFixture(runResultFactory.build({ summary: { failed: 1 } }), null);

    await fixture.engine.runIfMain(importMeta(true), fixture.testNode);

    assert.equal(fixture.readExitCode(), 1);
});

registerTest('runIfMain() preserves an existing nonzero exit code', async function () {
    const fixture = createRunIfMainFixture(runResultFactory.build({ summary: { failed: 1 } }), 2);

    await fixture.engine.runIfMain(importMeta(true), fixture.testNode);

    assert.equal(fixture.readExitCode(), 2);
});

registerTest('runIfMain() rejects planning or execution errors', async function () {
    let exitCode: number | string | undefined = 0;
    const wallClock = createDeterministicWallClock();
    const execute = sinon.fake<Parameters<Execute>, ReturnType<Execute>>(
        async function executeRun(): Promise<RunResult> {
            throw new Error('execution failed');
        }
    );
    const engine = createEngine({
        execute,
        nodeVersion: '26.1.1',
        readExitCode() {
            return exitCode;
        },
        wallClock,
        writeExitCode(nextExitCode) {
            exitCode = nextExitCode;
        }
    });
    const testNode = engine.createTestCase({
        body(testContext) {
            testContext.assert.true(true, { message: 'passes' });
            return testContext.assert.collect();
        },
        metadata: {},
        name: 'passes'
    });

    await assert.rejects(
        async function runMain() {
            await engine.runIfMain(importMeta(true), testNode);
        },
        { message: 'execution failed' }
    );
    assert.equal(exitCode, 0);
});
