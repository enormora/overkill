import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { createReportingContext, createRunReportingContext } from './reporting-context.ts';
import { currentFailureArtifactPolicy, withFailureArtifactContext } from './execution-observation.ts';

const location = { kind: 'known', file: '/project/case.ts', line: 1, column: 1 } as const;
export const testNode = suite('reporting context policy ownership', [
    test(
        'reads the current failure policy when the context has no explicit profile policy',
        function (scope: TestScope) {
            const context = createReportingContext({ projectRoot: null });
            const previous = currentFailureArtifactPolicy();
            const policy = { ...previous, capturedOutputBytes: 42 };
            withFailureArtifactContext(policy, function () {
                scope.assert.equal(context.failureArtifacts, policy);
            }, null);
            scope.assert.equal(context.failureArtifacts, previous);
            return scope.assert.collect();
        }
    ),
    ...[
        null,
        42,
        [],
        { environment: null },
        { environment: { projectRoot: 42 } },
        { environment: { projectRoot: '' } },
        { environment: { projectRoot: ' ' } },
        { execution: null },
        { execution: {} }
    ]
        .map(function (facts, index) {
            return test(`uses safe defaults for incomplete run facts ${index}`, function (scope: TestScope) {
                const reporting = createRunReportingContext();
                reporting.observeFacts(facts);
                scope.assert.equal(
                    reporting.context.failureArtifacts?.capturedOutputBytes,
                    currentFailureArtifactPolicy().capturedOutputBytes
                );
                scope.assert.equal(reporting.context.relativizeLocationPath(location), '/project/case.ts');
                return scope.assert.collect();
            });
        }),
    test('replaces root and rendering policy when new run facts arrive', function (scope: TestScope) {
        const reporting = createRunReportingContext();
        const policy = { ...currentFailureArtifactPolicy(), capturedOutputBytes: 42 };
        reporting.observeFacts({ environment: { projectRoot: '/project' }, execution: { failureArtifacts: policy } });
        scope.assert.deepEqual<unknown, unknown>(reporting.context.failureArtifacts, policy);
        scope.assert.equal(reporting.context.relativizeLocationPath(location), 'case.ts');
        reporting.observeFacts(null);
        scope.assert.equal(
            reporting.context.failureArtifacts?.capturedOutputBytes,
            currentFailureArtifactPolicy().capturedOutputBytes
        );
        scope.assert.equal(reporting.context.relativizeLocationPath(location), '/project/case.ts');
        return scope.assert.collect();
    }),
    test('rejects malformed explicit failure policies', function (scope: TestScope) {
        const reporting = createRunReportingContext();
        scope.assert.throws(function () {
            reporting.observeFacts({ environment: { projectRoot: '/project' }, execution: { failureArtifacts: null } });
        }, { name: 'ZodError' });
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
