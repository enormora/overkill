import { table, suite, test } from '@overkill-dev/test';

import { observationCase } from '../test-support/observation-lifetime.ts';

import { createTestEngine } from '../test-support/create-test-engine.ts';
import { referencedTestBody } from '../test-support/referenced-test-body.ts';
import { testBodyExecutionError } from './case-policy.ts';
import { attachTestBodyOrigin, attachTestBodyFamily, propertyExecutionForDefinition } from './test-body.ts';
import { defaultPropertyPolicy } from './property-policy.ts';
import { stampTestNodeFamily } from './test-node.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
function unexecutedBody(): never {
    throw new Error('Collection must not execute bodies.');
}
export const testNode = suite('test plan admission and deferred bodies', [
    test('reports duplicate sibling titles at the root boundary', function (scope) {
        const engine = createTestEngine();
        const children = [ 'duplicate', 'duplicate' ].map(function node(title) {
            return engine.createTestCase({ ...metadata, title, body: unexecutedBody });
        });
        scope.assert.throws(function () {
            engine.createTestPlan(engine.createRoot({ title: 'root', annotations: {}, controls: {}, children }));
        }, { message: 'Duplicate test node title under root: duplicate.' });
        return scope.assert.collect();
    }),
    table({
        title: 'recovers callable origins when node metadata is absent',
        cases: [ false, true ],
        caseTitle: String,
        test(scope) {
            const wrapped = scope.parameters;

            const engine = createTestEngine();
            function body(): never {
                throw new Error('Collection must not execute bodies.');
            }
            const location = { kind: 'known', file: 'case.ts', line: 22, column: 3 } as const;
            const callable = wrapped ? attachTestBodyOrigin(body, { body, location }) : body;
            const node = engine.createTestCase({
                ...metadata,
                definitionLocations: [ location ],
                title: 'case',
                body: callable
            });
            const plan = engine.createTestPlan(
                engine.createRoot({
                    title: 'root',
                    annotations: {},
                    controls: {},
                    children: [ { ...node, bodyOrigin: null } ]
                })
            );
            scope.assert.equal(plan.cases[0].bodyOrigin?.body, body);
            scope.assert.deepEqual<unknown, unknown>({ location: plan.cases[0].bodyOrigin?.location }, {
                location
            });
            return scope.assert.collect();
        }
    }),

    test('keeps skipped cases outside body admission checks', function (scope) {
        scope.assert.equal(
            testBodyExecutionError({ ...observationCase(), execution: { kind: 'skip', reason: 'intentional' } }),
            null
        );
        return scope.assert.collect();
    }),
    test('requires collected declarations for bodies carrying property metadata', function (scope) {
        const body = attachTestBodyFamily(function uncollectedBody(): never {
            throw new Error('Admission must not execute the body.');
        }, {
            family: 'property',
            definition: { kind: 'nested', settingsDeclarations: [ { kind: 'profile-default' } ] }
        });
        const testCase = {
            ...observationCase(),
            execution: { kind: 'body' as const, bodyMode: 'builder' as const, body }
        };
        scope.assert.equal(
            testBodyExecutionError(testCase)?.message,
            'Property execution requires a collected property declaration.'
        );
        return scope.assert.collect();
    }),
    table({
        title: 'requires resolved family declarations for resource descriptors',
        cases: [ 'property', 'integration' ] as const,
        caseTitle(testFamily) {
            return testFamily;
        },
        test(scope) {
            const testFamily = scope.parameters;

            const original = observationCase();
            const execution = {
                ...propertyExecutionForDefinition(unexecutedBody, {
                    kind: 'nested',
                    settingsDeclarations: [ { kind: 'profile-default' } ]
                }),
                policy: { kind: 'resolved' as const, policy: defaultPropertyPolicy }
            };
            const resource = {
                name: 'owner',
                scope: 'per-case',
                dependencies: [],
                requirements: [],
                scenarios: [],
                handleTransport: 'local' as const,
                workload: 'independent' as const
            };
            const testCase = {
                ...original,
                testFamily,
                execution,
                resourceAttachments: { ...original.resourceAttachments, resourceGraph: [ resource ] }
            };
            const error = testBodyExecutionError(testCase);
            scope.assert.deepEqual({ message: error?.message ?? null }, {
                message: testFamily === 'property' ? 'Property execution cannot use resource descriptors.' : null
            });
            return scope.assert.collect();
        }
    }),

    test('rejects empty file collections supplied through JavaScript', function (scope) {
        const engine = createTestEngine();
        scope.assert.throws(function () {
            Reflect.apply(engine.createTestPlanFromTestFiles, undefined, [ {
                files: [],
                root: { title: 'root', annotations: {}, controls: {} }
            } ]);
        }, { message: 'Test plan must contain at least one executable test case.' });
        return scope.assert.collect();
    }),
    test('rejects duplicate case identities across repeated files', function (scope) {
        const engine = createTestEngine();
        scope.assert.throws(function () {
            engine.createTestPlanFromTestFiles({
                root: { title: 'root', annotations: {}, controls: {} },
                files: [ {
                    file: 'case.ts',
                    testNode: engine.createTestCase({ ...metadata, title: 'case', body: unexecutedBody })
                }, {
                    file: 'case.ts',
                    testNode: engine.createTestCase({ ...metadata, title: 'case', body: unexecutedBody })
                } ]
            });
        }, { message: /^Duplicate test case identity:/u });
        return scope.assert.collect();
    }),
    test(
        'keeps referenced table bodies deferred without assigning callable origins',
        function (scope) {
            const engine = createTestEngine();
            const { body } = referencedTestBody();
            const subjectTable = engine.createTable({
                ...metadata,
                title: 'table',
                cases: [ 'first', 'second' ].map(function (title) {
                    return { title, parameters: { title }, annotations: {}, controls: {}, body };
                })
            });
            const plan = engine.createTestPlan(
                engine.createRoot({ title: 'root', annotations: {}, controls: {}, children: [ subjectTable ] })
            );
            scope.assert.deepEqual(
                plan.cases.map(function (entry) {
                    return {
                        origin: entry.bodyOrigin,
                        deferred: entry.execution.kind === 'body' && entry.execution.body === body
                    };
                }),
                [ { origin: null, deferred: true }, { origin: null, deferred: true } ]
            );
            return scope.assert.collect();
        }
    ),
    test('propagates suite family ownership to its descendants', function (scope) {
        const engine = createTestEngine();
        const child = engine.createTestCase({ ...metadata, title: 'case', body: unexecutedBody });
        const nested = engine.createSuite({ ...metadata, title: 'nested', children: [ child ] });
        stampTestNodeFamily(nested, 'integration');
        const plan = engine.createTestPlan(
            engine.createRoot({ title: 'root', annotations: {}, controls: {}, children: [ nested ] })
        );
        scope.assert.equal(plan.cases[0].testFamily, 'integration');
        scope.assert.throws(function () {
            stampTestNodeFamily(child, 'microtest');
        }, { message: 'Test node already belongs to test family "integration".' });
        return scope.assert.collect();
    })
]);
