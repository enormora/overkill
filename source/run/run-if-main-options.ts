import type {
    Metadata,
    TestFamily
} from '../engine/metadata.ts';
import type { Reporter } from '../engine/reporter.ts';
import type { OutputRenderer } from '../engine/reporter-output.ts';
import { createDefaultDirectReporter } from './default-direct-reporter.ts';
import type { LoadedRunConfig } from './run-config.ts';
import type {
    RunMicrotestProfileConfig,
    RunTestFamily
} from './run-types.ts';

export type RunIfMainRootOptions = {
    readonly metadata: Metadata;
    readonly title: string;
};

export type RunIfMainOptions = {
    readonly outputRenderer?: OutputRenderer;
    readonly reporters?: readonly Reporter[];
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
    profile: RunMicrotestProfileConfig,
    config: LoadedRunConfig,
    options: RunIfMainOptions | undefined
): Promise<readonly Reporter[]> {
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

export function selectedOutputRenderer(config: LoadedRunConfig, options: RunIfMainOptions | undefined): OutputRenderer {
    return options?.outputRenderer ?? config.outputRenderer;
}

export function rootMetadata(testFamily: RunTestFamily, options: RunIfMainOptions | undefined): Metadata {
    const metadata = options?.root?.metadata ?? {};
    const kind: TestFamily = metadata.kind ?? testFamily;

    if (kind !== testFamily) {
        throw new TypeError(`runIfMain() root metadata.kind must be "${testFamily}".`);
    }

    return { ...metadata, kind };
}

export function rootTitle(options: RunIfMainOptions | undefined): string {
    return options?.root?.title ?? process.cwd();
}

export function executionMode(profile: RunMicrotestProfileConfig): 'concurrent-in-process' | 'serial-in-process' {
    return profile.execution.scheduling === 'concurrent' ? 'concurrent-in-process' : 'serial-in-process';
}

export function warnOnSupervisedDowngrade(profile: RunMicrotestProfileConfig): void {
    if (profile.execution.processModel === 'supervised-process') {
        stderrWarning(supervisedDowngradeWarning);
    }
}
