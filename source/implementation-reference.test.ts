import { z } from 'zod/v4';
import { runIfMain } from '#test-runner';
import { suite, test } from './packages/test/test.entry-point.ts';
import {
    defineImplementationReference,
    implementationFacts,
    readImplementationExport,
    type ImplementationReference
} from './implementation-reference.ts';

function reference(): ImplementationReference<{ readonly expected: number; }> {
    return defineImplementationReference({
        module: { moduleUrl: 'file:///project/body.mjs', exportName: 'body' },
        realm: 'host',
        version: '1',
        input: { expected: 200 },
        parseInput(input: unknown) {
            return z.object({ expected: z.number() }).parse(input);
        },
        dynamicModules: []
    });
}

export const testNode = suite('portable implementation references', [
    test('snapshots inputs without loading the named implementation', function (scope) {
        const declaration = reference();
        const facts = implementationFacts(declaration, { projectRoot: '/project' });
        scope.assert.deepEqual(z.strictObject({ expected: z.number() }).parse(facts.input), { expected: 200 });
        scope.assert.equal(Object.isFrozen(facts.input), true);
        scope.assert.equal(Object.hasOwn(facts, 'parseInput'), false);
        scope.assert.equal(facts.module.moduleUrl, 'file:///project/body.mjs');
        return scope.assert.collect();
    }),
    test('requires an explicit absolute root', function (scope) {
        scope.assert.throws(function prepareRelativeRoot() {
            implementationFacts(reference(), { projectRoot: 'relative' });
        }, { type: TypeError });
        return scope.assert.collect();
    }),
    test('validates export presence, version, and implementation shape', function (scope) {
        const facts = implementationFacts(reference(), { projectRoot: '/project' });
        function numberImplementation(value: unknown): number {
            if (typeof value !== 'number') {
                throw new TypeError('Expected a number.');
            }
            return value;
        }
        scope.assert.equal(
            readImplementationExport({ body: { version: '1', implementation: 42 } }, facts, numberImplementation),
            42
        );
        scope.assert.throws(function changedVersion() {
            readImplementationExport({ body: { version: '2', implementation: 42 } }, facts, numberImplementation);
        }, { type: TypeError });
        scope.assert.throws(function missingExport() {
            readImplementationExport({}, facts, numberImplementation);
        }, { type: TypeError });
        scope.assert.throws(function invalidImplementation() {
            readImplementationExport({ body: { version: '1', implementation: null } }, facts, numberImplementation);
        }, { type: TypeError });
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
