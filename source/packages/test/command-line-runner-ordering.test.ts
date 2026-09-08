import { createSuite, createTestCase, type TestScope } from '../engine/engine.entry-point.ts';
import type {
    CommandLineCommand,
    CommandLineExitCode,
    CommandLineListTestsRequest,
    CommandLineRunTestsRequest,
    CommandLineRunner,
    CommandLineRunnerResult
} from '../run/command-line.entry-point.ts';
import { runOverkillCommandLine } from './command-line-runner.ts';

type CapturedOutput = {
    readonly chunks: readonly string[];
    readonly output: {
        readonly write: (chunk: string) => unknown;
    };
};

type RecordedExitCodes = {
    readonly values: readonly number[];
    readonly apply: (exitCode: number) => void;
};

type RequestRecorder = {
    readonly recordList: (commandLineRequest: CommandLineListTestsRequest) => void;
    readonly recordRun: (commandLineRequest: CommandLineRunTestsRequest) => void;
};

const unexpectedCommand: CommandLineCommand = async function runUnexpectedCommand() {
    throw new Error('Unexpected command.');
};
const testExitCodes: {
    readonly pass: CommandLineExitCode;
} = {
    pass: 0
};

function passingResult(): CommandLineRunnerResult {
    return {
        exitCode: testExitCodes.pass,
        fallbackDiagnostics: [],
        runResult: null,
        stdoutLines: []
    };
}

function createCapturedOutput(): CapturedOutput {
    const chunks: string[] = [];

    return {
        chunks,
        output: {
            write(chunk) {
                chunks.push(chunk);
            }
        }
    };
}

function createRecordedExitCodes(): RecordedExitCodes {
    const values: number[] = [];

    return {
        values,
        apply(exitCode) {
            values.push(exitCode);
        }
    };
}

function commandLineRunner(requestRecorder: RequestRecorder): CommandLineRunner {
    return {
        baseline: {
            apply: unexpectedCommand,
            bootstrap: unexpectedCommand,
            diff: unexpectedCommand,
            list: unexpectedCommand,
            update: unexpectedCommand
        },
        bench: {
            baseline: {
                apply: unexpectedCommand,
                bootstrap: unexpectedCommand,
                diff: unexpectedCommand,
                list: unexpectedCommand,
                update: unexpectedCommand
            },
            listBenchmarks: unexpectedCommand,
            runBenchmarks: unexpectedCommand
        },
        async listTests(request) {
            requestRecorder.recordList(request);

            return passingResult();
        },
        replayRun: unexpectedCommand,
        replayWitness: unexpectedCommand,
        async runTests(request) {
            requestRecorder.recordRun(request);

            return passingResult();
        }
    };
}

async function runCommandLine(args: readonly string[]): Promise<{
    readonly exitCodes: readonly number[];
    readonly listRequests: readonly CommandLineListTestsRequest[];
    readonly runRequests: readonly CommandLineRunTestsRequest[];
    readonly stderr: string;
}> {
    const stderr = createCapturedOutput();
    const exitCodes = createRecordedExitCodes();
    const listRequests: CommandLineListTestsRequest[] = [];
    const runRequests: CommandLineRunTestsRequest[] = [];

    await runOverkillCommandLine({
        arguments: args,
        applyExitCode: exitCodes.apply,
        cwd: '/project',
        async loadRunner() {
            return commandLineRunner({
                recordList(request) {
                    listRequests.push(request);
                },
                recordRun(request) {
                    runRequests.push(request);
                }
            });
        },
        stderr: stderr.output,
        stdout: createCapturedOutput().output
    });

    return {
        exitCodes: exitCodes.values,
        listRequests,
        runRequests,
        stderr: stderr.chunks.join('')
    };
}

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/packages/test/command-line-runner-ordering.test.ts',
    metadata: {},
    children: [
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'overkill wrapper parses run order and seed flags',
            metadata: {},
            async body(scope: TestScope) {
                const result = await runCommandLine([
                    'run',
                    '--order',
                    'lexical',
                    '--seed',
                    '123',
                    'source/a.test.ts'
                ]);
                const [ commandLineRequest ] = result.runRequests;

                scope.assert.deepEqual(result.exitCodes, [ 0 ]);
                scope.require.defined(commandLineRequest);
                scope.assert.equal(commandLineRequest.runRequest.order, 'lexical');
                scope.assert.deepEqual(commandLineRequest.runRequest.seed, { value: 123n });

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'overkill wrapper parses list order and seed flags',
            metadata: {},
            async body(scope: TestScope) {
                const result = await runCommandLine([ 'list', '--order=seeded', '--seed=456', 'source/a.test.ts' ]);
                const [ commandLineRequest ] = result.listRequests;

                scope.assert.deepEqual(result.exitCodes, [ 0 ]);
                scope.require.defined(commandLineRequest);
                scope.assert.equal(commandLineRequest.listRequest.order, 'seeded');
                scope.assert.deepEqual(commandLineRequest.listRequest.seed, { value: 456n });

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'overkill wrapper rejects plan order from the CLI',
            metadata: {},
            async body(scope: TestScope) {
                const result = await runCommandLine([ 'run', '--order', 'plan', 'source/a.test.ts' ]);

                scope.assert.deepEqual(result.exitCodes, [ 3 ]);
                scope.assert.equal(result.runRequests.length, 0);
                scope.assert.true(result.stderr.includes('Expected one of'));
                scope.assert.true(result.stderr.includes('plan'));

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'overkill wrapper rejects invalid seed flags',
            metadata: {},
            async body(scope: TestScope) {
                const result = await runCommandLine([ 'run', '--seed', '-1', 'source/a.test.ts' ]);

                scope.assert.deepEqual(result.exitCodes, [ 3 ]);
                scope.assert.equal(result.runRequests.length, 0);
                scope.assert.true(result.stderr.includes('Run seed must be a nonnegative base-10 integer: -1'));

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
