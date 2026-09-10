import type {
    TestAnnotationsInput,
    TestControlsInput
} from '../engine/test-data.ts';
import type { DefinedReporter } from '../engine/reporter.ts';
import type { DefinedOutputRenderer } from '../engine/reporter-output.ts';
import { createDefaultDirectReporter } from './default-direct-reporter.ts';
import type { LoadedRunConfig } from './run-config.ts';
import type { RunProfileConfig } from './run-types.ts';

export type RunIfMainRootOptions = {
    readonly annotations?: TestAnnotationsInput;
    readonly controls?: TestControlsInput;
    readonly title: string;
};

export type RunIfMainOptions = {
    readonly outputRenderer?: DefinedOutputRenderer;
    readonly reporters?: readonly DefinedReporter[];
    readonly root?: RunIfMainRootOptions;
};

const supervisedDowngradeWarning = [
    'Overkill warning: runIfMain() executes in the current process;',
    'supervised-process isolation is unavailable for direct Node execution.'
]
    .join(' ');

function stderrWarning(message: string): void {
    process.stderr.write(`${message}\n`);
}

export async function selectedReporters(
    profile: RunProfileConfig,
    config: LoadedRunConfig,
    options: RunIfMainOptions | undefined
): Promise<readonly DefinedReporter[]> {
    if (options?.reporters !== undefined) {
        return options.reporters;
    }

    if (profile.reporters !== null) {
        return profile.reporters;
    }

    if (config.reporters !== null) {
        return config.reporters;
    }

    return [ await createDefaultDirectReporter() ];
}

export function selectedOutputRenderer(
    config: LoadedRunConfig,
    options: RunIfMainOptions | undefined
): DefinedOutputRenderer {
    return options?.outputRenderer ?? config.outputRenderer;
}

export function rootAnnotations(options: RunIfMainOptions | undefined): TestAnnotationsInput {
    return options?.root?.annotations ?? {};
}

export function rootControls(options: RunIfMainOptions | undefined): TestControlsInput {
    return options?.root?.controls ?? {};
}

export function rootTitle(options: RunIfMainOptions | undefined): string {
    return options?.root?.title ?? process.cwd();
}

export function executionMode(profile: RunProfileConfig): 'concurrent-in-process' | 'serial-in-process' {
    return profile.execution.scheduling === 'concurrent' ? 'concurrent-in-process' : 'serial-in-process';
}

export function warnOnSupervisedDowngrade(profile: RunProfileConfig): void {
    if (profile.execution.processModel === 'supervised-process') {
        stderrWarning(supervisedDowngradeWarning);
    }
}
