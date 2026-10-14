import {
    createEngine,
    attachTestBodyFamily,
    forwardTestBodyFamily,
    createRoot,
    createTestPlan,
    readTestBodyFamily,
    resolveSourceLocation,
    type TestNode,
    type TestPlan,
    type TestScope
} from '../packages/engine/engine.entry-point.ts';
import { defineMacro, suite, test } from '../packages/test/test.entry-point.ts';
import * as leaf from '../packages/property/property.entry-point.ts';
import * as standard from '../packages/test/property.entry-point.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import { unexecutedGenerator } from '../test-support/property-generator.ts';
import { stampTestNodeFamily } from '../engine/test-node.ts';
import { assertTestPlanMatchesTestFamily } from '../run/run-selection.ts';
import { property, withProperties } from './property-authoring.ts';

function planFor(node: TestNode): TestPlan {
    return createTestPlan(createRoot({ annotations: {}, children: [ node ], controls: {}, title: 'property root' }));
}

function unexpectedPropertyBody(): never {
    throw new Error('Property body must not execute.');
}

export const testNode = suite('property authoring', [
    test('forwarding metadata preserves an existing declaration and rejects replacement', function (scope) {
        const source = attachTestBodyFamily(function sourceBody() {
            throw new Error('Source must not execute.');
        }, { family: 'property', definition: 'original' });
        const target = forwardTestBodyFamily(source, function targetBody() {
            throw new Error('Target must not execute.');
        });
        const replacement = attachTestBodyFamily(function replacementBody() {
            throw new Error('Replacement must not execute.');
        }, { family: 'integration', definition: 'replacement' });
        scope.assert.equal(forwardTestBodyFamily(source, target), target);
        scope.assert.throws(function preserveDeclaration() {
            forwardTestBodyFamily(replacement, target);
        }, { message: 'Cannot replace test body family metadata.' });
        scope.assert.equal(readTestBodyFamily(target)?.definition, 'original');
        return scope.assert.collect();
    }),
    test('leaf and standard subpath expose the same narrow surface', function (scope) {
        scope.assert.deepEqual(
            Object.keys(leaf).toSorted(function compareExportNames(left, right) {
                return left.localeCompare(right);
            }),
            [ 'property', 'withProperties' ]
        );
        scope.assert.equal(leaf.property, standard.property);
        scope.assert.equal(leaf.withProperties, standard.withProperties);
        return scope.assert.collect();
    }),
    test('family metadata rejects invalid bodies and duplicate attachments', function (scope) {
        const attachment = { family: 'integration', definition: 'foreign' } as const;
        const body = attachTestBodyFamily(function foreignBody() {
            throw new Error('Foreign body must not execute.');
        }, attachment);
        scope.assert.throws(function rejectInvalidBody() {
            Reflect.apply(attachTestBodyFamily, undefined, [ null, attachment ]);
        }, { message: 'Test body family metadata requires a body function.' });
        scope.assert.throws(function preserveExistingAttachment() {
            attachTestBodyFamily(body, attachment);
        }, { message: 'Test body already has family metadata.' });
        scope.assert.throws(function rejectForeignFamily() {
            withProperties(body);
        }, { message: 'withProperties() cannot wrap a body belonging to another test family.' });
        return scope.assert.collect();
    }),
    test('forwarding cannot replace another declaration within the same family', function (scope) {
        const source = attachTestBodyFamily(function sourceBody() {
            throw new Error('Source must not execute.');
        }, { family: 'property', definition: 'original' });
        const replacement = attachTestBodyFamily(function replacementBody() {
            throw new Error('Replacement must not execute.');
        }, { family: 'property', definition: 'replacement' });
        scope.assert.throws(function preserveDefinition() {
            forwardTestBodyFamily(replacement, source);
        }, { message: 'Cannot replace test body family metadata.' });
        scope.assert.equal(readTestBodyFamily(source)?.definition, 'original');
        return scope.assert.collect();
    }),
    test('first-class declarations retain inputs without executing them', function (scope: TestScope) {
        const generator = unexecutedGenerator<number>();
        const node = property({ title: 'declared property', generator, test: unexpectedPropertyBody });
        const selected = planFor(node).cases[0];
        if (selected.execution.kind !== 'body') {
            throw new Error('Expected an executable property declaration.');
        }
        const attachment = readTestBodyFamily(selected.execution.body);
        scope.require.defined(attachment);
        scope.assert.deepEqual(attachment.definition, {
            kind: 'property',
            settingsDeclarations: [ { kind: 'profile-default' } ],
            generator,
            test: unexpectedPropertyBody,
            definitionLocations: node.definitionLocations
        });
        scope.assert.deepEqual([ Object.isFrozen(attachment), Object.isFrozen(attachment.definition) ], [ true, true ]);
        return scope.assert.collect();
    }),
    test('first-class nodes preserve engine ownership and snapshot the title', function (scope) {
        const definition = {
            title: 'declared property',
            generator: unexecutedGenerator<number>(),
            test: unexpectedPropertyBody
        };
        const node = property(definition);
        const plan = planFor(suite('laws', [ node ]));
        scope.assert.equal(node.kind, 'test');
        scope.assert.equal(plan.cases[0].testFamily, 'property');
        scope.assert.equal(plan.cases.length, 1);
        scope.assert.equal(createEngine().ownsTestNode(node), false);
        definition.title = 'changed';
        scope.assert.equal(node.title, 'declared property');
        return scope.assert.collect();
    }),
    test('nested authoring retains the enclosing body and adds one case', function (scope) {
        const body = withProperties(unexpectedPropertyBody);
        const wrappedAgain = withProperties(body);
        const plan = planFor(test('nested', wrappedAgain));
        scope.assert.equal(plan.cases.length, 1);
        scope.assert.equal(plan.cases[0].testFamily, 'property');
        scope.assert.equal(readTestBodyFamily(wrappedAgain)?.definition, readTestBodyFamily(body)?.definition);
        return scope.assert.collect();
    }),
    test('invalid definitions fail before generator or body execution', function (scope) {
        const generator = unexecutedGenerator<number>();
        for (const title of [ '', ' ' ]) {
            scope.assert.throws(function () {
                return property({ title, generator, test: unexpectedPropertyBody });
            }, {
                message: 'Test node title must not be empty.'
            });
        }
        for (const definition of [ null, 'invalid', {}, { title: 'bad', generator, test: null } ]) {
            scope.assert.throws(function () {
                Reflect.apply(property, undefined, [ definition ]);
            }, {
                message: 'property() requires ({ title, generator, test }).'
            });
        }
        for (
            const invalidGenerator of [ null, {}, function () {
                return 1;
            }, {
                ...generator,
                [Symbol.for('@overkill-dev/property/Generator')]: false
            }, {
                ...generator,
                map: null
            } ]
        ) {
            scope.assert.throws(function () {
                Reflect.apply(property, undefined, [ {
                    title: 'bad generator',
                    generator: invalidGenerator,
                    test: unexpectedPropertyBody
                } ]);
            }, { message: 'Property requires an Overkill generator.' });
        }
        scope.assert.throws(function () {
            Reflect.apply(withProperties, undefined, [ null ]);
        }, {
            message: 'withProperties() requires a body function.'
        });
        return scope.assert.collect();
    }),
    test('property macros retain application and definition locations', function (scope) {
        const macro = defineMacro(function () {
            return property({
                title: 'macro property',
                generator: unexecutedGenerator<number>(),
                test: unexpectedPropertyBody
            });
        });
        const node = macro();
        planFor(node);
        scope.assert.equal(node.definitionLocations.length, 2);
        for (const location of node.definitionLocations) {
            const resolved = resolveSourceLocation(location);
            scope.assert.equal(resolved.kind, 'known');
            if (resolved.kind === 'known') {
                scope.assert.match(resolved.file, /property-authoring\.test\.(?:ts|js)$/);
            }
        }
        return scope.assert.collect();
    }),
    test('existing profiles reject property declarations during collection', function (scope) {
        const plan = planFor(property({
            title: 'property profile required',
            generator: unexecutedGenerator<number>(),
            test: unexpectedPropertyBody
        }));
        for (const family of [ 'microtest', 'integration', 'benchmark' ] as const) {
            scope.assert.throws(function () {
                assertTestPlanMatchesTestFamily(plan, family);
            }, {
                message: `Run profile "${family}" cannot run test case authored for "property".`
            });
        }
        const nested = test('wrapped', withProperties(unexpectedPropertyBody));
        scope.assert.throws(function () {
            stampTestNodeFamily(nested, 'microtest');
        }, {
            message: 'Test node already belongs to test family "property".'
        });
        return scope.assert.collect();
    }),
    test('direct engine execution reports unavailable property execution', async function (scope: TestScope) {
        const plan = planFor(property({
            title: 'not executable yet',
            generator: unexecutedGenerator<number>(),
            test: unexpectedPropertyBody
        }));
        const result = await createTestEngine().execute(plan);
        scope.require.defined(result.perTest);
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.equal(result.summary.passed, 0);
        scope.assert.equal(result.perTest[0]?.outcome?.kind, 'fail');
        scope.assert.includes(JSON.stringify(result.perTest[0]?.outcome), 'Property execution is not available.');
        scope.assert.equal(result.runnerErrors.length, 0);
        return scope.assert.collect();
    }),
    test('direct invocation of nested envelopes rejects execution', async function (scope: TestScope) {
        await scope.assert.rejects(async function () {
            return withProperties(unexpectedPropertyBody)(scope);
        }, {
            message: 'Property execution is not available. Property policy and generator execution are required.'
        });
        return scope.assert.collect();
    })
]);

const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
