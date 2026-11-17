import type { PropertyWitnessRunInput, PropertyWitnessStorageFactory } from '../run/property-witness-storage.ts';
import { finalizeRuntimeAttachments } from '../run/attachment-coordinator-context.ts';
import type { TestScope } from '../packages/test/test.entry-point.ts';
import { attachmentRecording } from './attachment-recording.ts';
import { witnessAttachmentRetention, confirmedWitnessResult } from './witness-attachment-retention.ts';

type WitnessRunScenario = 'complete' | 'exchange' | 'finish' | 'none' | 'run' | 'storage';
type WitnessRunFixture = {
    readonly input: PropertyWitnessRunInput;
    readonly storage: PropertyWitnessStorageFactory;
    readonly events: readonly string[];
    readonly failure: Error;
};
export async function propertyWitnessRun(
    scope: TestScope,
    scenario: WitnessRunScenario,
    confirmed: boolean,
    owned: boolean
): Promise<WitnessRunFixture> {
    const recording = await attachmentRecording(null);
    const failure = new Error('witness storage failed');
    const witness = witnessAttachmentRetention(scope, scenario === 'exchange' ? failure : null);
    const events: string[] = [];
    const session = {
        ...recording.session,
        async complete(result: Awaited<ReturnType<PropertyWitnessRunInput['run']>>) {
            events.push('complete');
            if (scenario === 'complete') {
                throw failure;
            }
            return { ...result, maintenanceDiagnostics: [] };
        },
        async interrupt() {
            events.push('interrupt');
        }
    };
    return {
        events,
        failure,
        input: {
            resolved: recording.resolved,
            dependencies: recording.dependencies,
            session: owned ? null : session,
            async run() {
                const result = await finalizeRuntimeAttachments(confirmedWitnessResult(confirmed));
                if (scenario === 'run') {
                    throw failure;
                }
                return result;
            }
        },
        async storage(input) {
            events.push('storage');
            if (scenario === 'storage') {
                throw failure;
            }
            input.retainRecord({
                session,
                captureTime() {
                    return 0;
                },
                async checkpoint() {
                    events.push('checkpoint');
                }
            });
            return {
                execution: witness.execution,
                store: {
                    async finish() {
                        events.push('finish');
                        if (scenario === 'finish') {
                            throw failure;
                        }
                        return [];
                    },
                    settleResult() {
                        events.push('settle');
                    },
                    selectedArtifacts() {
                        return [];
                    }
                }
            };
        }
    };
}
