import { lstat, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withRunnerInfrastructure } from '../../execution-ownership.ts';
import { createNodeFileStore } from '../../file-store.ts';
import { fingerprint, originalProjectFacts, type FrozenProject } from './frozen-project.ts';

export type RememberProjectValidation = (save: () => Promise<void>) => void;

const files = createNodeFileStore();
const privateDirectoryMode = 0o700;
const groupAndOtherModeRange = 0o100;
const cacheFormatVersion = 1;

async function validationDirectory(): Promise<string | null> {
    const user = process.getuid?.();
    if (user === undefined) {
        return null;
    }
    const directory = join(tmpdir(), `overkill-type-test-validation-${user}`);
    await mkdir(directory, { mode: privateDirectoryMode, recursive: true });
    const info = await lstat(directory);
    return info.isDirectory() && info.uid === user && info.mode % groupAndOtherModeRange === 0
        ? directory
        : null;
}

function projectValidationKey(project: FrozenProject): string {
    return fingerprint(JSON.stringify([
        cacheFormatVersion,
        project.compiler.version,
        project.compiler.files,
        project.compiler.resolutions,
        project.projectConfigPath,
        project.projectText,
        originalProjectFacts(project),
        project.observation.snapshot()
    ]));
}

type ValidationEntry = {
    readonly path: string;
    readonly key: string;
    readonly valid: boolean;
};

async function validationEntry(project: FrozenProject): Promise<ValidationEntry | null> {
    const directory = await validationDirectory();
    if (directory === null) {
        return null;
    }
    const slot = fingerprint(JSON.stringify([ project.projectConfigPath, project.compiler.packageUrl ]));
    const path = join(directory, slot);
    const key = projectValidationKey(project);
    return { path, key, valid: await files.read(path) === key };
}

async function readValidation(project: FrozenProject): Promise<ValidationEntry | null> {
    try {
        return await validationEntry(project);
    } catch {
        return null;
    }
}

async function saveValidation(entry: ValidationEntry): Promise<void> {
    try {
        await withRunnerInfrastructure(async function writeValidation() {
            await files.write(entry.path, entry.key);
        });
    } catch {}
}

export async function validateCompilerProject(
    project: FrozenProject,
    signal: AbortSignal,
    validate: () => Promise<void>,
    remember: RememberProjectValidation
): Promise<void> {
    signal.throwIfAborted();
    const entry = await readValidation(project);
    signal.throwIfAborted();
    if (entry?.valid === true) {
        return;
    }
    await validate();
    if (entry !== null && entry.key === projectValidationKey(project)) {
        remember(async function persist() {
            await saveValidation(entry);
        });
    }
}
