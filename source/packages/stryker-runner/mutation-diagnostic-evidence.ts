import {
    serializeRunDiagnostics,
    parseSerializedRunDiagnostics,
    type RunExecutionReply,
    type SerializedRunDiagnostics
} from '../run/run.entry-point.ts';
import { canonicalWork, mutationLifecycleDataSchema } from './mutation-catalog.ts';

type CaseId = SerializedRunDiagnostics['perTest'][number]['id'];
function canonicalCase(root: string, id: CaseId): CaseId {
    return canonicalWork(root, { case: id, runtimes: [], workload: null }).case;
}
function canonicalArtifactIdentity<Artifact extends SerializedRunDiagnostics['artifacts'][number]>(
    root: string,
    artifact: Artifact
): Artifact {
    const { scope } = artifact.id;
    return scope.kind === 'run' ? artifact : {
        ...artifact,
        id: {
            ...artifact.id,
            scope: {
                ...scope,
                case: canonicalCase(root, scope.case),
                activeCases: scope.activeCases.map(function canonicalActiveCase(id) {
                    return canonicalCase(root, id);
                })
            }
        }
    };
}
function checkpointDiagnostics(
    reply: RunExecutionReply | null
): Pick<SerializedRunDiagnostics, 'perTest' | 'runnerErrors'> {
    const checkpoint = reply === null ? null : mutationLifecycleDataSchema.safeParse(reply.data).data?.diagnostics;
    return checkpoint === null || checkpoint === undefined
        ? { perTest: [], runnerErrors: [] }
        : parseSerializedRunDiagnostics(checkpoint);
}
function deliveredDiagnostics(reply: RunExecutionReply | null): SerializedRunDiagnostics {
    if (reply?.kind === 'result') {
        return serializeRunDiagnostics(reply.result);
    }
    const { artifacts } = serializeRunDiagnostics({ artifacts: reply?.artifacts ?? [], perTest: [], runnerErrors: [] });
    return { ...checkpointDiagnostics(reply), artifacts };
}
function canonicalErrorWork(
    root: string,
    work: SerializedRunDiagnostics['runnerErrors'][number]['attributedToWork']
): NonNullable<SerializedRunDiagnostics['runnerErrors'][number]['attributedToWork']> | null {
    return work === null || work === undefined ? null : canonicalWork(root, work);
}

export function mutationDiagnosticEvidence(root: string, reply: RunExecutionReply | null): SerializedRunDiagnostics {
    const diagnostics = deliveredDiagnostics(reply);
    return {
        artifacts: diagnostics
            .artifacts
            .filter(function diagnosticArtifact(artifact) {
                return artifact.payload.kind !== 'coverage';
            })
            .map(function canonicalArtifact(artifact) {
                return canonicalArtifactIdentity(root, artifact);
            }),
        perTest: diagnostics
            .perTest
            .filter(function failedCase(result) {
                return result.verdict !== 'pass' && result.verdict !== 'skip';
            })
            .map(function canonicalResult(result) {
                return { ...result, id: canonicalCase(root, result.id), workId: canonicalWork(root, result.workId) };
            }),
        runnerErrors: diagnostics.runnerErrors.map(function canonicalError(error) {
            return {
                ...error,
                attributedTo: error.attributedTo === null ? null : canonicalCase(root, error.attributedTo),
                attributedToWork: canonicalErrorWork(root, error.attributedToWork)
            };
        })
    };
}
