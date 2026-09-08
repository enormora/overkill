import { glob, realpath, stat } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    loadRunConfig,
    RunConfigError,
    type LoadedRunConfig
} from './run-config.ts';
import type {
    RunProfileConfig,
    RunProfileFileSet,
    RunProfileFiles
} from './run-types.ts';

type SelectedDirectProfile = {
    readonly fileSet: string | null;
    readonly name: string;
    readonly profile: RunProfileConfig;
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

async function matchedProfilePatternFiles(
    profileFiles: RunProfileFileSet,
    cwd: string
): Promise<readonly string[]> {
    const files: string[] = [];
    const matches = glob(profileFiles.include, { cwd, exclude: profileFiles.exclude, followSymlinks: false });

    for await (const file of matches) {
        const filePath = resolve(cwd, file);
        const fileStat = await stat(filePath);

        if (fileStat.isFile()) {
            files.push(await canonicalPath(filePath));
        }
    }

    return Array.from(new Set(files)).toSorted(function compareFiles(left, right) {
        return left.localeCompare(right);
    });
}

async function patternSetIncludesFile(
    profileFiles: RunProfileFileSet,
    file: string,
    cwd: string
): Promise<boolean> {
    for (const includePattern of profileFiles.include) {
        const includedFiles = await matchedFiles(includePattern, cwd);

        for (const includedFile of includedFiles) {
            if (await sameRealPath(includedFile, file)) {
                return true;
            }
        }
    }

    return false;
}

async function patternSetExcludesFile(
    profileFiles: RunProfileFileSet,
    file: string,
    cwd: string
): Promise<boolean> {
    for (const excludePattern of profileFiles.exclude) {
        const excludedFiles = await matchedFiles(excludePattern, cwd);

        for (const excludedFile of excludedFiles) {
            if (await sameRealPath(excludedFile, file)) {
                return true;
            }
        }
    }

    return false;
}

async function patternSetMatchesFile(
    profileFiles: RunProfileFileSet,
    file: string,
    cwd: string
): Promise<boolean> {
    return await patternSetIncludesFile(profileFiles, file, cwd) &&
        !await patternSetExcludesFile(profileFiles, file, cwd);
}

type RunProfileFileSets = {
    readonly sets: Readonly<Record<string, RunProfileFileSet>>;
};

type DirectProfileFileSet = {
    readonly files: readonly string[];
    readonly name: string;
};

function hasProfileFileSets(profileFiles: RunProfileFiles): profileFiles is RunProfileFileSets {
    return profileFiles.sets !== undefined;
}

async function directProfileFileSet(
    name: string,
    profileFiles: RunProfileFileSet,
    cwd: string
): Promise<DirectProfileFileSet> {
    const files = await matchedProfilePatternFiles(profileFiles, cwd);

    if (files.length === 0) {
        throw new RunConfigError(`Profile files.sets.${name} matched no test files.`);
    }

    return { files, name };
}

function directProfileSetOverlapMessage(file: string, cwd: string, firstSet: string, secondSet: string): string {
    return `runIfMain() profile file sets must not overlap: ${
        relative(cwd, file)
    } matched ${firstSet} and ${secondSet}.`;
}

function assertNonOverlappingDirectProfileFileSets(fileSets: readonly DirectProfileFileSet[], cwd: string): void {
    const owners = new Map<string, string>();

    for (const fileSet of fileSets) {
        for (const file of fileSet.files) {
            const owner = owners.get(file);

            if (owner !== undefined) {
                throw new RunConfigError(directProfileSetOverlapMessage(file, cwd, owner, fileSet.name));
            }

            owners.set(file, fileSet.name);
        }
    }
}

async function directProfileFileSets(
    sets: Readonly<Record<string, RunProfileFileSet>>,
    cwd: string
): Promise<readonly DirectProfileFileSet[]> {
    const fileSets = await Promise.all(
        Object.entries(sets).map(async function discoverFileSet([ name, set ]) {
            return await directProfileFileSet(name, set, cwd);
        })
    );

    assertNonOverlappingDirectProfileFileSets(fileSets, cwd);

    return fileSets;
}

async function profilePatternFileSetForFile(
    profileFiles: RunProfileFileSet,
    file: string,
    cwd: string
): Promise<null | undefined> {
    return await patternSetMatchesFile(profileFiles, file, cwd) ? null : undefined;
}

async function namedProfileFileSetForFile(
    profileFiles: RunProfileFileSets,
    file: string,
    cwd: string
): Promise<string | undefined> {
    const canonicalFile = await canonicalPath(file);
    const fileSets = await directProfileFileSets(profileFiles.sets, cwd);
    const matchedSet = fileSets.find(function includesFile(fileSet) {
        return fileSet.files.includes(canonicalFile);
    });

    return matchedSet?.name;
}

async function profileFileSetForFile(
    profileFiles: RunProfileFiles,
    file: string,
    cwd: string
): Promise<string | null | undefined> {
    if (!hasProfileFileSets(profileFiles)) {
        return await profilePatternFileSetForFile(profileFiles, file, cwd);
    }

    return await namedProfileFileSetForFile(profileFiles, file, cwd);
}

async function selectedProfileForFile(
    [ name, profile ]: readonly [string, RunProfileConfig],
    file: string,
    cwd: string
): Promise<SelectedDirectProfile | null> {
    const profileFiles = profile.files;

    if (profileFiles === null) {
        return null;
    }

    const fileSet = await profileFileSetForFile(profileFiles, file, cwd);

    if (fileSet === undefined) {
        return null;
    }

    return { fileSet, name, profile };
}

function isSelectedDirectProfile(profile: SelectedDirectProfile | null): profile is SelectedDirectProfile {
    return profile !== null;
}

async function matchingProfiles(
    config: LoadedRunConfig,
    file: string,
    cwd: string
): Promise<readonly SelectedDirectProfile[]> {
    const profiles = await Promise.all(
        Object.entries(config.profiles).map(async function matchProfile(entry) {
            return await selectedProfileForFile(entry, file, cwd);
        })
    );

    return profiles.filter(isSelectedDirectProfile);
}

function ambiguousProfileMessage(file: string, cwd: string, profiles: readonly SelectedDirectProfile[]): string {
    const relativeFile = relative(cwd, file);
    const profileNames = profiles.map(function toProfileName(profile) {
        return profile.name;
    });

    return `runIfMain() matched multiple profiles for "${relativeFile}": ${profileNames.join(', ')}.`;
}

async function configuredMicrotestFileSet(
    profile: RunProfileConfig & { readonly testFamily: 'microtest'; },
    file: string,
    cwd: string
): Promise<string | null> {
    if (profile.files === null) {
        return null;
    }

    const fileSet = await profileFileSetForFile(profile.files, file, cwd);

    if (profile.files.sets !== undefined && fileSet === undefined) {
        throw new RunConfigError(
            `runIfMain() file must match exactly one profile file set for "microtest": ${relative(cwd, file)}.`
        );
    }

    return fileSet ?? null;
}

async function configuredMicrotest(
    config: LoadedRunConfig,
    file: string,
    cwd: string
): Promise<SelectedDirectProfile> {
    const profile = config.profiles.microtest;

    if (profile?.testFamily !== 'microtest') {
        throw new RunConfigError('runIfMain() requires the configured "microtest" profile.');
    }

    const fileSet = await configuredMicrotestFileSet(profile, file, cwd);

    return { fileSet, name: 'microtest', profile };
}

function assertSupportedDirectProfile(context: SelectedDirectProfile): void {
    if (context.profile.testFamily === 'integration') {
        throw new RunConfigError(
            [
                `runIfMain() does not support integration profile "${context.name}" yet.`,
                `Use the overkill CLI with --profile ${context.name}.`
            ]
                .join(' ')
        );
    }
}

async function selectDirectProfile(
    config: LoadedRunConfig,
    file: string,
    cwd: string
): Promise<SelectedDirectProfile> {
    if (config.configPath === null) {
        return await configuredMicrotest(config, file, cwd);
    }

    const matches = await matchingProfiles(config, file, cwd);

    if (matches.length > 1) {
        throw new RunConfigError(ambiguousProfileMessage(file, cwd, matches));
    }

    const [ profile ] = matches;

    if (profile !== undefined) {
        return profile;
    }

    return await configuredMicrotest(config, file, cwd);
}

export async function resolveDirectProfile(
    meta: Readonly<ImportMeta>,
    cwd: string
): Promise<DirectProfileContext> {
    const canonicalCwd = await canonicalPath(cwd);
    const file = await canonicalPath(directFilePath(meta));
    const config = await loadRunConfig({ configPath: null, cwd: canonicalCwd });
    const selectedProfile = await selectDirectProfile(config, file, canonicalCwd);

    assertSupportedDirectProfile(selectedProfile);

    return {
        config,
        file,
        fileSet: selectedProfile.fileSet,
        name: selectedProfile.name,
        projectRoot: canonicalCwd,
        profile: selectedProfile.profile
    };
}
