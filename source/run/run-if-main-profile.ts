import { glob, realpath } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    loadRunConfig,
    RunConfigError,
    type LoadedRunConfig
} from './run-config.ts';
import type { RunMicrotestProfileConfig } from './run-types.ts';

type SelectedDirectProfile = {
    readonly name: string;
    readonly profile: RunMicrotestProfileConfig;
};

export type DirectProfileContext = SelectedDirectProfile & {
    readonly config: LoadedRunConfig;
    readonly file: string;
    readonly projectRoot: string;
};

function directFilePath(meta: Readonly<ImportMeta>): string {
    try {
        return fileURLToPath(meta.url);
    } catch (error: unknown) {
        throw new RunConfigError('runIfMain() requires a file: import.meta.url.', { cause: error });
    }
}

async function sameRealPath(firstPath: string, secondPath: string): Promise<boolean> {
    try {
        return await realpath(firstPath) === await realpath(secondPath);
    } catch {
        return resolve(firstPath) === resolve(secondPath);
    }
}

async function canonicalPath(filePath: string): Promise<string> {
    try {
        return await realpath(filePath);
    } catch {
        return resolve(filePath);
    }
}

async function matchedFiles(pattern: string, cwd: string): Promise<readonly string[]> {
    const files: string[] = [];
    const matches = glob(pattern, { cwd, exclude: [] });

    for await (const file of matches) {
        files.push(resolve(cwd, file));
    }

    return files;
}

async function profileIncludesFile(
    profile: RunMicrotestProfileConfig,
    file: string,
    cwd: string
): Promise<boolean> {
    if (profile.files === null) {
        return false;
    }

    for (const includePattern of profile.files.include) {
        const includedFiles = await matchedFiles(includePattern, cwd);

        for (const includedFile of includedFiles) {
            if (await sameRealPath(includedFile, file)) {
                return true;
            }
        }
    }

    return false;
}

async function profileExcludesFile(
    profile: RunMicrotestProfileConfig,
    file: string,
    cwd: string
): Promise<boolean> {
    if (profile.files === null) {
        return false;
    }

    for (const excludePattern of profile.files.exclude) {
        const excludedFiles = await matchedFiles(excludePattern, cwd);

        for (const excludedFile of excludedFiles) {
            if (await sameRealPath(excludedFile, file)) {
                return true;
            }
        }
    }

    return false;
}

async function profileMatchesFile(
    profile: RunMicrotestProfileConfig,
    file: string,
    cwd: string
): Promise<boolean> {
    return await profileIncludesFile(profile, file, cwd) && !await profileExcludesFile(profile, file, cwd);
}

async function matchingProfiles(
    config: LoadedRunConfig,
    file: string,
    cwd: string
): Promise<readonly SelectedDirectProfile[]> {
    const profiles: SelectedDirectProfile[] = [];

    for (const [ name, profile ] of Object.entries(config.profiles)) {
        if (await profileMatchesFile(profile, file, cwd)) {
            profiles.push({ name, profile });
        }
    }

    return profiles;
}

function ambiguousProfileMessage(file: string, cwd: string, profiles: readonly SelectedDirectProfile[]): string {
    const relativeFile = relative(cwd, file);
    const profileNames = profiles.map(function toProfileName(profile) {
        return profile.name;
    });

    return `runIfMain() matched multiple profiles for "${relativeFile}": ${profileNames.join(', ')}.`;
}

function configuredMicrotest(config: LoadedRunConfig): SelectedDirectProfile {
    const profile = config.profiles.microtest;

    if (profile === undefined) {
        throw new RunConfigError('runIfMain() requires the configured "microtest" profile.');
    }

    return { name: 'microtest', profile };
}

async function selectDirectProfile(
    config: LoadedRunConfig,
    file: string,
    cwd: string
): Promise<SelectedDirectProfile> {
    if (config.configPath === null) {
        return configuredMicrotest(config);
    }

    const matches = await matchingProfiles(config, file, cwd);

    if (matches.length > 1) {
        throw new RunConfigError(ambiguousProfileMessage(file, cwd, matches));
    }

    const [ profile ] = matches;

    if (profile !== undefined) {
        return profile;
    }

    return configuredMicrotest(config);
}

export async function resolveDirectProfile(
    meta: Readonly<ImportMeta>,
    cwd: string
): Promise<DirectProfileContext> {
    const canonicalCwd = await canonicalPath(cwd);
    const file = await canonicalPath(directFilePath(meta));
    const config = await loadRunConfig({ configPath: null, cwd: canonicalCwd });
    const selectedProfile = await selectDirectProfile(config, file, canonicalCwd);

    return {
        config,
        file,
        name: selectedProfile.name,
        projectRoot: canonicalCwd,
        profile: selectedProfile.profile
    };
}
