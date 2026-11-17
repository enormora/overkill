import { suite, test } from '../../../packages/test/test.entry-point.ts';
import {
    defineResource,
    withResource,
    withResourceChecks,
    withFailureArtifacts
} from '../../../packages/test/resources.entry-point.ts';

function acquireService() {
    return { secret: 'owner-only', url: 'http://localhost' };
}
const caseResource = defineResource({
    name: 'per-case',
    scope: 'per-case',
    requirements: [],
    acquire: acquireService,
    dispose: null
});
const runResource = defineResource({
    name: 'per-run',
    scope: 'per-run',
    requirements: [],
    acquire: acquireService,
    dispose: null,
    serializeHandle(handle) {
        return { url: handle.url };
    },
    deserializeHandle(handle: { readonly url: string; }) {
        return handle;
    }
});
function observedOwner(resource: typeof caseResource | typeof runResource) {
    return withFailureArtifacts(
        withResourceChecks(
            resource,
            function observe(context) {
                return {
                    prepare() {
                        return undefined;
                    },
                    finalize({ interval }) {
                        if (interval.kind === 'attempt') {
                            context.ledger.record(interval, context.handle.secret, {
                                kind: 'fail',
                                check: {
                                    kind: 'leaf',
                                    id: 'owner-invariant',
                                    source: 'assert',
                                    sourceLocations: [ { kind: 'unknown' } ],
                                    path: [],
                                    diff: null,
                                    actual: { kind: 'boolean', value: false },
                                    expected: { kind: 'boolean', value: true },
                                    summary: 'Owner invariant failed'
                                }
                            });
                        }
                        return { kind: 'complete' };
                    }
                };
            }
        ),
        async function capture(context) {
            await context.attachments.json({ name: 'live-owner', mediaType: 'application/json' }, {
                secret: context.handle.secret
            });
        }
    );
}
const projectedOwner = observedOwner(runResource);
const localOwner = observedOwner(caseResource);
function resourceConsumer(resourceScope: 'per-case' | 'per-run') {
    const owner = resourceScope === 'per-run' ? projectedOwner : localOwner;
    return withResource(owner, function consume(scope) {
        scope.plan(1);
        scope.assert.equal(scope.resources[resourceScope].url, 'http://localhost');
        return scope.assert.collect();
    });
}
export const testNode = suite(
    'resource-check consumers',
    ([ 'per-case', 'per-run' ] as const).map(function ownerScope(resourceScope) {
        const body = resourceConsumer(resourceScope);
        return test(resourceScope, resourceScope === 'per-case' ? withResource(projectedOwner, body) : body);
    })
);
