import type {
    CommandLineExitCode,
    CommandLineRunner,
    CommandLineRunnerResult
} from '../run/command-line.entry-point.ts';
import { dispatchOverkillCommand, type CommandLineParserExit } from './command-line-commands.ts';

type WritableOutput = {
    readonly write: (chunk: string) => unknown;
};

export type OverkillCommandLineRunRequest = {
    readonly arguments: readonly string[];
    readonly cwd: string;
    readonly loadRunner: () => Promise<CommandLineRunner>;
    readonly stderr: WritableOutput;
    readonly stdout: WritableOutput;
    readonly applyExitCode: (exitCode: CommandLineExitCode) => void;
};

const wrapperExitCodes = {
    argumentOrConfig: 3,
    internalCrash: 70,
    pass: 0
} as const;

function writeLine(output: WritableOutput, text: string): void {
    output.write(text.endsWith('\n') ? text : `${text}\n`);
}

function formatUnknownError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function writeStdoutLines(stdout: WritableOutput, result: CommandLineRunnerResult): void {
    for (const line of result.stdoutLines) {
        writeLine(stdout, line);
    }
}

function writeFallbackDiagnostics(stderr: WritableOutput, result: CommandLineRunnerResult): void {
    for (const diagnostic of result.fallbackDiagnostics) {
        writeLine(stderr, diagnostic);
    }
}

function applyDiagnosticExit(
    request: OverkillCommandLineRunRequest,
    message: string,
    exitCode: CommandLineExitCode
): void {
    writeLine(request.stderr, message);
    request.applyExitCode(exitCode);
}

function readParserExitCode(
    request: OverkillCommandLineRunRequest,
    parserExit: CommandLineParserExit
): CommandLineExitCode {
    if (parserExit.exitCode === 0) {
        writeLine(parserExit.into === 'stdout' ? request.stdout : request.stderr, parserExit.message);
        request.applyExitCode(wrapperExitCodes.pass);

        return wrapperExitCodes.pass;
    }

    applyDiagnosticExit(request, parserExit.message, wrapperExitCodes.argumentOrConfig);

    return wrapperExitCodes.argumentOrConfig;
}

function applyRunResultExit(
    request: OverkillCommandLineRunRequest,
    result: CommandLineRunnerResult
): CommandLineExitCode {
    writeStdoutLines(request.stdout, result);
    writeFallbackDiagnostics(request.stderr, result);
    request.applyExitCode(result.exitCode);

    return result.exitCode;
}

async function dispatchCommandLine(request: OverkillCommandLineRunRequest): Promise<CommandLineExitCode> {
    const result = await dispatchOverkillCommand(request.arguments, request.loadRunner, request.cwd);

    if (result.kind === 'parser-exit') {
        return readParserExitCode(request, result.exit);
    }

    return applyRunResultExit(request, result.result);
}

export async function runOverkillCommandLine(request: OverkillCommandLineRunRequest): Promise<CommandLineExitCode> {
    try {
        return await dispatchCommandLine(request);
    } catch (error: unknown) {
        applyDiagnosticExit(
            request,
            `Overkill internal error: ${formatUnknownError(error)}`,
            wrapperExitCodes.internalCrash
        );

        return wrapperExitCodes.internalCrash;
    }
}
