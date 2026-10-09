import type {
    CommandLineCommand,
    CommandLineBenchmarkRunRequest,
    CommandLineBenchmarkListRequest,
    CommandLineExitCode,
    CommandLineListTestsRequest,
    CommandLineRunTestsRequest,
    CommandLineRunnerResult
} from '../run/command-line-command.ts';
import type { CommandLineRunner } from '../run/command-line-runner.ts';
import { runOverkillCommandLine } from '../packages/test/command-line-runner.ts';

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
    readonly recordBenchmarkList: (context: CommandLineBenchmarkListRequest) => void;
    readonly recordBenchmarkRun: (context: CommandLineBenchmarkRunRequest) => void;
    readonly recordList: (commandLineRequest: CommandLineListTestsRequest) => void;
    readonly recordRun: (commandLineRequest: CommandLineRunTestsRequest) => void;
};

const unexpectedCommand: CommandLineCommand = async function runUnexpectedCommand() {
    throw new Error('Unexpected command.');
};

export const testExitCodes: {
    readonly pass: CommandLineExitCode;
    readonly runnerError: CommandLineExitCode;
} = {
    pass: 0,
    runnerError: 2
};

export function passingResult(): CommandLineRunnerResult {
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

function readRunnerResult(result: CommandLineRunnerResult | Error): CommandLineRunnerResult {
    if (result instanceof Error) {
        throw result;
    }

    return result;
}

function createRunner(
    requestRecorder: RequestRecorder,
    result: CommandLineRunnerResult | Error
): CommandLineRunner {
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
            async listBenchmarks(context) {
                requestRecorder.recordBenchmarkList(context);

                return readRunnerResult(result);
            },
            async runBenchmarks(context) {
                requestRecorder.recordBenchmarkRun(context);

                return readRunnerResult(result);
            }
        },
        async listTests(request) {
            requestRecorder.recordList(request);

            return readRunnerResult(result);
        },
        replayRun: unexpectedCommand,
        replayWitness: unexpectedCommand,
        async runTests(request) {
            requestRecorder.recordRun(request);

            return readRunnerResult(result);
        }
    };
}

export async function runCommandLine(
    args: readonly string[],
    runnerResult: CommandLineRunnerResult | Error
): Promise<{
    readonly benchmarkListRequests: readonly CommandLineBenchmarkListRequest[];
    readonly benchmarkRunRequests: readonly CommandLineBenchmarkRunRequest[];
    readonly exitCode: CommandLineExitCode;
    readonly exitCodes: readonly number[];
    readonly listRequests: readonly CommandLineListTestsRequest[];
    readonly runRequests: readonly CommandLineRunTestsRequest[];
    readonly runnerLoadCount: number;
    readonly stderr: string;
    readonly stdout: string;
}> {
    const stdout = createCapturedOutput();
    const stderr = createCapturedOutput();
    const exitCodes = createRecordedExitCodes();
    const listRequests: CommandLineListTestsRequest[] = [];
    const runRequests: CommandLineRunTestsRequest[] = [];
    const benchmarkListRequests: CommandLineBenchmarkListRequest[] = [];
    const benchmarkRunRequests: CommandLineBenchmarkRunRequest[] = [];
    let runnerLoadCount = 0;

    const exitCode = await runOverkillCommandLine({
        arguments: args,
        applyExitCode: exitCodes.apply,
        cwd: '/project',
        async loadRunner() {
            runnerLoadCount += 1;

            return createRunner({
                recordBenchmarkList(context) {
                    benchmarkListRequests.push(context);
                },
                recordBenchmarkRun(context) {
                    benchmarkRunRequests.push(context);
                },
                recordList(request) {
                    listRequests.push(request);
                },
                recordRun(request) {
                    runRequests.push(request);
                }
            }, runnerResult);
        },
        stderr: stderr.output,
        stdout: stdout.output
    });

    return {
        benchmarkListRequests,
        benchmarkRunRequests,
        exitCode,
        exitCodes: exitCodes.values,
        listRequests,
        runRequests,
        runnerLoadCount,
        stderr: stderr.chunks.join(''),
        stdout: stdout.chunks.join('')
    };
}
