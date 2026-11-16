import { mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Linter } from 'eslint';
import { createTemporaryDirectoryResource, startResources } from '../packages/resources/resources.entry-point.ts';
import type {
    ConfigContext,
    ConfigInput,
    ConfigProject,
    ConfigSource,
    VirtualConfigProject
} from './config-definition.ts';

export function projectPath(root: string, filename: string): string {
    if (filename.trim() === '' || path.isAbsolute(filename) || filename.includes('\\')) {
        throw new TypeError('Project filenames must be nonempty relative paths using forward slashes.');
    }
    const resolved = path.resolve(root, filename);
    const relative = path.relative(root, resolved);
    if (relative === '' || relative.split(path.sep)[0] === '..') {
        throw new TypeError('Project filenames must stay inside the project root.');
    }
    return resolved;
}

function validateProjectFiles(files: Readonly<Record<string, string>>): void {
    const seen = new Set<string>();
    for (const filename of Object.keys(files)) {
        const resolved = projectPath('/project', filename);
        if (seen.has(resolved) || filename.toLowerCase().split('/').includes('node_modules')) {
            throw new TypeError('Project file paths must be unique and must not declare node_modules.');
        }
        seen.add(resolved);
    }
    for (const filename of seen) {
        if (
            Array.from(seen).some(function parent(other) {
                return other.startsWith(filename + path.sep);
            })
        ) {
            throw new TypeError('Project files must not conflict with directories.');
        }
    }
}

export function validateProject(project: ConfigProject): void {
    if (project.kind === 'existing') {
        if (!path.isAbsolute(project.root)) {
            throw new TypeError('Existing project roots must be absolute.');
        }
    } else {
        validateProjectFiles(project.files);
        if (project.dependencies.kind === 'from-project' && !path.isAbsolute(project.dependencies.root)) {
            throw new TypeError('Dependency project roots must be absolute.');
        }
    }
}

async function populateProject(root: string, project: VirtualConfigProject): Promise<void> {
    for (const [ filename, code ] of Object.entries(project.files)) {
        const target = projectPath(root, filename);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, code, { flag: 'wx' });
    }
    if (project.dependencies.kind === 'from-project') {
        const modules = path.join(project.dependencies.root, 'node_modules');
        await symlink(await realpath(modules), path.join(root, 'node_modules'), 'junction');
    }
}

export async function inConfigProject<Result>(
    project: ConfigProject,
    signal: AbortSignal,
    run: (context: ConfigContext) => Promise<Result>
): Promise<Result> {
    signal.throwIfAborted();
    if (project.kind === 'existing') {
        return await run({ root: project.root, signal });
    }
    await using resources = await startResources({
        resources: { directory: createTemporaryDirectoryResource('eslint-project') },
        signal
    });
    const root = await realpath(resources.context.directory.path);
    await populateProject(root, project);
    signal.throwIfAborted();
    return await run({ root, signal });
}

export async function configLayers(
    source: ConfigSource,
    context: ConfigContext
): Promise<readonly Linter.Config[]> {
    context.signal.throwIfAborted();
    return typeof source === 'function' ? await source(context) : source;
}

export async function projectText(context: ConfigContext, filename: string): Promise<string> {
    const target = projectPath(context.root, filename);
    const resolved = await realpath(target);
    projectPath(await realpath(context.root), path.relative(await realpath(context.root), resolved));
    return await readFile(target, 'utf8');
}

export function generatedProject(project: VirtualConfigProject, input: ConfigInput): VirtualConfigProject {
    const files = { ...project.files, ...input.files, [input.filename]: input.code };
    const generated: VirtualConfigProject = { ...project, files };
    validateProject(generated);
    return generated;
}
