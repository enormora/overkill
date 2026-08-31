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
import {
    all,
    contains,
    equals,
    parseRunFilterExpression,
    type RunFilter,
    type RunSelection
} from '../run/filters.entry-point.ts';

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
    readonly file: string | null;
    readonly filter: RunFilter | null;
    readonly measureResourceUsage: boolean;
    readonly name: string | null;
    readonly paths: readonly string[];
    readonly profile: string;
    readonly resourceBudgetOverrides: ResourceBudgetOverrides | null;
};

type ListCommandArguments = {
    readonly configPath: string | null;
    readonly file: string | null;
    readonly filter: RunFilter | null;
    readonly name: string | null;
    readonly paths: readonly string[];
    readonly profile: string;
    readonly withLocations: boolean;
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

const filterExpressionType: Type<string, RunFilter | null> = {
    displayName: 'expr',
    async from(value) {
        await Promise.resolve();

        return parseRunFilterExpression(value);
    }
};

function parseNonEmptySelectorText(label: string, value: string): string {
    if (value.trim().length === 0) {
        throw new TypeError(`${label} must not be empty.`);
    }

    return value;
}

const fileSelectionType: Type<string, string | null> = {
    displayName: 'path',
    async from(value) {
        return parseNonEmptySelectorText('File selector', value);
    }
};

const nameSelectionType: Type<string, string | null> = {
    displayName: 'text',
    async from(value) {
        return parseNonEmptySelectorText('Name selector', value);
    }
};

function readMeasureResourceUsage(args: RunCommandArguments): boolean | null {
    if (args.measureResourceUsage || args.resourceBudgetOverrides !== null) {
        return true;
    }

    return null;
}

function selectionFromFilters(filters: readonly RunFilter[]): RunSelection {
    const [ firstFilter, ...remainingFilters ] = filters;

    if (firstFilter === undefined) {
        return { kind: 'all' };
    }

    return {
        filter: remainingFilters.length === 0 ? firstFilter : all([ firstFilter, ...remainingFilters ]),
        kind: 'filter'
    };
}

function createSelection(args: Pick<RunCommandArguments, 'file' | 'filter' | 'name'>): RunSelection {
    const filters: RunFilter[] = [];

    if (args.filter !== null) {
        filters.push(args.filter);
    }

    if (args.name !== null) {
        filters.push(contains('name', args.name));
    }

    if (args.file !== null) {
        filters.push(equals('file', args.file));
    }

    return selectionFromFilters(filters);
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
            selection: createSelection(args),
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
            selection: createSelection(args),
            withLocations: args.withLocations,
            withOrphans: args.withOrphans
        }
    };
}

const sharedCommandArguments = {
    configPath: option({
        long: 'config',
        type: configPathType,
        defaultValue() {
            return null;
        }
    }),
    file: option({
        long: 'file',
        type: fileSelectionType,
        defaultValue() {
            return null;
        }
    }),
    filter: option({
        long: 'filter',
        type: filterExpressionType,
        defaultValue() {
            return null;
        }
    }),
    name: option({
        long: 'name',
        type: nameSelectionType,
        defaultValue() {
            return null;
        }
    }),
    paths: restPositionals({ displayName: 'path' }),
    profile: option({
        long: 'profile',
        type: string,
        defaultValue() {
            return 'microtest';
        }
    })
};

function createOverkillCommand(
    loadRunner: () => Promise<CommandLineRunner>,
    cwd: string
): Parameters<typeof runSafely>[0] {
    const runCommand = command({
        name: 'run',
        args: {
            ...sharedCommandArguments,
            measureResourceUsage: flag({ long: 'measure-resource-usage' }),
            resourceBudgetOverrides: multioption({
                long: 'resource-budget',
                type: resourceBudgetOverridesType,
                defaultValue() {
                    return null;
                }
            })
        },
        async handler(args: RunCommandArguments) {
            const runner = await loadRunner();

            return await runner.runTests(createRunTestsRequest(args, cwd));
        }
    });
    const listCommand = command({
        name: 'list',
        args: {
            ...sharedCommandArguments,
            withLocations: flag({ long: 'with-locations' }),
            withOrphans: flag({ long: 'with-orphans' })
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
