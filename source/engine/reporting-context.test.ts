import { type TestNode, suite, test } from '@overkill-dev/test';

import { runResultFactory } from '../test-support/run-result-factory.ts';

import {
    createReportingContext,
    createRunReportingContext,
    formatAssertionSourceLocations,
    formatSourceLocation,
    relativizeSourceLocationPath
} from './reporting-context.ts';

export const testNode: TestNode = suite('Reporting context', [
    test('run reports accept absent and partial preparation facts', function (scope) {
        const reporting = createRunReportingContext();
        const result = runResultFactory.build();
        reporting.observeFacts(null);
        scope.assert.equal(reporting.report(result).context.facts, null);
        reporting.observeFacts({ environment: { projectRoot: '  ' }, execution: {} });
        scope.assert.deepEqual<unknown, unknown>(reporting.report(result).context.facts, {
            environment: { projectRoot: '  ' },
            execution: {}
        });
        scope.assert.equal(
            formatSourceLocation(
                { kind: 'known', file: '/repo/test.ts', line: 1, column: null },
                reporting.context
            ),
            '/repo/test.ts:1'
        );
        return scope.assert.collect();
    }),
    test(
        'relativizeSourceLocationPath() renders files below project root as relative paths',
        function (scope) {
            scope.assert.equal(
                relativizeSourceLocationPath({
                    column: 5,
                    file: '/repo/source/users.test.ts',
                    kind: 'known',
                    line: 10
                }, '/repo'),
                'source/users.test.ts'
            );

            return scope.assert.collect();
        }
    ),
    test(
        'relativizeSourceLocationPath() renders Windows files below project root as relative paths',
        function (scope) {
            scope.assert.equal(
                relativizeSourceLocationPath({
                    column: 5,
                    file: 'C:\\repo\\source\\users.test.ts',
                    kind: 'known',
                    line: 10
                }, 'C:\\repo'),
                'source/users.test.ts'
            );

            return scope.assert.collect();
        }
    ),
    test(
        'formatSourceLocation() updates when the reporting context project root changes',
        function (scope) {
            let projectRoot: string | null = null;
            const context = createReportingContext({
                get projectRoot() {
                    return projectRoot;
                }
            });
            const location = {
                column: 5,
                file: '/repo/source/users.test.ts',
                kind: 'known' as const,
                line: 10
            };

            scope.assert.equal(formatSourceLocation(location, context), '/repo/source/users.test.ts:10:5');
            projectRoot = '/repo';
            scope.assert.equal(formatSourceLocation(location, context), 'source/users.test.ts:10:5');

            return scope.assert.collect();
        }
    ),
    test('formatSourceLocation() hides unknown source locations', function (scope) {
        const context = createReportingContext({ projectRoot: '/repo' });

        scope.assert.equal(formatSourceLocation({ kind: 'unknown' }, context), null);

        return scope.assert.collect();
    }),
    test(
        'formatAssertionSourceLocations() renders forwarded assertion locations with shared paths',
        function (scope) {
            const context = createReportingContext({ projectRoot: '/repo' });

            scope.assert.deepEqual(
                formatAssertionSourceLocations([
                    { column: null, file: '/repo/source/macro.test.ts', kind: 'known', line: 4 },
                    { column: 8, file: '/repo/source/users.test.ts', kind: 'known', line: 10 }
                ], context),
                {
                    details: [ 'asserted at source/users.test.ts:10:8' ],
                    primary: 'source/macro.test.ts:4'
                }
            );

            return scope.assert.collect();
        }
    )
]);
