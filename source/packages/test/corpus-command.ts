import { command, subcommands, option, positional, string } from 'cmd-ts';
import {
    commandLineExitCodes,
    type CommandLineRunnerResult,
    type CommandLineRunner
} from '../run/command-line.entry-point.ts';

function validateCodecSelection(codec: string, exportName: string): CommandLineRunnerResult | null {
    if (codec === '' && exportName !== '') {
        return {
            exitCode: commandLineExitCodes.argumentOrConfig,
            runResult: null,
            stdoutLines: [],
            fallbackDiagnostics: [ '--codec-export requires --codec.' ]
        };
    }
    return null;
}

const corpusArguments = {
    path: positional({ type: string, displayName: 'path' }),
    entry: option({
        long: 'entry',
        type: string,
        defaultValue() {
            return '';
        }
    }),
    codec: option({
        long: 'codec',
        type: string,
        defaultValue() {
            return '';
        }
    }),
    codecExport: option({
        long: 'codec-export',
        type: string,
        defaultValue() {
            return '';
        }
    }),
    destination: option({
        long: 'to',
        type: string,
        defaultValue() {
            return '';
        }
    })
};
type CorpusArguments = {
    readonly path: string;
    readonly entry: string;
    readonly codec: string;
    readonly codecExport: string;
    readonly destination: string;
};
type CorpusHandler = (args: CorpusArguments) => Promise<CommandLineRunnerResult>;
type CorpusVerb = ReturnType<typeof command<typeof corpusArguments, CorpusHandler>>;
type CorpusParser = ReturnType<typeof subcommands<Record<string, CorpusVerb>>>;
export function createCorpusCommand(
    loadRunner: () => Promise<CommandLineRunner>,
    cwd: string,
    writePreview: (lines: readonly string[]) => Promise<void>
): CorpusParser {
    return subcommands({
        name: 'corpus',
        cmds: {
            ...Object.fromEntries(([ 'inspect', 'promote', 'migrate' ] as const).map(function corpusVerb(verb) {
                return [
                    verb,
                    command({
                        name: verb,
                        args: corpusArguments,
                        async handler(args) {
                            const invalid = validateCodecSelection(args.codec, args.codecExport);
                            if (invalid !== null) {
                                return invalid;
                            }
                            const runner = await loadRunner();
                            return await runner.corpus[verb]({
                                cwd,
                                source: args.entry === ''
                                    ? { kind: 'path', path: args.path }
                                    : { kind: 'cache-entry', path: args.path, entryId: args.entry },
                                codec: args.codec === ''
                                    ? { kind: 'built-in' }
                                    : {
                                        kind: 'module',
                                        path: args.codec,
                                        exportName: args.codecExport === '' ? 'default' : args.codecExport
                                    },
                                destination: args.destination === '' ? null : args.destination,
                                writePreview
                            });
                        }
                    })
                ];
            }))
        }
    });
}
