import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPlainOutputRenderer } from '../engine/reporter-output.ts';
import { normalizeProfileFiles } from '../config/profile-normalization.ts';
import type {
    FrozenMicrotestPolicy,
    FrozenRunCommand,
    RunCommand,
    RunSelection,
    DiscoveredRunFile,
    RunPolicySource
} from './run-types.ts';
import { frozenMicrotestPolicySchema } from './frozen-run-policy-schema.ts';
import { invalidRequest } from './run-errors.ts';
import { freezeValue } from './run-support.ts';
import { validateRunInput } from './run-validation.ts';
import { resolveResourceUsagePolicy } from './run-profile-facts.ts';

function intersectSelection(baseline: RunSelection, selected: RunSelection): RunSelection {
    if (baseline.kind === 'all') {
        return selected;
    }
    if (selected.kind === 'all') {
        return baseline;
    }
    return { kind: 'filter', filter: { kind: 'all', filters: [ baseline.filter, selected.filter ] } };
}

export function frozenPolicyCommand(input: FrozenRunCommand): RunCommand {
    const { policy, invocation, reporting } = input;
    const selection = intersectSelection(policy.request.selection, invocation.selection);

    return {
        config: {
            ...reporting,
            loader: policy.loader,
            profiles: { [policy.request.profile]: { ...policy.profile, reporters: null } },
            runtimeStateDir: policy.runtimeStateDir
        },
        cwd: policy.cwd,
        engine: policy.engine,
        request: { ...policy.request, seed: invocation.seed, selection }
    };
}

export function policyBaselineCommand(policy: FrozenMicrotestPolicy): RunCommand {
    return frozenPolicyCommand({
        kind: 'frozen-policy',
        policy,
        invocation: { seed: { value: null }, selection: { kind: 'all' } },
        reporting: { outputRenderer: createPlainOutputRenderer(), reporters: [] }
    });
}

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

export function parseFrozenMicrotestPolicy(value: unknown): FrozenMicrotestPolicy {
    const policy = frozenMicrotestPolicySchema.parse(value);
    const command = policyBaselineCommand(policy);
    validateRunInput(command);
    resolveResourceUsagePolicy(command.request, { ...policy.profile, reporters: null });
    normalizeProfileFiles(policy.profile.files ?? undefined);
    validatePolicyFiles(policy);
    validatePolicySource(policy);
    if (!isAbsolute(policy.cwd) || !isAbsolute(policy.projectRoot)) {
        invalidRequest('Frozen policy requires absolute project roots.');
    }
    return freezeValue(policy);
}
