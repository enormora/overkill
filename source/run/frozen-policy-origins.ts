import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DiscoveredRunFile, FrozenMicrotestPolicy, RunPolicySource } from './run-types.ts';
import { invalidRequest } from './run-errors.ts';
import { validateFileModuleBoundary } from './file-module-boundary.ts';

function outsideProjectRoot(relativePath: string): boolean {
    return relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath);
}

function validateFileOrigin(file: DiscoveredRunFile, root: string): void {
    const expectedPath = resolve(root, file.file);
    const relativePath = relative(root, expectedPath);
    if (
        outsideProjectRoot(relativePath) || file.file !== relativePath.replaceAll('\\', '/') ||
        file.path !== expectedPath || file.href !== pathToFileURL(expectedPath).href
    ) {
        invalidRequest(`Invalid frozen discovery descriptor: ${file.file}`);
    }
}

function validateFileSet(file: DiscoveredRunFile, policy: FrozenMicrotestPolicy): void {
    const sets = policy.profile.files?.sets;
    const valid = file.fileSet === null ? sets === undefined : sets !== undefined && Object.hasOwn(sets, file.fileSet);
    if (!valid) {
        invalidRequest(`Invalid frozen file-set ownership: ${file.file}`);
    }
}

function validatePolicyFiles(policy: FrozenMicrotestPolicy): void {
    const seen = new Set<string>();
    for (const file of policy.files) {
        validateFileOrigin(file, policy.projectRoot);
        validateFileSet(file, policy);
        if (seen.has(file.path)) {
            invalidRequest(`Duplicate frozen discovery descriptor: ${file.file}`);
        }
        seen.add(file.path);
    }
}

function absoluteConfigSource(source: Extract<RunPolicySource, { readonly kind: 'config-file'; }>): boolean {
    return isAbsolute(source.request.cwd) && (source.resolvedPath === null || isAbsolute(source.resolvedPath));
}

function validatePolicySource(policy: FrozenMicrotestPolicy): void {
    const { source } = policy;
    if (source.kind === 'memory') {
        return;
    }
    if (!absoluteConfigSource(source) || resolve(source.request.cwd) !== resolve(policy.cwd)) {
        invalidRequest('Frozen policy requires consistent absolute config roots.');
    }
    if (
        source.request.configPath !== null &&
        resolve(source.request.cwd, source.request.configPath) !== source.resolvedPath
    ) {
        invalidRequest('Frozen config identity conflicts with its load request.');
    }
}

export function validateFrozenPolicyOrigins(policy: FrozenMicrotestPolicy): void {
    if (policy.moduleBoundary !== null) {
        validateFileModuleBoundary(policy.moduleBoundary);
        if (policy.moduleBoundary.projectRoot !== policy.projectRoot) {
            invalidRequest('Module boundary conflicts with frozen project root.');
        }
    }
    validatePolicyFiles(policy);
    validatePolicySource(policy);
    if (!isAbsolute(policy.cwd) || !isAbsolute(policy.projectRoot)) {
        invalidRequest('Frozen policy requires absolute project roots.');
    }
}
