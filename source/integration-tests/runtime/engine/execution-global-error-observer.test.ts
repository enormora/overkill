import { extname } from 'node:path';
import { suite, test } from '@overkill-dev/test';
import { sourceErrorObserverProbe } from '../../../test-support/source-error-observer-probe.ts';
import {
    globalErrorObserverTestNode,
    testCaseMetadata,
    runObserverScript
} from '../support/execution-global-error-observer-cases.ts';

export const testNode = suite({
    ...testCaseMetadata,
    title: globalErrorObserverTestNode.title,
    children: [ test({
        ...testCaseMetadata,
        title: 'isolates source process hooks from the published runner',
        async body(scope) {
            const cases = new URL(
                `../support/execution-global-error-observer-cases${extname(import.meta.url)}`,
                import.meta.url
            );
            const output = await runObserverScript(sourceErrorObserverProbe(cases.href));
            scope.assert.equal(output.code, 0);
            scope.assert.equal(output.stderr, '');
            scope.assert.equal(output.stdout, '');
            return scope.assert.collect();
        }
    }) ]
});
