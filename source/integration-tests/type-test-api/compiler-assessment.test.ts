import { join } from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../../packages/test/test.entry-point.ts';
import { frozenTypeProject } from '../../test-support/frozen-type-project.ts';
import { assessCompilerApi, type CapabilityEvidence } from '../../test-support/type-test-api-assessment.ts';
import { relationSource } from '../../test-support/type-test-relation-project.ts';

function requireEvidence(evidence: readonly CapabilityEvidence[], name: string): CapabilityEvidence {
    const observation = evidence.find(function matches(entry) {
        return entry.requirement === name;
    });
    if (observation === undefined) {
        throw new Error(`Missing assessment evidence: ${name}`);
    }
    return observation;
}

function assertEvidence(scope: TestScope, evidence: readonly CapabilityEvidence[]): void {
    scope.assert.equal(evidence.length, 28);
    scope.assert.equal(
        requireEvidence(evidence, 'Overload').calls,
        2
    );
    scope.assert.equal(
        requireEvidence(evidence, 'Generic').calls,
        1
    );
    scope.assert.true(evidence.every(function valid(entry) {
        return !entry.errorType;
    }));
    for (
        const [ name, forward, reverse ] of [
            [ 'Literal', true, false ],
            [ 'NeverString', true, false ],
            [ 'AnyUnknown', true, true ],
            [ 'Readonly', true, true ],
            [ 'Nominal', false, false ],
            [ 'Protected', false, false ],
            [ 'Symbol', false, false ],
            [ 'Inference', true, true ],
            [ 'Imported', true, true ],
            [ 'Self', true, true ]
        ] as const
    ) {
        const observation = requireEvidence(evidence, name);
        scope.assert.equal(observation.forward, forward);
        scope.assert.equal(observation.reverse, reverse);
    }
    scope.assert.deepEqual(
        requireEvidence(evidence, 'Intersection').properties,
        [ 'a', 'b' ]
    );
}

export const testNode = suite('TypeScript beta public API assessment', [
    test('observes original types and assignability without emitting files', async function (scope) {
        const directory = await frozenTypeProject(scope, {
            'tsconfig.json': JSON.stringify({
                compilerOptions: { strict: true, noEmit: true },
                files: [ 'relations.ts' ]
            }),
            'relations.ts': relationSource,
            'dependency.ts': 'export type Value = { readonly value: string };'
        });
        const before = await readdir(directory);
        for (let invocation = 0; invocation < 2; invocation += 1) {
            const evidence = assessCompilerApi(join(directory, 'tsconfig.json'));
            assertEvidence(scope, evidence);
        }
        scope.assert.deepEqual(await readdir(directory), before);
        scope.assert.equal(await readFile(join(directory, 'relations.ts'), 'utf8'), relationSource);
        return scope.assert.collect();
    }),
    test('retains inherited strict null checking', async function (scope) {
        const directory = await frozenTypeProject(scope, {
            'base.json': JSON.stringify({ compilerOptions: { strict: true, noEmit: true } }),
            'tsconfig.json': JSON.stringify({ extends: './base.json', files: [ 'relations.ts' ] }),
            'relations.ts': 'export type NullActual = null; export type NullExpected = string;'
        });
        scope.assert.equal(assessCompilerApi(join(directory, 'tsconfig.json'))[0]?.forward, false);
        return scope.assert.collect();
    }),
    test('rejects unavailable referenced declarations without building them', async function (scope) {
        const directory = await frozenTypeProject(scope, {
            'tsconfig.json': JSON.stringify({
                compilerOptions: { disableSourceOfProjectReferenceRedirect: true },
                references: [ { path: './dependency' } ],
                files: [ 'relations.ts' ]
            }),
            'relations.ts':
                "export type RefActual = import('./dependency/value.js').Value; export type RefExpected = string;",
            'dependency/tsconfig.json': JSON.stringify({ compilerOptions: { composite: true }, files: [ 'value.ts' ] }),
            'dependency/value.ts': 'export type Value = string;'
        });
        scope.assert.throws(function missingOutput() {
            assessCompilerApi(join(directory, 'tsconfig.json'));
        }, { message: /compiler diagnostics/u });
        scope.assert.deepEqual(await readdir(join(directory, 'dependency')), [ 'tsconfig.json', 'value.ts' ]);
        return scope.assert.collect();
    }),
    test('rejects compiler diagnostics and releases the failed invocation', async function (scope) {
        const directory = await frozenTypeProject(scope, {
            'tsconfig.json': JSON.stringify({ files: [ 'invalid.ts' ] }),
            'invalid.ts': 'export type Invalid = Missing;'
        });
        for (let invocation = 0; invocation < 2; invocation += 1) {
            scope.assert.throws(function invalidProject() {
                assessCompilerApi(join(directory, 'tsconfig.json'));
            }, { message: /compiler diagnostics/u });
        }
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
