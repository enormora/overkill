import {
    createMutationDiagnosticStorage,
    type MutationDiagnosticContext,
    type MutationDiagnosticDocument
} from '../packages/stryker-runner/mutation-diagnostic-storage.ts';
import { serializeRunDiagnostics } from '../run/run-record-result.ts';
import { runResultFactory } from './run-result-factory.ts';
import { exchangedAttachment } from './attachment-exchange.ts';

export type DiagnosticStorageScenario = 'copy-error' | 'destination-size' | 'pass' | 'source-size' | 'write-error';
type DiagnosticWrite = { readonly path: string; readonly content: string; };
type DiagnosticStorageFixture = {
    readonly save: (file: boolean) => Promise<void>;
    readonly calls: readonly string[];
    readonly writes: readonly DiagnosticWrite[];
    readonly failure: Error;
};
const context: MutationDiagnosticContext = {
    mode: 'all',
    root: '/project',
    directory: '/project/diagnostics',
    campaign: 'campaign',
    seed: '42',
    profile: 'unit'
};
function diagnosticDocument(file: boolean): MutationDiagnosticDocument {
    const artifact = file
        ? {
            ...exchangedAttachment,
            payload: {
                ...exchangedAttachment.payload,
                content: {
                    kind: 'file' as const,
                    path: 'evidence.bin',
                    byteLength: 5,
                    completion: { kind: 'complete' as const }
                }
            }
        }
        : exchangedAttachment;
    return {
        version: 1,
        campaign: 'campaign',
        invocation: 'invocation',
        seed: '42',
        profile: 'unit',
        execution: { kind: 'dry' },
        diagnostics: serializeRunDiagnostics(runResultFactory.build({ artifacts: [ artifact ] })),
        failure: null
    };
}
const expectedBytes = 5;
const mismatchedBytes = 4;
export function mutationDiagnosticStorage(scenario: DiagnosticStorageScenario): DiagnosticStorageFixture {
    const calls: string[] = [];
    const writes: DiagnosticWrite[] = [];
    const failure = new Error('Storage failed.');
    const write = createMutationDiagnosticStorage({
        async size(path) {
            calls.push(`size:${path}`);
            const mismatched = scenario === 'source-size'
                ? path === '/project/evidence.bin'
                : scenario === 'destination-size' && path !== '/project/evidence.bin';
            return mismatched ? mismatchedBytes : expectedBytes;
        },
        async createDirectory(path) {
            calls.push(`directory:${path}`);
        },
        async copy(source, destination) {
            calls.push(`copy:${source}:${destination}`);
            if (scenario === 'copy-error') {
                throw failure;
            }
        },
        async write(path, content) {
            calls.push(`write:${path}`);
            if (scenario === 'write-error') {
                throw failure;
            }
            writes.push({ path, content });
        }
    });
    return {
        calls,
        writes,
        failure,
        async save(file) {
            await write(context, diagnosticDocument(file));
        }
    };
}
