import { type TestScope, suite as authoredSuite, test } from '@overkill-dev/test';

import { implementationFacts } from '../implementation-reference.ts';
import { testNode as trialErrors } from './trial-policy-errors.test.ts';
import { defineBodyReference, type BodyReference } from './body-reference.ts';
import {
    executableBody,
    attachTestBodyFamily,
    attachTestBodyWorkloadResolver,
    forwardTestBodyResources,
    resolveTestBodyWorkload,
    readTestBodyFamily,
    testBodyLocation
} from './test-body.ts';

function referencedBody(): BodyReference<number, number> {
    return defineBodyReference<null, number, number>({
        module: { moduleUrl: 'file:///project/body.ts', exportName: 'body' },
        realm: 'host',
        version: '1',
        input: null,
        dynamicModules: [],
        parseInput() {
            return null;
        }
    });
}
export const testNode = authoredSuite('body forwarding and source ownership', [
    trialErrors,
    test('requires admission before executing a referenced body', function (scope: TestScope) {
        const reference = referencedBody();
        scope.assert.throws(function () {
            executableBody(reference);
        }, { message: 'Referenced body was not admitted before execution.' });
        return scope.assert.collect();
    }),
    test(
        'preserves family metadata and workload resolution when forwarding referenced resources',
        function (scope: TestScope) {
            const reference = referencedBody();
            const family = attachTestBodyFamily(reference, { family: 'microtest', definition: { value: 42 } });
            const source = attachTestBodyWorkloadResolver(family, function () {
                return family;
            });
            const wrapped = forwardTestBodyResources(source, function (body) {
                return function (value) {
                    return body(value) + 1;
                };
            });
            const resolved = resolveTestBodyWorkload(wrapped, null);
            const context = { projectRoot: '/project' };
            const result = resolved.bind(
                {
                    body: {
                        version: '1',
                        implementation(value: number) {
                            return value * 2;
                        }
                    }
                },
                implementationFacts(reference.reference, context),
                context
            );
            scope.assert.equal(result(20), 41);
            scope.assert.deepEqual<unknown, unknown>({ family: readTestBodyFamily(resolved) }, {
                family: { family: 'microtest', definition: { value: 42 } }
            });
            return scope.assert.collect();
        }
    ),
    test(
        'prefers known body origins over fallbacks and resolves unknown origins through the fallback',
        function (scope: TestScope) {
            const known = { kind: 'known' as const, file: 'case.ts', line: 1, column: 2 };
            const fallback = { kind: 'known' as const, file: 'fallback.ts', line: 3, column: 4 };
            function body(): number {
                return 42;
            }
            scope.assert.deepEqual(testBodyLocation({ body, location: known }, fallback), known);
            scope.assert.deepEqual(testBodyLocation({ body, location: { kind: 'unknown' } }, fallback), fallback);
            scope.assert.deepEqual(testBodyLocation(undefined, fallback), fallback);
            return scope.assert.collect();
        }
    )
]);
