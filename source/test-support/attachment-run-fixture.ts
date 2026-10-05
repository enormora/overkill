import type { TestScope } from '../engine/test-node.ts';
import { defaultAttachmentLimits } from '../engine/runtime-attachment.ts';
import type { RunOrchestratorDependencies } from '../run/run-orchestrator-dependencies.ts';
import { orchestrator } from '../run/run-orchestrator.entry-point.ts';
import type { ResolvedRun } from '../run/run-types.ts';
import { defineResource, withResources } from '../packages/test/resources.entry-point.ts';
import { createTestEngine } from './create-test-engine.ts';
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
            profiles: {
                integration: defaultIntegrationProfile({
                    files: { include: [ fixture ], exclude: [] },
                    timeouts: { collectionMilliseconds: 30_000 }
                })
            }
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

export async function localAttachmentRunFixture(scope: TestScope): Promise<AttachmentRunFixture> {
    const fixture = await attachmentRunFixture(scope);
    const engine = createTestEngine();
    const service = defineResource({
        name: 'service',
        scope: 'per-case',
        requirements: [],
        dispose: null,
        acquire() {
            return { ready: true };
        }
    });
    const body = withResources({ service }, function inspectService(caseScope) {
        caseScope.assert.equal(caseScope.resources.service.ready, true);
        return caseScope.assert.collect();
    });
    const testPlan = engine.createTestPlan(engine.createRoot({
        annotations: {},
        controls: {},
        title: 'root',
        children: [ engine.createTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'case',
            body
        }) ]
    }));
    const firstCase = fixture.resolved.facts.cases[0];
    scope.require.defined(firstCase);
    return {
        ...fixture,
        resolved: {
            ...fixture.resolved,
            plan: { kind: 'local', testPlan },
            facts: {
                ...fixture.resolved.facts,
                cases: testPlan.cases.map(function localCase(testCase) {
                    return { ...firstCase, workId: testCase.workId };
                })
            }
        }
    };
}
