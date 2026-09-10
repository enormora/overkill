import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import {
    createReportingContext,
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

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
