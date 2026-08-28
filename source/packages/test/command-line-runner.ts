import {
    command,
    flag,
    multioption,
    option,
    restPositionals,
    runSafely,
    string,
    subcommands,
    type Type
} from 'cmd-ts';
import type {
    CommandLineExitCode,
    CommandLineListTestsRequest,
    CommandLineRunTestsRequest,
    CommandLineRunner,
    CommandLineRunnerResult
} from '../run/command-line.entry-point.ts';

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

type ResourceBudgetOverrides = NonNullable<CommandLineRunTestsRequest['runRequest']['resourceBudgetOverrides']>;

type ResourceBudgetName = keyof ResourceBudgetOverrides;

type ResourceBudgetOverride = {
    readonly name: ResourceBudgetName;
    readonly value: number;
};

type RunCommandArguments = {
    readonly configPath: string | null;
    readonly measureResourceUsage: boolean;
    readonly paths: readonly string[];
    readonly profile: string;
    readonly resourceBudgetOverrides: ResourceBudgetOverrides | null;
};

type ListCommandArguments = {
    readonly configPath: string | null;
    readonly paths: readonly string[];
    readonly profile: string;
    readonly withOrphans: boolean;
};

type CmdTsExitConfig = {
    readonly exitCode: number;
    readonly into: 'stderr' | 'stdout';
    readonly message: string;
};

type CmdTsExit = {
    readonly config: CmdTsExitConfig;
};

type CmdTsRunFailure = {
    readonly error: CmdTsExit;
};

type CmdTsRunSuccess = {
    readonly value: {
        readonly value: CommandLineRunnerResult | Promise<CommandLineRunnerResult>;
    };
};

const defaultResourceBudgetOverrides: ResourceBudgetOverrides = {
    activeResourceCount: null,
    javaScriptEngineHeapBytes: null,
    residentSetBytes: null,
    residentSetGrowthBytesPerSecond: null
};

const resourceBudgetNames: ReadonlySet<string> = new Set([
    'activeResourceCount',
    'javaScriptEngineHeapBytes',
    'residentSetBytes',
    'residentSetGrowthBytesPerSecond'
]);

const wrapperExitCodes: {
    readonly argumentOrConfig: CommandLineExitCode;
    readonly internalCrash: CommandLineExitCode;
    readonly pass: CommandLineExitCode;
} = {
    argumentOrConfig: 3,
    internalCrash: 70,
    pass: 0
};

function writeLine(output: WritableOutput, text: string): void {
    output.write(text.endsWith('\n') ? text : `${text}\n`);
}

function formatUnknownError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function isInspectableObject(value: unknown): value is Readonly<Record<string, unknown>> {
    return value !== null && typeof value === 'object';
}

function isCmdTsOutputTarget(value: unknown): value is CmdTsExitConfig['into'] {
    return value === 'stderr' || value === 'stdout';
}

function isCmdTsExitConfig(value: unknown): value is CmdTsExitConfig {
    return isInspectableObject(value) &&
        typeof value.exitCode === 'number' &&
        isCmdTsOutputTarget(value.into) &&
        typeof value.message === 'string';
}

function isCmdTsExit(value: unknown): value is CmdTsExit {
    return isInspectableObject(value) && isCmdTsExitConfig(value.config);
}

function createBudgetOverrides(): ResourceBudgetOverrides {
    return { ...defaultResourceBudgetOverrides };
}

function isResourceBudgetName(name: string): name is ResourceBudgetName {
    return resourceBudgetNames.has(name);
}

function parseResourceBudgetName(name: string): ResourceBudgetName {
    if (isResourceBudgetName(name)) {
        return name;
    }

    throw new TypeError(`Unknown resource budget name: ${name}`);
}

function parseResourceBudgetValue(value: string): number {
    if (value === '') {
        throw new TypeError('Resource budget value must not be empty.');
    }

    const parsedValue = Number(value);

    if (!Number.isFinite(parsedValue)) {
        throw new TypeError(`Resource budget value must be numeric: ${value}`);
    }

    return parsedValue;
}

function parseResourceBudgetOverride(rawValue: string): ResourceBudgetOverride {
    const separatorIndex = rawValue.indexOf('=');

    if (separatorIndex <= 0) {
        throw new TypeError(`Resource budget must use name=value syntax: ${rawValue}`);
    }

    return {
        name: parseResourceBudgetName(rawValue.slice(0, separatorIndex)),
        value: parseResourceBudgetValue(rawValue.slice(separatorIndex + 1))
    };
}

function assignResourceBudgetOverride(
    overrides: ResourceBudgetOverrides,
    override: ResourceBudgetOverride
): ResourceBudgetOverrides {
    return {
        ...overrides,
        [override.name]: override.value
    };
}

function assertUnusedResourceBudgetName(
    seenNames: ReadonlySet<ResourceBudgetName>,
    name: ResourceBudgetName
): void {
    if (seenNames.has(name)) {
        throw new TypeError(`Duplicate resource budget name: ${name}`);
    }
}

function parseResourceBudgetOverrides(rawValues: readonly string[]): ResourceBudgetOverrides {
    let overrides = createBudgetOverrides();
    const seenNames = new Set<ResourceBudgetName>();

    for (const rawValue of rawValues) {
        const override = parseResourceBudgetOverride(rawValue);

        assertUnusedResourceBudgetName(seenNames, override.name);
        seenNames.add(override.name);
        overrides = assignResourceBudgetOverride(overrides, override);
    }

    return overrides;
}

const configPathType: Type<string, string | null> = {
    async from(value) {
        return value;
    }
};

const resourceBudgetOverridesType: Type<string[], ResourceBudgetOverrides | null> = {
    displayName: 'name=value',
    async from(rawValues) {
        return rawValues.length === 0 ? null : parseResourceBudgetOverrides(rawValues);
    }
};

function readMeasureResourceUsage(args: RunCommandArguments): boolean | null {
    if (args.measureResourceUsage || args.resourceBudgetOverrides !== null) {
        return true;
    }

    return null;
}

function createRunTestsRequest(args: RunCommandArguments, cwd: string): CommandLineRunTestsRequest {
    return {
        configPath: args.configPath,
        cwd,
        runRequest: {
            baselineUpdateMode: 'none',
            capabilityRestrictions: { mode: 'enabled' },
            capture: 'buffered',
            debug: {
                mode: 'off',
                selectors: []
            },
            execution: { mode: 'profile-default' },
            measureResourceUsage: readMeasureResourceUsage(args),
            order: 'plan',
            paths: args.paths,
            profile: args.profile,
            resourceBudgetOverrides: args.resourceBudgetOverrides,
            resourceUsageSamplingIntervalMilliseconds: null,
            seed: { value: null },
            selection: { kind: 'all' },
            shard: { index: 0, total: 1 },
            verbose: false
        }
    };
}

function createListTestsRequest(args: ListCommandArguments, cwd: string): CommandLineListTestsRequest {
    return {
        configPath: args.configPath,
        cwd,
        listRequest: {
            paths: args.paths,
            profile: args.profile,
            withOrphans: args.withOrphans
        }
    };
}

function createOverkillCommand(
    loadRunner: () => Promise<CommandLineRunner>,
    cwd: string
): Parameters<typeof runSafely>[0] {
    const runCommand = command({
        name: 'run',
        args: {
            configPath: option({
                long: 'config',
                type: configPathType,
                defaultValue() {
                    return null;
                }
            }),
            measureResourceUsage: flag({ long: 'measure-resource-usage' }),
            profile: option({
                long: 'profile',
                type: string,
                defaultValue() {
                    return 'microtest';
                }
            }),
            resourceBudgetOverrides: multioption({
                long: 'resource-budget',
                type: resourceBudgetOverridesType,
                defaultValue() {
                    return null;
                }
            }),
            paths: restPositionals({ displayName: 'path' })
        },
        async handler(args: RunCommandArguments) {
            const runner = await loadRunner();

            return await runner.runTests(createRunTestsRequest(args, cwd));
        }
    });
    const listCommand = command({
        name: 'list',
        args: {
            configPath: option({
                long: 'config',
                type: configPathType,
                defaultValue() {
                    return null;
                }
            }),
            profile: option({
                long: 'profile',
                type: string,
                defaultValue() {
                    return 'microtest';
                }
            }),
            withOrphans: flag({ long: 'with-orphans' }),
            paths: restPositionals({ displayName: 'path' })
        },
        async handler(args: ListCommandArguments) {
            const runner = await loadRunner();

            return await runner.listTests(createListTestsRequest(args, cwd));
        }
    });

    return subcommands({
        name: 'overkill',
        cmds: { list: listCommand, run: runCommand }
    });
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

function applyCmdTsExit(request: OverkillCommandLineRunRequest, message: string, exitCode: CommandLineExitCode): void {
    writeLine(request.stderr, message);
    request.applyExitCode(exitCode);
}

function applyCmdTsSuccessExit(
    request: OverkillCommandLineRunRequest,
    message: string,
    into: 'stderr' | 'stdout'
): void {
    writeLine(into === 'stdout' ? request.stdout : request.stderr, message);
    request.applyExitCode(wrapperExitCodes.pass);
}

async function readCmdTsErrorExitCode(
    request: OverkillCommandLineRunRequest,
    error: CmdTsExit
): Promise<CommandLineExitCode> {
    if (error.config.exitCode === 0) {
        applyCmdTsSuccessExit(request, error.config.message, error.config.into);

        return wrapperExitCodes.pass;
    }

    applyCmdTsExit(request, error.config.message, wrapperExitCodes.argumentOrConfig);

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

function isCmdTsRunFailure(result: unknown): result is CmdTsRunFailure {
    return isInspectableObject(result) &&
        Object.hasOwn(result, 'error') &&
        isCmdTsExit(result.error);
}

function isCmdTsRunSuccess(result: unknown): result is CmdTsRunSuccess {
    if (!isInspectableObject(result) || !Object.hasOwn(result, 'value')) {
        return false;
    }

    const commandResult = result.value;

    return isInspectableObject(commandResult) && Object.hasOwn(commandResult, 'value');
}

async function runWithCmdTs(request: OverkillCommandLineRunRequest): Promise<CommandLineExitCode> {
    const result: unknown = await runSafely(
        createOverkillCommand(request.loadRunner, request.cwd),
        Array.from(request.arguments)
    );

    if (isCmdTsRunFailure(result)) {
        return await readCmdTsErrorExitCode(request, result.error);
    }

    if (!isCmdTsRunSuccess(result)) {
        throw new Error('Unexpected command-line parser result.');
    }

    return applyRunResultExit(request, await result.value.value);
}

export async function runOverkillCommandLine(request: OverkillCommandLineRunRequest): Promise<CommandLineExitCode> {
    try {
        return await runWithCmdTs(request);
    } catch (error: unknown) {
        applyCmdTsExit(
            request,
            `Overkill internal error: ${formatUnknownError(error)}`,
            wrapperExitCodes.internalCrash
        );

        return wrapperExitCodes.internalCrash;
    }
}
