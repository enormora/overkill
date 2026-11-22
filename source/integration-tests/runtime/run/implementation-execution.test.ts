import { mkdtempDisposable, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    type CompositeAssertionReturn,
    type CompositeCheckBuilder,
    defineCompositeAssertion
} from '@overkill-dev/test/assert';

import { table, suite } from '@overkill-dev/test';

import type { IntegrationProfileConfig } from '../../../config/types.ts';
import { placementRunner } from '../../../test-support/benchmark-placement-fixture.ts';
import {
    defaultRunConfig,
    defaultIntegrationProfile,
    defaultRunRequest
} from '../../../test-support/run-command-factory.ts';
import {
    writeImplementationProject,
    type ProjectedResourceScope
} from '../../../test-support/implementation-project.ts';
import type { RunResult } from '../../../run/run-engine-primitives.ts';

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
const lifetimeChecks = function (
    check: CompositeCheckBuilder<'assert'>,
    events: readonly string[]
): CompositeAssertionReturn<'assert'> {
    return check.group([
        check.equal(
            events
                .filter(function loaded(event) {
                    return event.startsWith('loaded ');
                })
                .length,
            1
        ),
        check.deepEqual(events.slice(1), [ 'acquired', 'disposed' ])
    ]);
};

const verifyPlacement = defineCompositeAssertion({
    name: 'verify placement',
    async assert(check, placement: Placement, resourceScope: ProjectedResourceScope) {
        await using directory = await mkdtempDisposable(join(tmpdir(), 'overkill-implementation-'));
        const root = await realpath(directory.path);
        const log = await writeImplementationProject(root, resourceScope);
        const result = await runPlacement(root, placement);
        const initialChecks = check.group([
            check.deepEqual(result.runnerErrors, []),
            check.equal(result.summary.passed, 2),
            check.equal(result.status, 'passed')
        ]);
        const events = await readFile(log, 'utf8');
        return check.group([ initialChecks, lifetimeChecks(check.annotated('lifetime'), events.trim().split('\n')) ]);
    }
});
export const testNode = suite(
    'portable implementations across process models',
    [ table({
        title: 'keeps one native owner',
        cases: placements.flatMap(function placement(value) {
            const scopes: readonly ProjectedResourceScope[] = [ 'per-file', 'per-run', 'per-suite' ];
            return scopes.map(function resourcePlacement(resourceScope) {
                return { value, resourceScope };
            });
        }),
        caseTitle({ value, resourceScope }) {
            return [ value.processModel, value.workerLifecycle, resourceScope ].map(String).join(
                ', '
            );
        },
        async test(scope) {
            const { value, resourceScope } = scope.parameters;

            await scope.assert(verifyPlacement, value, resourceScope);
            return scope.assert.collect();
        }
    }) ]
);
