import { runIfMain } from '#test-runner';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { testNode as policy } from './reporting-policy-context.test.ts';
import {
    createReportingContext,
    createRunReportingContext,
    formatAssertionSourceLocations,
    formatSourceLocation,
    relativizeSourceLocationPath
} from './reporting-context.ts';

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/engine/reporting-context.test.ts',
    annotations: {},
    controls: {},
    children: [
        policy,
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'run reports accept absent and partial preparation facts',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
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
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'relativizeSourceLocationPath() renders files below project root as relative paths',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
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
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'relativizeSourceLocationPath() renders Windows files below project root as relative paths',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
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
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'formatSourceLocation() updates when the reporting context project root changes',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
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
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'formatSourceLocation() hides unknown source locations',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const context = createReportingContext({ projectRoot: '/repo' });

                scope.assert.equal(formatSourceLocation({ kind: 'unknown' }, context), null);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'formatAssertionSourceLocations() renders forwarded assertion locations with shared paths',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
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
        })
    ]
});

await runIfMain(import.meta, testNode);
