import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { defineHarness, doubleUsage, suite, test, testDouble } from '@overkill-dev/test';
import { resourceAttachments } from '../attachments/attachment-context.ts';
import { createResourcesModule, type ResourcesModuleDependencies } from './resources.ts';

const directoryAuthoring = defineHarness({}, function directoryFixture() {
    const prefix = '/virtual/overkill-temporary-directory-';
    const create = testDouble<ResourcesModuleDependencies['createTemporaryDirectory']>({
        answer({ arguments: args }) {
            return `${args[0]}created`;
        }
    });
    const remove = testDouble<ResourcesModuleDependencies['removeDirectory']>({
        answer() {
            return undefined;
        }
    });
    const authoring = createResourcesModule({
        temporaryDirectoryPathPrefix: prefix,
        createTemporaryDirectory: create,
        removeDirectory: remove
    });
    return { resource: authoring.createTemporaryDirectoryResource('scratch'), create, remove, prefix };
});
type DirectoryFixture = ReturnType<typeof directoryAuthoring.create>;
const directoryDescriptor = defineCompositeAssertion({
    name: 'inert frozen directory descriptor',
    assert(check, resource: DirectoryFixture['resource']) {
        const symbols = Object.getOwnPropertySymbols(resource);
        const brand = symbols[0];
        if (brand === undefined) {
            return check.defined(brand);
        }
        return check.group([
            check.deepEqual(resource.dependencies, {}),
            check.equal(resource.name, 'scratch'),
            check.equal(resource.scope, 'per-case'),
            check.deepEqual(resource.requirements, []),
            check.true(Object.isFrozen(resource)),
            check.equal(typeof resource, 'object'),
            check.equal(symbols.length, 1),
            check.equal(Reflect.get(resource, brand), true)
        ]);
    }
});

type DirectoryObservation = { readonly frozen: boolean; readonly path: string; };
async function openAndRemoveDirectory(fixture: DirectoryFixture): Promise<DirectoryObservation> {
    const controller = new AbortController();
    const context = {
        workload: null,
        attachments: resourceAttachments('test'),
        dependencies: {},
        scenarios: {},
        signal: controller.signal
    };
    const handle = await fixture.resource.acquire(context);
    const observation = { frozen: Object.isFrozen(handle), path: handle.path };
    if (fixture.resource.dispose === null) {
        throw new Error('Expected temporary directory disposal.');
    }
    await fixture.resource.dispose(handle, context);
    return observation;
}

export const testNode = suite('Temporary directory resource authoring', [
    test('returns an inert frozen descriptor', function (scope) {
        const fixture = directoryAuthoring.create();
        scope.assert(directoryDescriptor, fixture.resource);
        scope.assert(doubleUsage.notCalled, fixture.create);
        return scope.assert.collect();
    }),
    test('creates a frozen handle and removes its directory on disposal', async function (scope) {
        const fixture = directoryAuthoring.create();
        const observed = await openAndRemoveDirectory(fixture);
        scope.assert.true(observed.frozen);
        scope.assert.true(observed.path.includes('overkill-temporary-directory-'));
        scope.assert(doubleUsage.calledOnceWith, fixture.create, [ fixture.prefix ]);
        scope.assert(doubleUsage.calledOnceWith, fixture.remove, [ `${fixture.prefix}created` ]);
        return scope.assert.collect();
    }),
    test('rejects cancelled acquisition before creating a directory', async function (scope) {
        const fixture = directoryAuthoring.create();
        const controller = new AbortController();
        controller.abort();
        await scope.assert.rejects(async function acquireAfterAbort() {
            await fixture.resource.acquire({
                workload: null,
                attachments: resourceAttachments('test'),
                dependencies: {},
                scenarios: {},
                signal: controller.signal
            });
        }, { name: 'AbortError' });
        scope.assert(doubleUsage.notCalled, fixture.create);
        return scope.assert.collect();
    })
]);
