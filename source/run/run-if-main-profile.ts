import { relative, resolve } from 'node:path';
import {
    discoverProfileFiles,
    ProfileFileDiscoveryError,
    type ConfiguredProfileFile
} from '../config/profile-file-discovery.ts';
import type {
    LoadedConfig,
    ConfigLoader
} from '../config/config.ts';
import { ConfigError } from '../config/config-error.ts';
import type { ProfileConfig, TestProfileConfig, ProfileFiles } from '../config/types.ts';
import { selectTestProfile } from './test-profile.ts';

type MatchedDirectProfile = {
    readonly fileSet: string | null;
    readonly name: string;
    readonly profile: ProfileConfig;
};

type RunIfMainProfileGlobOptions = {
    readonly cwd: string;
    readonly exclude: readonly string[];
    readonly followSymlinks: boolean;
};

type RunIfMainProfilePathStats = {
    readonly isFile: () => boolean;
};

export type DirectProfileContext = {
    readonly fileSet: string | null;
    readonly name: string;
    readonly profile: TestProfileConfig;
    readonly config: LoadedConfig;
    readonly file: string;
    readonly projectRoot: string;
};

export type RunIfMainProfileResolverDependencies = {
    readonly fileURLToPath: (url: string) => string;
    readonly glob: (
        pattern: string | readonly string[],
        options: RunIfMainProfileGlobOptions
    ) => AsyncIterable<string>;
    readonly loadConfig: ConfigLoader;
    readonly realpath: (filePath: string) => Promise<string>;
    readonly stat: (filePath: string) => Promise<RunIfMainProfilePathStats>;
};

export type RunIfMainProfileResolver = (
    meta: Readonly<ImportMeta>,
    cwd: string
) => Promise<DirectProfileContext>;

function directFilePath(meta: Readonly<ImportMeta>, dependencies: RunIfMainProfileResolverDependencies): string {
    try {
        return dependencies.fileURLToPath(meta.url);
    } catch (error: unknown) {
        throw new ConfigError('runIfMain() requires a file: import.meta.url.', { cause: error });
    }
}

async function canonicalPath(filePath: string, dependencies: RunIfMainProfileResolverDependencies): Promise<string> {
    try {
        return await dependencies.realpath(filePath);
    } catch {
        return resolve(filePath);
    }
}

async function discoverDirectProfileFiles(
    profileFiles: ProfileFiles,
    cwd: string,
    dependencies: RunIfMainProfileResolverDependencies
): Promise<readonly ConfiguredProfileFile[]> {
    try {
        return await discoverProfileFiles({ cwd, files: profileFiles }, dependencies);
    } catch (error: unknown) {
        if (error instanceof ProfileFileDiscoveryError) {
            const message = error.message.replace(`${cwd}/`, '');

            throw new ConfigError(
                error.reason() === 'overlap' ? message.replace('Profile', 'runIfMain() profile') : message,
                { cause: error }
            );
        }

        throw error;
    }
}

async function profileFileSetForFile(
    profileFiles: ProfileFiles,
    file: string,
    cwd: string,
    dependencies: RunIfMainProfileResolverDependencies
): Promise<string | null | undefined> {
    const files = await discoverDirectProfileFiles(profileFiles, cwd, dependencies);

    return files
        .find(function matchesDirectFile(candidate) {
            return candidate.path === file;
        })
        ?.fileSet;
}

async function selectedProfileForFile(
    [ name, profile ]: readonly [string, ProfileConfig],
    file: string,
    cwd: string,
    dependencies: RunIfMainProfileResolverDependencies
): Promise<MatchedDirectProfile | null> {
    const profileFiles = profile.files;

    if (profileFiles === null) {
        return null;
    }

    const fileSet = await profileFileSetForFile(profileFiles, file, cwd, dependencies);

    if (fileSet === undefined) {
        return null;
    }

    return { fileSet, name, profile };
}

function isMatchedDirectProfile(profile: MatchedDirectProfile | null): profile is MatchedDirectProfile {
    return profile !== null;
}

async function matchingProfiles(
    config: LoadedConfig,
    file: string,
    cwd: string,
    dependencies: RunIfMainProfileResolverDependencies
): Promise<readonly MatchedDirectProfile[]> {
    const profiles = await Promise.all(
        Object.entries(config.profiles).map(async function matchProfile(entry) {
            return await selectedProfileForFile(entry, file, cwd, dependencies);
        })
    );

    return profiles.filter(isMatchedDirectProfile);
}

function ambiguousProfileMessage(file: string, cwd: string, profiles: readonly MatchedDirectProfile[]): string {
    const relativeFile = relative(cwd, file);
    const profileNames = profiles.map(function toProfileName(profile) {
        return profile.name;
    });

    return `runIfMain() matched multiple profiles for "${relativeFile}": ${profileNames.join(', ')}.`;
}

async function configuredMicrotestFileSet(
    profile: ProfileConfig & { readonly testFamily: 'microtest'; },
    file: string,
    cwd: string,
    dependencies: RunIfMainProfileResolverDependencies
): Promise<string | null> {
    if (profile.files === null) {
        return null;
    }

    const fileSet = await profileFileSetForFile(profile.files, file, cwd, dependencies);

    if (profile.files.sets !== undefined && fileSet === undefined) {
        throw new ConfigError(
            `runIfMain() file must match exactly one profile file set for "microtest": ${relative(cwd, file)}.`
        );
    }

    return fileSet ?? null;
}

async function configuredMicrotest(
    config: LoadedConfig,
    file: string,
    cwd: string,
    dependencies: RunIfMainProfileResolverDependencies
): Promise<MatchedDirectProfile> {
    const profile = config.profiles.microtest;

    if (profile?.testFamily !== 'microtest') {
        throw new ConfigError('runIfMain() requires the configured "microtest" profile.');
    }

    const fileSet = await configuredMicrotestFileSet(profile, file, cwd, dependencies);

    return { fileSet, name: 'microtest', profile };
}

async function selectDirectProfile(
    config: LoadedConfig,
    file: string,
    cwd: string,
    dependencies: RunIfMainProfileResolverDependencies
): Promise<MatchedDirectProfile> {
    if (config.configPath === null) {
        return await configuredMicrotest(config, file, cwd, dependencies);
    }

    const matches = await matchingProfiles(config, file, cwd, dependencies);

    if (matches.length > 1) {
        throw new ConfigError(ambiguousProfileMessage(file, cwd, matches));
    }

    const [ profile ] = matches;

    if (profile !== undefined) {
        return profile;
    }

    return await configuredMicrotest(config, file, cwd, dependencies);
}

export function createDirectProfileResolver(
    dependencies: RunIfMainProfileResolverDependencies
): RunIfMainProfileResolver {
    return async function resolveDirectProfile(meta, cwd) {
        const canonicalCwd = await canonicalPath(cwd, dependencies);
        const file = await canonicalPath(directFilePath(meta, dependencies), dependencies);
        const config = await dependencies.loadConfig({ configPath: null, cwd: canonicalCwd });
        const selectedProfile = await selectDirectProfile(config, file, canonicalCwd, dependencies);

        return {
            config,
            file,
            fileSet: selectedProfile.fileSet,
            name: selectedProfile.name,
            projectRoot: canonicalCwd,
            profile: selectTestProfile(selectedProfile.name, config)
        };
    };
}
