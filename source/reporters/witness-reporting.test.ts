import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { createReportingContext } from '../engine/reporting-context.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { createBriefReporter } from './brief-reporter.ts';

export const testNode = suite('witness reporting', [
    test('brief reporter prints replay commands for complete witness artifacts', async function (scope: TestScope) {
        const reporter = createBriefReporter()(createReportingContext({ projectRoot: null }));
        scope.require.notNull(reporter.onFinish);
        const result = runResultFactory.build({
            artifacts: [ {
                id: {
                    attempt: null,
                    runtimes: [],
                    sequence: 0,
                    subtype: 'witness',
                    workload: null,
                    scope: { kind: 'run' }
                },
                source: 'native',
                payload: {
                    kind: 'runtime-attachment',
                    name: 'property-witness',
                    mediaType: 'application/json',
                    producer: { kind: 'case' },
                    capturedAtMicroseconds: 0,
                    capture: 'opt-in',
                    content: {
                        kind: 'file',
                        path: 'witnesses/input.json',
                        byteLength: 42,
                        completion: { kind: 'complete' }
                    }
                }
            } ]
        });
        const output = await reporter.onFinish(result);
        scope.assert.includes(JSON.stringify(output), "Replay: overkill replay-witness 'witnesses/input.json'");
        return scope.assert.collect();
    })
]);

await runIfMain(import.meta, testNode);
