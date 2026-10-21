import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createClock } from '@enormora/clock';
import {
    createInvocationBudget,
    parseSerializedRunDiagnostics,
    type InvocationBudget,
    type RunExecutionLifecycle,
    type RunExecutionReply,
    type SerializedRunDiagnostics
} from '../packages/run/run.entry-point.ts';
import type { MutationDiagnosticContext } from '../packages/stryker-runner/mutation-diagnostic-storage.ts';
import type { TestScope } from '../packages/test/test.entry-point.ts';
import { mutationCoverageFixture } from './mutation-coverage-fixture.ts';
import { createMutationEvidenceFixture } from './mutation-evidence-fixture.ts';

const repeatedInvocationCount = 2;
const invocationTimeoutMilliseconds = 30_000;
type MutationDiagnosticFixture = {
    readonly context: MutationDiagnosticContext;
    readonly directory: string;
    readonly budget: InvocationBudget;
    readonly reply: ResultReply;
    readonly empty: ResultReply;
};
type ResultReply = Extract<RunExecutionReply, { readonly kind: 'result'; }>;
function capturedDiagnosticReply(reply: ResultReply): ResultReply {
    const first = reply.result.perTest[0];
    if (first === undefined) {
        throw new Error('Missing diagnostic case fixture.');
    }
    return {
        ...reply,
        result: {
            ...reply.result,
            artifacts: [ {
                id: {
                    attempt: { index: 0 },
                    runtimes: [],
                    sequence: 0,
                    subtype: 'log-capture',
                    workload: null,
                    scope: { kind: 'case', case: first.id, activeCases: [ first.id ], confidence: 'active-case' }
                },
                source: 'boundary-captured',
                payload: {
                    kind: 'captured-output',
                    byteLength: 4,
                    text: 'log\n',
                    stream: 'stdout',
                    truncated: true,
                    capturedAtMicroseconds: 1
                }
            } ]
        }
    };
}

export async function createMutationDiagnosticFixture(
    scope: TestScope,
    mode: MutationDiagnosticContext['mode']
): Promise<MutationDiagnosticFixture> {
    const directory = await mkdtemp(path.join(tmpdir(), 'overkill-mutation-diagnostics-'));
    scope.cleanup(async function removeDiagnostics() {
        await rm(directory, { recursive: true, force: true });
    });
    const controller = new AbortController();
    const budget = createInvocationBudget(invocationTimeoutMilliseconds, controller.signal, createClock());
    scope.cleanup(budget.dispose);
    const context: MutationDiagnosticContext = {
        mode,
        directory: path.join(directory, 'mutation'),
        root: '/project',
        campaign: 'campaign',
        seed: '42',
        profile: 'unit'
    };
    const { reply } = mutationCoverageFixture('off');
    return { context, directory, budget, reply: capturedDiagnosticReply(reply), empty: reply };
}

export async function readMutationDiagnosticDocuments(context: MutationDiagnosticContext): Promise<readonly string[]> {
    const directory = path.join(context.directory, context.campaign);
    const invocations = await readdir(directory);
    return await Promise.all(invocations.map(async function readInvocation(invocation) {
        return await readFile(path.join(directory, invocation, 'diagnostics.json'), 'utf8');
    }));
}

export async function createMutationDiagnosticFailure(
    scope: TestScope,
    retainDiagnostics: boolean
): Promise<RunExecutionLifecycle> {
    const evidence = await createMutationEvidenceFixture(scope, retainDiagnostics);
    await evidence.record(evidence.failed, []);
    return evidence.lifecycle;
}

export function assertMutationDiagnosticDocuments(
    scope: TestScope,
    context: MutationDiagnosticContext,
    documents: readonly string[]
): void {
    scope.assert.equal(documents.length, repeatedInvocationCount);
    for (const document of documents) {
        scope.assert.includes(document, '"mutant": "../mutant"');
        scope.assert.includes(document, '"truncated": true');
        scope.assert.includes(document, `"campaign": "${context.campaign}"`);
        scope.assert.includes(document, 'first.test.ts');
    }
    scope.assert.notEqual(documents[0], documents[1]);
}
export function assertMutationDiagnosticCheckpoint(scope: TestScope, diagnostic: SerializedRunDiagnostics): void {
    scope.assert.equal(diagnostic.perTest[0]?.outcome?.kind, 'fail');
    scope.assert.equal(diagnostic.artifacts.length, 1);
    scope.assert.equal(JSON.stringify(parseSerializedRunDiagnostics(diagnostic)), JSON.stringify(diagnostic));
}

export async function createMutationTranscriptFixture(scope: TestScope): Promise<MutationDiagnosticFixture> {
    const fixture = await createMutationDiagnosticFixture(scope, 'all');
    const context = { ...fixture.context, root: fixture.directory };
    await writeFile(path.join(fixture.directory, 'transcript.bin'), 'recorded transcript');
    const reply: ResultReply = {
        ...fixture.reply,
        result: {
            ...fixture.reply.result,
            artifacts: [ {
                id: {
                    attempt: null,
                    runtimes: [],
                    sequence: 1,
                    subtype: 'attachment',
                    workload: null,
                    scope: { kind: 'run' }
                },
                source: 'native',
                payload: {
                    kind: 'runtime-attachment',
                    name: 'transcript',
                    mediaType: 'application/octet-stream',
                    capturedAtMicroseconds: 1,
                    producer: { kind: 'case' },
                    capture: 'opt-in',
                    content: {
                        kind: 'file',
                        path: 'transcript.bin',
                        byteLength: Buffer.byteLength('recorded transcript'),
                        completion: { kind: 'complete' }
                    }
                }
            } ]
        }
    };
    return { ...fixture, context, reply };
}
