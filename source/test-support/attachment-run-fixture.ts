import type { TestScope } from '../engine/test-node.ts';
import { defaultAttachmentLimits } from '../engine/runtime-attachment.ts';
import type { RunOrchestratorDependencies } from '../run/run-orchestrator-dependencies.ts';
import { orchestrator } from '../run/run-orchestrator.entry-point.ts';
import type { ResolvedRun } from '../run/run-types.ts';
import { attachmentFixture } from './attachment-fixture.ts';
import { defaultIntegrationProfile, defaultRunConfig, defaultRunRequest } from './run-command-factory.ts';
import { fakeWorkerPoolRuntimeDependencies } from './worker-pool-runtime-fixtures.ts';

type AttachmentRunFixture = {
    readonly resolved: ResolvedRun;
    readonly dependencies: RunOrchestratorDependencies;
    readonly writes: ReadonlyMap<string, string>;
};

export async function attachmentRunFixture(scope: TestScope): Promise<AttachmentRunFixture> {
    const fixture = 'source/integration-tests/run/fixtures/runtime-attachments.test.ts';
    const { directory } = await attachmentFixture(scope, defaultAttachmentLimits);
    const resolved = await orchestrator.resolve({
        config: defaultRunConfig({
            runtimeStateDir: directory,
            profiles: { integration: defaultIntegrationProfile({ files: { include: [ fixture ], exclude: [] } }) }
        }),
        cwd: process.cwd(),
        engine: { kind: 'default' },
        request: defaultRunRequest({ profile: 'integration', paths: [ fixture ] })
    });
    const writes = new Map<string, string>();
    const dependencies = fakeWorkerPoolRuntimeDependencies();
    return {
        resolved,
        writes,
        dependencies: {
            ...dependencies,
            runtimeStateStore: {
                ...dependencies.runtimeStateStore,
                async write(filePath, content) {
                    writes.set(filePath, content);
                }
            }
        }
    };
}
