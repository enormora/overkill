import { CorpusOperationError, type CorpusRequest, type CorpusWriteRequest } from './corpus-types.ts';
import { inspectCorpus, promoteWitness, migrateCorpus } from './corpus.ts';
import { commandLineExitCodes, type CommandLineRunnerResult } from './command-line-command.ts';

type CorpusCommandRequest = CorpusRequest & {
    readonly destination: string | null;
    readonly writePreview: (lines: readonly string[]) => Promise<void>;
};
export type CorpusCommands = Readonly<
    Record<'inspect' | 'migrate' | 'promote', (request: CorpusCommandRequest) => Promise<CommandLineRunnerResult>>
>;
const indentation = 2;
function completed(stdoutLines: readonly string[], fallbackDiagnostics: readonly string[]): CommandLineRunnerResult {
    return { exitCode: commandLineExitCodes.pass, runResult: null, stdoutLines, fallbackDiagnostics };
}
async function inspect(request: CorpusCommandRequest): Promise<CommandLineRunnerResult> {
    const result = await inspectCorpus(request);
    return completed([ JSON.stringify(result, null, indentation) ], result.diagnostics);
}
function writeRequest(request: CorpusCommandRequest): CorpusWriteRequest {
    if (request.destination === null) {
        throw new CorpusOperationError('A destination is required.', { cause: null }, 'selection');
    }
    return {
        ...request,
        destination: request.destination,
        async beforeWrite(preview) {
            await request.writePreview([ JSON.stringify(preview, null, indentation) ]);
        }
    };
}
const operations: CorpusCommands = {
    inspect,
    async promote(request) {
        const result = await promoteWitness(writeRequest(request));
        return completed([ `Created ${result.destination}` ], []);
    },
    async migrate(request) {
        const result = await migrateCorpus(writeRequest(request));
        return completed([ `Created ${result.destination}` ], []);
    }
};
function failure(error: unknown): CommandLineRunnerResult {
    const invalid = error instanceof CorpusOperationError && [ 'selection', 'invalid-source' ].includes(error.code());
    return {
        exitCode: invalid ? commandLineExitCodes.argumentOrConfig : commandLineExitCodes.runnerError,
        runResult: null,
        stdoutLines: [],
        fallbackDiagnostics: [ String(error) ]
    };
}
async function execute(verb: keyof CorpusCommands, request: CorpusCommandRequest): Promise<CommandLineRunnerResult> {
    try {
        return await operations[verb](request);
    } catch (error: unknown) {
        return failure(error);
    }
}
export const corpusCommands: CorpusCommands = {
    async inspect(request) {
        return await execute('inspect', request);
    },
    async promote(request) {
        return await execute('promote', request);
    },
    async migrate(request) {
        return await execute('migrate', request);
    }
};
