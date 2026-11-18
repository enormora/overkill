import { createDeterministicClock, type DeterministicClock } from '@enormora/clock';
import type { ResolvedRun } from '../run/run-types.ts';
import type { RunOrchestratorDependencies } from '../run/run-orchestrator-dependencies.ts';
import type { RunRecordSession } from '../run/run-record.ts';
import type { RunResult } from '../engine/run-result.ts';
import { createUnitRunOrchestrator } from './create-deterministic-run-orchestrator.ts';
import { defaultRunConfig, defaultRunRequest, defaultMicrotestProfile } from './run-command-factory.ts';
import { fakeWorkerPoolRuntimeDependencies } from './worker-pool-runtime-fixtures.ts';

type AttachmentRecordingFixture = {
    readonly resolved: ResolvedRun;
    readonly dependencies: RunOrchestratorDependencies;
    readonly clock: DeterministicClock;
    readonly session: RunRecordSession;
    readonly calls: readonly string[];
    readonly checkpoints: readonly RunResult[];
    readonly writes: ReadonlyMap<string, string>;
};
export async function attachmentRecording(failure: Error | null): Promise<AttachmentRecordingFixture> {
    const resolved = await createUnitRunOrchestrator().resolve({
        cwd: '/project',
        engine: { kind: 'default' },
        config: defaultRunConfig({
            profiles: {
                microtest: defaultMicrotestProfile({ execution: { processModel: 'in-process', scheduling: 'serial' } })
            }
        }),
        request: defaultRunRequest({
            profile: 'microtest',
            paths: [ 'source/integration-tests/run/fixtures/passing.test.ts' ]
        })
    });
    const clock = createDeterministicClock({ initialUnixEpochMicroseconds: 0n });
    const calls: string[] = [];
    const checkpoints: RunResult[] = [];
    const writes = new Map<string, string>();
    return {
        resolved,
        clock,
        calls,
        checkpoints,
        writes,
        dependencies: {
            ...fakeWorkerPoolRuntimeDependencies(),
            wallClock: clock,
            runtimeStateStore: {
                async read(path) {
                    return writes.get(path) ?? null;
                },
                async write(path, content) {
                    writes.set(path, content);
                }
            }
        },
        session: {
            id: 'record',
            startedAt: '2026-10-30T00:00:00.000Z',
            requireDetails() {
                calls.push('details');
            },
            path: '/project/record.json',
            async start() {
                calls.push('start');
            },
            async recordFacts() {
                calls.push('facts');
            },
            async recordResolvedRun() {
                calls.push('resolved');
            },
            retainPlacementTrace() {
                calls.push('placement');
            },
            async complete(result) {
                return { context: { id: null, startedAt: null, facts: null }, ...result, maintenanceDiagnostics: [] };
            },
            async interrupt() {
                calls.push('interrupt');
            },
            async checkpointResult(result) {
                checkpoints.push(result);
                return failure === null ? result : {
                    ...result,
                    runnerErrors: [ {
                        message: failure.message,
                        cause: failure,
                        subtype: 'artifact',
                        diagnostics: [],
                        attributedTo: null,
                        attributedToAttempt: null
                    } ]
                };
            }
        }
    };
}
