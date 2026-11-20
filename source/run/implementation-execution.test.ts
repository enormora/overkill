import { mkdtempDisposable, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestScope, test, suite as authoredSuite } from '@overkill-dev/test';
import type { IntegrationProfileConfig } from '../config/types.ts';
import { placementRunner } from '../test-support/benchmark-placement-fixture.ts';
import { defaultRunConfig, defaultIntegrationProfile, defaultRunRequest } from '../test-support/run-command-factory.ts';
import { writeImplementationProject, type ProjectedResourceScope } from '../test-support/implementation-project.ts';
import type { RunResult } from './run-engine-primitives.ts';

type Placement = {
    readonly processModel: 'supervised-process' | 'worker-pool';
    readonly workerLifecycle: 'fresh-worker-per-unit' | 'reuse';
};
const placements: readonly Placement[] = [
    { processModel: 'supervised-process', workerLifecycle: 'reuse' },
    { processModel: 'worker-pool', workerLifecycle: 'reuse' },
    { processModel: 'worker-pool', workerLifecycle: 'fresh-worker-per-unit' }
];
function placementProfile(placement: Placement): IntegrationProfileConfig {
    const options = {
        reporters: [],
        timeouts: { collectionMilliseconds: 20_000, hardMilliseconds: 20_000, softMilliseconds: 10_000 }
    };
    if (placement.processModel === 'worker-pool') {
        return defaultIntegrationProfile({
            ...options,
            execution: { processModel: 'worker-pool', workerLifecycle: placement.workerLifecycle, maxWorkers: 1 }
        });
    }
    return defaultIntegrationProfile({ ...options, execution: { processModel: 'supervised-process' } });
}
async function runPlacement(
    directory: string,
    placement: Placement
): Promise<RunResult> {
    const profile = placementProfile(placement);
    return await placementRunner(0, function ignoreHostProbe() {
        return undefined;
    })
        .run({
            cwd: directory,
            config: defaultRunConfig({ profiles: { integration: profile } }),
            engine: { kind: 'default' },
            request: defaultRunRequest({ profile: 'integration', paths: [ 'portable.test.mjs' ] })
        });
}
function assertLifetime(scope: TestScope, events: readonly string[]): void {
    scope.assert.equal(
        events
            .filter(function loaded(event) {
                return event.startsWith('loaded ');
            })
            .length,
        1
    );
    scope.assert.deepEqual(events.slice(1), [ 'acquired', 'disposed' ]);
}
async function verifyPlacement(
    scope: TestScope,
    placement: Placement,
    resourceScope: ProjectedResourceScope
): Promise<void> {
    await using directory = await mkdtempDisposable(join(tmpdir(), 'overkill-implementation-'));
    const root = await realpath(directory.path);
    const log = await writeImplementationProject(root, resourceScope);
    const result = await runPlacement(root, placement);
    scope.assert.deepEqual(result.runnerErrors, []);
    scope.assert.equal(result.summary.passed, 2);
    scope.assert.equal(result.status, 'passed');
    const events = await readFile(log, 'utf8');
    assertLifetime(scope, events.trim().split('\n'));
}
export const testNode = authoredSuite(
    'portable implementations across process models',
    placements.flatMap(function placement(value) {
        const scopes: readonly ProjectedResourceScope[] = [ 'per-file', 'per-run', 'per-suite' ];
        return scopes.map(function resourcePlacement(resourceScope) {
            return test(
                `${value.processModel} ${value.workerLifecycle} ${resourceScope} keeps one native owner`,
                async function (scope) {
                    await verifyPlacement(scope, value, resourceScope);
                    return scope.assert.collect();
                }
            );
        });
    })
);
