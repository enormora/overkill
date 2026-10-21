import { copyFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { SerializedValue } from '../engine/engine.entry-point.ts';
import {
    createNodeFileStore,
    type FrozenMicrotestPolicy,
    type SerializedRunDiagnostics
} from '../run/run.entry-point.ts';
import type { OverkillRunnerOptions } from './runner-settings-schema.ts';

export type MutationDiagnosticContext = {
    readonly mode: OverkillRunnerOptions['artifactPersistence'];
    readonly directory: string;
    readonly root: string;
    readonly campaign: string;
    readonly seed: string;
    readonly profile: string;
};
export type MutationDiagnosticExecution = { readonly kind: 'dry'; } | {
    readonly kind: 'mutant';
    readonly mutant: string;
};
export type MutationDiagnosticDocument = {
    readonly version: 1;
    readonly campaign: string;
    readonly invocation: string;
    readonly seed: string;
    readonly profile: string;
    readonly execution: MutationDiagnosticExecution;
    readonly diagnostics: SerializedRunDiagnostics;
    readonly failure: SerializedValue | null;
};
type DiagnosticInitialization = {
    readonly originalRoot: string;
    readonly root: string;
    readonly settings: OverkillRunnerOptions;
    readonly policy: FrozenMicrotestPolicy;
    readonly campaign: string;
};
type DiagnosticArtifact = SerializedRunDiagnostics['artifacts'][number];
const jsonIndentation = 2;

export function createMutationDiagnosticContext(input: DiagnosticInitialization): MutationDiagnosticContext {
    return {
        mode: input.settings.artifactPersistence,
        directory: path.resolve(input.originalRoot, input.policy.runtimeStateDir, 'mutation'),
        root: input.root,
        campaign: input.campaign,
        seed: input.settings.seed,
        profile: input.policy.request.profile
    };
}
function isRuntimeAttachment(
    artifact: DiagnosticArtifact
): artifact is Extract<DiagnosticArtifact, { readonly payload: { readonly kind: 'runtime-attachment'; }; }> {
    return artifact.payload.kind === 'runtime-attachment';
}
async function assertArtifactSize(file: string, bytes: number): Promise<void> {
    const information = await stat(file);
    if (information.size !== bytes) {
        throw new Error('Diagnostic attachment size differs from its delivered metadata.');
    }
}
async function retainArtifactFile(
    root: string,
    directory: string,
    artifact: DiagnosticArtifact,
    index: number
): Promise<DiagnosticArtifact> {
    if (!isRuntimeAttachment(artifact) || artifact.payload.content.kind !== 'file') {
        return artifact;
    }
    const { content } = artifact.payload;
    const source = path.resolve(root, content.path);
    const destination = path.join(directory, 'files', `${index}.bin`);
    await assertArtifactSize(source, content.byteLength);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
    await assertArtifactSize(destination, content.byteLength);
    return {
        ...artifact,
        payload: { ...artifact.payload, content: { ...content, path: `files/${index}.bin` } }
    };
}
export async function writeMutationDiagnostics(
    context: MutationDiagnosticContext,
    document: MutationDiagnosticDocument
): Promise<void> {
    const directory = path.join(context.directory, context.campaign, document.invocation);
    const artifacts: DiagnosticArtifact[] = [];
    for (const [ index, artifact ] of document.diagnostics.artifacts.entries()) {
        artifacts.push(await retainArtifactFile(context.root, directory, artifact, index));
    }
    const content = { ...document, diagnostics: { ...document.diagnostics, artifacts } };
    await createNodeFileStore().write(
        path.join(directory, 'diagnostics.json'),
        `${JSON.stringify(content, null, jsonIndentation)}\n`
    );
}
