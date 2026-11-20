import { type TestNode, suite, test, type TestScope } from '@overkill-dev/test';

import { defineResource, defineRuntime, defineRuntimeMatrix } from '../resources/resources.entry-point.ts';
import { referencedTestBody } from '../../test-support/referenced-test-body.ts';
import { resolveTestBodyWorkload } from '../../engine/test-body.ts';
import {
    attachTestBodyResourceAttachments,
    readTestBodyResourceAttachments,
    hasAttachedResourceDescriptors
} from '../../engine/test-body-resource-attachment.ts';

import {
    attachComposedResourceActions,
    attachComposedResourceBody,
    mapComposedResourceBody
} from './resource-wrapper-composition.ts';

export const testNode: TestNode = suite('referenced resource composition', [
    test('attaches resource metadata before binding a referenced body', function (scope) {
        const fixture = referencedTestBody();
        const resource = defineResource({
            name: 'value',
            scope: 'per-case',
            requirements: [],
            acquire() {
                return 42;
            },
            dispose: null
        });
        const wrapped = attachComposedResourceBody(
            { kind: 'resources', resources: { value: resource } },
            fixture.body,
            'withResource'
        );
        scope.assert.partialDeepEqual(readTestBodyResourceAttachments(wrapped), {
            directResources: [ { key: 'value', resourceName: 'value' } ],
            resourceGraph: [ { name: 'value', scope: 'per-case' } ]
        });
        return scope.assert.collect();
    }),
    test('prepares resource implementation metadata for every referenced runtime variant', function (scope) {
        const fixture = referencedTestBody();
        const resource = defineResource({
            name: 'value',
            scope: 'per-case',
            requirements: [],
            acquire() {
                return 42;
            },
            dispose: null
        });
        const runtime = defineRuntime({
            name: 'runtime',
            dimensions: { version: '1' },
            requirements: [],
            resources: { value: resource }
        });
        const second = defineRuntime({
            name: 'second',
            dimensions: { version: '2' },
            requirements: [],
            resources: { value: resource }
        });
        const matrix = defineRuntimeMatrix({ name: 'matrix', variants: { first: runtime, second } });
        const wrapped = attachComposedResourceBody({ kind: 'runtime', runtime: matrix }, fixture.body, 'withRuntime');
        scope.assert.partialDeepEqual(readTestBodyResourceAttachments(wrapped), {
            runtimeGraphs: [ {
                kind: 'runtime-matrix',
                name: 'matrix',
                variants: [ { id: 'first' }, { id: 'second' } ]
            } ]
        });
        return scope.assert.collect();
    }),
    test('binds scope mappings after resolving a referenced implementation', async function (scope) {
        const fixture = referencedTestBody();
        const body = attachComposedResourceActions<TestScope>(
            [ {
                kind: 'scope',
                name: 'tag',
                collision: 'replace-existing',
                mapScope() {
                    return { tag: 'mapped' };
                }
            } ],
            fixture.body,
            'withTag'
        );
        const namespace = {
            body: {
                version: '1',
                implementation(value: unknown) {
                    const tag: unknown = Reflect.get(new Object(value), 'tag');
                    return tag;
                }
            }
        };
        const result = await body.bind(namespace, fixture.facts, fixture.context)(scope);
        scope.assert.equal(result, 'mapped');
        return scope.assert.collect();
    }),
    test('retains deferred scope mappings when binding workload identity', async function (scope) {
        const fixture = referencedTestBody();
        const body = attachComposedResourceActions<TestScope>(
            [ {
                kind: 'scope',
                name: 'tag',
                collision: 'preserve-existing',
                mapScope() {
                    return { tag: 'mapped' };
                }
            } ],
            fixture.body,
            'withTag'
        );
        const selected = resolveTestBodyWorkload(body, null);
        const namespace = {
            body: {
                version: '1',
                implementation(value: unknown) {
                    const tag: unknown = Reflect.get(new Object(value), 'tag');
                    return tag;
                }
            }
        };
        scope.assert.equal(
            await selected.bind(namespace, fixture.facts, fixture.context)(scope),
            'mapped'
        );
        return scope.assert.collect();
    }),
    test('maps referenced execution after binding its implementation', async function (scope) {
        const fixture = referencedTestBody();
        const observed: unknown[] = [];
        const body = mapComposedResourceBody(
            fixture.body,
            async function (original, inner) {
                observed.push(Reflect.apply(original, undefined, [ inner ]));
                scope.assert.deepEqual(observed, [ 42 ]);
                return scope.assert.collect();
            },
            'capture',
            null
        );
        await body.bind(
            {
                body: {
                    version: '1',
                    implementation() {
                        return 42;
                    }
                }
            },
            fixture.facts,
            fixture.context
        )(scope);
        scope.assert.equal(observed.length, 1);
        return scope.assert.collect();
    }),
    test('attaches frozen resource metadata to referenced bodies', function (scope) {
        const fixture = referencedTestBody();
        const metadata = {
            directResources: [ { key: 'service', resourceName: 'service' } ],
            resourceGraph: [],
            runtimeGraphs: []
        };
        const body = attachTestBodyResourceAttachments(fixture.body, metadata);
        const attached = readTestBodyResourceAttachments(body);
        scope.assert.deepEqual(attached, metadata);
        scope.assert.true(Object.isFrozen(attached.directResources));
        scope.assert.equal(body.reference, fixture.body.reference);
        return scope.assert.collect();
    }),
    test('recognizes resources inside runtime matrix variants', function (scope) {
        const empty = { dimensions: {}, name: 'runtime', requirements: [], resources: [], scenarioBindings: [] };
        scope.assert.false(
            hasAttachedResourceDescriptors({
                directResources: [],
                resourceGraph: [],
                runtimeGraphs: [ {
                    kind: 'runtime-matrix',
                    name: 'matrix',
                    resources: [],
                    variants: [ { id: 'empty', runtime: empty } ]
                } ]
            })
        );
        scope.assert.true(
            hasAttachedResourceDescriptors({
                directResources: [],
                resourceGraph: [],
                runtimeGraphs: [ {
                    kind: 'runtime-matrix',
                    name: 'matrix',
                    resources: [],
                    variants: [ {
                        id: 'resource',
                        runtime: { ...empty, resources: [ { key: 'service', resourceName: 'service' } ] }
                    } ]
                } ]
            })
        );
        return scope.assert.collect();
    })
]);
