import { createLineReporter as createOverkillLineReporter } from '../packages/reporter-line/reporter-line.entry-point.ts';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import type { OutputLineIntent } from '../engine/reporter-output.ts';
import { createGithubActionsOutputRenderer } from './github-actions-output-renderer.ts';

const diagnosticIntent: OutputLineIntent = {
    annotation: {
        location: { column: 5, file: 'source/users-test.ts', line: 10 },
        severity: 'error',
        title: 'users: creates profile'
    },
    kind: 'stdout-line',
    role: 'primary',
    text: 'expected 100%, actual false'
};

export const testSuite = createOverkillSuite({
    title: 'source/output-renderers/github-actions-output-renderer.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            title: 'GitHub Actions output renderer renders located diagnostics as workflow commands',
            metadata: {},
            body(scope: OverkillScope) {
                const renderer = createGithubActionsOutputRenderer();
                const renderedDiagnostic = [
                    '::error file=source/users-test.ts,line=10,col=5,title=users%3A creates profile::',
                    'expected 100%25, actual false'
                ]
                    .join('');

                scope.assert.equal(
                    renderer.render(diagnosticIntent),
                    renderedDiagnostic
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'GitHub Actions output renderer passes unlocated output through',
            metadata: {},
            body(scope: OverkillScope) {
                const renderer = createGithubActionsOutputRenderer();

                scope.assert.equal(
                    renderer.render({
                        annotation: null,
                        kind: 'stdout-line',
                        role: 'primary',
                        text: 'done planned=1'
                    }),
                    'done planned=1'
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'GitHub Actions output renderer handles optional annotation properties',
            metadata: {},
            body(scope: OverkillScope) {
                const renderer = createGithubActionsOutputRenderer();

                scope.assert.equal(
                    renderer.render({
                        annotation: {
                            location: { column: null, file: 'source/users-test.ts', line: 10 },
                            severity: 'warning',
                            title: null
                        },
                        kind: 'stdout-line',
                        role: 'primary',
                        text: 'expected value'
                    }),
                    '::warning file=source/users-test.ts,line=10::expected value'
                );
                scope.assert.equal(
                    renderer.render({
                        annotation: {
                            location: { column: 5, file: 'source/users-test.ts', line: null },
                            severity: 'error',
                            title: 'users'
                        },
                        kind: 'stdout-line',
                        role: 'primary',
                        text: 'expected value'
                    }),
                    'expected value'
                );

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
