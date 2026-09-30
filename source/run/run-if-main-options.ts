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

export function rootTitle(options: RunIfMainOptions | undefined, cwd: string): string {
    return options?.root?.title ?? cwd;
}
