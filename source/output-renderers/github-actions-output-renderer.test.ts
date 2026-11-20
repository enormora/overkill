import { type TestNode, suite, test } from '@overkill-dev/test';

import type { OutputLineIntent, OutputRenderer } from '../engine/reporter-output.ts';
import { createReportingContext } from '../engine/reporting-context.ts';
import { createGithubActionsOutputRenderer } from './github-actions-output-renderer.ts';

const diagnosticIntent: OutputLineIntent = {
    annotation: {
        location: { column: 5, file: 'source/users-test.ts', kind: 'known' as const, line: 10 },
        severity: 'error',
        title: 'users: creates profile'
    },
    kind: 'stdout-line',
    role: 'primary',
    text: 'expected 100%, actual false'
};

function createRenderer(): OutputRenderer {
    return createGithubActionsOutputRenderer()(createReportingContext({ projectRoot: null }));
}

export const testNode: TestNode = suite('GitHub Actions output renderer', [
    test(
        'renders located diagnostics as workflow commands',
        function (scope) {
            const renderer = createRenderer();
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
    ),
    test('passes unlocated output through', function (scope) {
        const renderer = createRenderer();

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
    }),
    test('handles optional annotation properties', function (scope) {
        const renderer = createRenderer();

        scope.assert.equal(
            renderer.render({
                annotation: {
                    location: { column: null, file: 'source/users-test.ts', kind: 'known' as const, line: 10 },
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
                    location: { column: 5, file: 'source/users-test.ts', kind: 'known' as const, line: null },
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
    })
]);
