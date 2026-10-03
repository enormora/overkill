import path from 'node:path';
import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import type {
    RunProjectCoveragePolicy,
    RunProjectCoverageSources,
    RunProjectCoverageThresholds
} from './coverage-config-schema.ts';
import {
    invalidProfileFileGlobConfigMessage,
    invalidRunProfileFileSetNameMessage,
    invalidRunProfileNameMessage
} from './profile-file-glob.ts';
import type {
    RunProjectIntegrationExecution,
    RunProjectProfileFiles
} from './run-config-schema.ts';
import { defaultCoveragePolicy, defaultWorkDistribution } from './run-config-defaults.ts';
import { RunConfigError } from './run-errors.ts';
import type {
    RunCoveragePolicy,
    RunCoverageSourcePolicy,
    RunCoverageThresholds,
    RunIntegrationExecution,
    RunProfileFileSet,
    RunProfileFiles
} from './run-types.ts';
import {
    invalidWorkDistributionConfigMessage,
    normalizeWorkDistribution
} from './work-distribution-config.ts';

type ProjectProfileFilePatterns = {
    readonly exclude?: readonly string[] | undefined;
    readonly include: NonEmptyReadonlyArray<string>;
};

type ProjectProfileFileSets = {
    readonly sets: Readonly<Record<string, ProjectProfileFilePatterns>>;
};

function assertValidProfileGlob(field: string, pattern: string): void {
    const message = invalidProfileFileGlobConfigMessage(field, pattern);

    if (message !== null) {
        throw new RunConfigError(message);
    }
}

function normalizeCoverageOutputs(
    outputs: RunProjectCoveragePolicy['outputs']
): RunCoveragePolicy['outputs'] {
    return Array.from(new Set(outputs ?? defaultCoveragePolicy.outputs));
}

function normalizeCoverageExclude(exclude: readonly string[] | undefined): readonly string[] {
    const patterns = exclude ?? [];

    for (const pattern of patterns) {
        assertValidProfileGlob('coverage.sources.exclude', pattern);
    }

    return Array.from(patterns);
}

function normalizeCoverageSources(
    sources: RunProjectCoverageSources | undefined
): RunCoverageSourcePolicy {
    if (sources === undefined) {
        return {
            exclude: Array.from(defaultCoveragePolicy.sources.exclude),
            mode: 'loaded'
        };
    }

    const exclude = normalizeCoverageExclude(sources.exclude);

    if (sources.mode === 'loaded') {
        return { exclude, mode: 'loaded' };
    }

    for (const pattern of sources.include) {
        assertValidProfileGlob('coverage.sources.include', pattern);
    }

    return {
        exclude,
        include: [ sources.include[0], ...sources.include.slice(1) ],
        mode: 'all'
    };
}

function thresholdValue(value: number | undefined): number | null {
    return value ?? null;
}

function normalizeCoverageThresholds(
    thresholds: RunProjectCoverageThresholds | undefined
): RunCoverageThresholds {
    return {
        branches: thresholdValue(thresholds?.branches),
        functions: thresholdValue(thresholds?.functions),
        lines: thresholdValue(thresholds?.lines)
    };
}

function normalizeCoverageOutputDirectory(
    outputDirectory: string | undefined,
    configPath: string | null
): string | null {
    if (outputDirectory === undefined) {
        return null;
    }

    if (configPath === null) {
        throw new RunConfigError('Coverage outputDir requires a loaded config file.');
    }

    return path.isAbsolute(outputDirectory)
        ? path.resolve(outputDirectory)
        : path.resolve(path.dirname(configPath), outputDirectory);
}

export function normalizeCoveragePolicy(
    policy: RunProjectCoveragePolicy | undefined,
    configPath: string | null
): RunCoveragePolicy {
    return {
        outputDirectory: normalizeCoverageOutputDirectory(policy?.outputDir, configPath),
        outputs: normalizeCoverageOutputs(policy?.outputs),
        sources: normalizeCoverageSources(policy?.sources),
        thresholds: normalizeCoverageThresholds(policy?.thresholds)
    };
}

function profileFileGlobField(fieldPrefix: string | null, field: 'exclude' | 'include'): string {
    return fieldPrefix === null ? field : `${fieldPrefix}.${field}`;
}

function normalizeProfileFilePatterns(
    files: ProjectProfileFilePatterns,
    fieldPrefix: string | null
): RunProfileFileSet {
    for (const pattern of files.include) {
        assertValidProfileGlob(profileFileGlobField(fieldPrefix, 'include'), pattern);
    }

    const excludePatterns = files.exclude ?? [];

    for (const pattern of excludePatterns) {
        assertValidProfileGlob(profileFileGlobField(fieldPrefix, 'exclude'), pattern);
    }

    return {
        exclude: Array.from(excludePatterns),
        include: [ files.include[0], ...files.include.slice(1) ]
    };
}

function assertValidProfileFileSetName(name: string): void {
    const message = invalidRunProfileFileSetNameMessage(name);

    if (message !== null) {
        throw new RunConfigError(message);
    }
}

function normalizeProfileFileSets(files: ProjectProfileFileSets): RunProfileFiles {
    const entries = Object.entries(files.sets);

    if (entries.length === 0) {
        throw new RunConfigError('Invalid profile files.sets: at least one file set is required.');
    }

    return {
        sets: Object.fromEntries(entries.map(function normalizeProfileFileSet([ name, set ]) {
            assertValidProfileFileSetName(name);

            return [ name, normalizeProfileFilePatterns(set, `sets.${name}`) ];
        }))
    };
}

function hasProfileFileSets(files: RunProjectProfileFiles): files is ProjectProfileFileSets {
    return files.sets !== undefined;
}

export function normalizeProfileFiles(files: RunProjectProfileFiles | undefined): RunProfileFiles | null {
    if (files === undefined) {
        return null;
    }

    return hasProfileFileSets(files)
        ? normalizeProfileFileSets(files)
        : normalizeProfileFilePatterns(files, null);
}

export function normalizeRequiredProfileFiles(files: RunProjectProfileFiles): RunProfileFiles {
    const normalizedFiles = normalizeProfileFiles(files);

    if (normalizedFiles === null) {
        throw new RunConfigError('Integration profiles require files.');
    }

    return normalizedFiles;
}

export function assertValidProfileName(profileName: string): void {
    const message = invalidRunProfileNameMessage(profileName);

    if (message !== null) {
        throw new RunConfigError(message);
    }
}

export function assertValidWorkDistribution(
    execution: RunIntegrationExecution,
    files: RunProfileFiles
): void {
    const message = invalidWorkDistributionConfigMessage(execution, files);

    if (message !== null) {
        throw new RunConfigError(message);
    }
}

export function normalizedWorkDistribution(
    execution: RunProjectIntegrationExecution | undefined
): Extract<RunIntegrationExecution, { readonly processModel: 'worker-pool'; }>['workDistribution'] {
    return normalizeWorkDistribution(execution, defaultWorkDistribution);
}
