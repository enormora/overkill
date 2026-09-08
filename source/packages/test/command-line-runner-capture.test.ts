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

type RequestRecorder = {
    readonly recordList: (commandLineRequest: CommandLineListTestsRequest) => void;
    readonly recordRun: (commandLineRequest: CommandLineRunTestsRequest) => void;
};

const unexpectedCommand: CommandLineCommand = async function runUnexpectedCommand() {
    throw new Error('Unexpected command.');
};

function passingResult(): CommandLineRunnerResult {
    return {
        exitCode: 0,
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

function createRunner(requestRecorder: RequestRecorder): CommandLineRunner {
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
    readonly stdout: string;
}> {
    const stdout = createCapturedOutput();
    const stderr = createCapturedOutput();
    const exitCodes: CommandLineExitCode[] = [];
    const listRequests: CommandLineListTestsRequest[] = [];
    const runRequests: CommandLineRunTestsRequest[] = [];

    await runOverkillCommandLine({
        arguments: args,
        applyExitCode(exitCode) {
            exitCodes.push(exitCode);
        },
        cwd: '/project',
        async loadRunner() {
            return createRunner({
                recordList(request) {
                    listRequests.push(request);
                },
                recordRun(request) {
                    runRequests.push(request);
                }
            });
        },
        stderr: stderr.output,
        stdout: stdout.output
    });

    return {
        exitCodes,
        listRequests,
        runRequests,
        stderr: stderr.chunks.join(''),
        stdout: stdout.chunks.join('')
    };
}

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/packages/test/command-line-runner-capture.test.ts',
    metadata: {},
    children: [
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'overkill wrapper parses no-capture for run',
            metadata: {},
            async body(scope: TestScope) {
                const result = await runCommandLine([ 'run', '--no-capture', 'source/a.test.ts' ]);
                const [ commandLineRequest ] = result.runRequests;

                scope.assert.deepEqual(result.exitCodes, [ 0 ]);
                scope.require.defined(commandLineRequest);
                scope.assert.equal(commandLineRequest.runRequest.capture, 'live');
                scope.assert.deepEqual(commandLineRequest.runRequest.paths, [ 'source/a.test.ts' ]);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'overkill wrapper maps no-capture on list to an argument error',
            metadata: {},
            async body(scope: TestScope) {
                const result = await runCommandLine([ 'list', '--no-capture', 'source/a.test.ts' ]);

                scope.assert.deepEqual(result.exitCodes, [ 3 ]);
                scope.assert.equal(result.listRequests.length, 0);
                scope.assert.equal(result.stdout, '');
                scope.assert.true(result.stderr.includes('Unknown arguments'));
                scope.assert.true(result.stderr.includes('--no-capture'));

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
