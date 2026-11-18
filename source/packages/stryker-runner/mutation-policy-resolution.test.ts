import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../test/test.entry-point.ts';
import { ConfigError } from '../run/config.entry-point.ts';
import { RunResolutionError } from '../run/run.entry-point.ts';
import { mutationPolicyResolution } from '../../test-support/mutation-policy-resolution.ts';
import { resolveMutationPolicyRequest } from './mutation-policy-resolver.ts';

const sandbox = { originalRoot: '/project', root: '/sandbox', files: [], sharedRoots: [] };
export const testNode = suite('mutation policy resolution', [
    test('freezes selected microtests against the loaded configuration', async function (scope: TestScope) {
        const fixture = await mutationPolicyResolution('/project/overkill.config.js', null);
        const response = await resolveMutationPolicyRequest(fixture.request, fixture.runtime);
        scope.assert.deepEqual(response, { kind: 'policy', policy: fixture.policy });
        scope.assert.deepEqual(fixture.loaded, [ { cwd: '/project', configPath: null } ]);
        scope.assert.equal(fixture.frozen[0]?.command.request.profile, 'unit');
        scope.assert.deepEqual(fixture.boundaries, [ null ]);
        scope.assert.deepEqual(fixture.excluded, []);
        return scope.assert.collect();
    }),
    test('rebases sandbox settings and verifies exclusions around freezing', async function (scope: TestScope) {
        const fixture = await mutationPolicyResolution('/sandbox/overkill.config.js', null);
        const response = await resolveMutationPolicyRequest({
            ...fixture.request,
            sandbox,
            cwd: '/sandbox',
            settings: {
                seed: '42',
                profile: 'unit',
                configPath: '/project/overkill.config.js',
                paths: [ '/project/case.test.ts' ]
            }
        }, fixture.runtime);
        scope.assert.equal(response.kind, 'policy');
        scope.assert.deepEqual(fixture.loaded, [ { cwd: '/sandbox', configPath: '/sandbox/overkill.config.js' } ]);
        scope.assert.deepEqual<unknown, unknown>(fixture.frozen[0]?.command.request.paths, [ '/sandbox/case.test.ts' ]);
        scope.assert.deepEqual(
            fixture.excluded.map(function (entry) {
                return entry.role;
            }),
            [ 'configuration', 'test definitions' ]
        );
        scope.assert.deepEqual(fixture.boundaries, [ { projectRoot: '/sandbox', sharedRoots: [] } ]);
        return scope.assert.collect();
    }),
    test('checks test definitions when a sandbox has no configuration file', async function (scope: TestScope) {
        const fixture = await mutationPolicyResolution(null, null);
        await resolveMutationPolicyRequest({ ...fixture.request, sandbox, cwd: '/sandbox' }, fixture.runtime);
        scope.assert.deepEqual(
            fixture.excluded.map(function (entry) {
                return entry.role;
            }),
            [ 'test definitions' ]
        );
        return scope.assert.collect();
    }),
    test(
        'rejects sandbox identities conflicting with the resolver working directory',
        async function (scope: TestScope) {
            const fixture = await mutationPolicyResolution(null, null);
            scope.assert.deepEqual(
                await resolveMutationPolicyRequest({ ...fixture.request, sandbox }, fixture.runtime),
                { kind: 'config-error', message: 'Mutation sandbox conflicts with resolver cwd.', cause: null }
            );
            scope.assert.deepEqual(fixture.loaded, []);
            return scope.assert.collect();
        }
    ),
    test('serializes configuration errors with their original cause message', async function (scope: TestScope) {
        const fixture = await mutationPolicyResolution(
            null,
            new ConfigError('Configuration failed.', { cause: new Error('Read failed.') })
        );
        scope.assert.deepEqual(await resolveMutationPolicyRequest(fixture.request, fixture.runtime), {
            kind: 'config-error',
            message: 'Configuration failed.',
            cause: 'Read failed.'
        });
        scope.assert.deepEqual(fixture.frozen, []);
        return scope.assert.collect();
    }),
    test('serializes resolution errors without losing their classification', async function (scope: TestScope) {
        const fixture = await mutationPolicyResolution(
            null,
            new RunResolutionError('Unsupported.', {}, 'unsupported-request')
        );
        scope.assert.deepEqual(await resolveMutationPolicyRequest(fixture.request, fixture.runtime), {
            kind: 'resolution-error',
            message: 'Unsupported.',
            code: 'unsupported-request'
        });
        return scope.assert.collect();
    }),
    ...[ new Error('Backend failed.'), 'Backend failed.' ].map(function (failure, index) {
        return test(`serializes unexpected backend failure ${index}`, async function (scope: TestScope) {
            const fixture = await mutationPolicyResolution(null, failure);
            scope.assert.deepEqual(await resolveMutationPolicyRequest(fixture.request, fixture.runtime), {
                kind: 'error',
                message: 'Backend failed.'
            });
            return scope.assert.collect();
        });
    }),
    test('rejects malformed settings before loading configuration', async function (scope: TestScope) {
        const fixture = await mutationPolicyResolution(null, null);
        const response = await resolveMutationPolicyRequest(
            { ...fixture.request, settings: { seed: '-1' } },
            fixture.runtime
        );
        scope.assert.equal(response.kind, 'config-error');
        scope.assert.deepEqual(fixture.loaded, []);
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
