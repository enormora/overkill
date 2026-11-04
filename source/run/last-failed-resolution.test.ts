import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { lastFailedRunFixture } from '../test-support/last-failed-run-fixture.ts';
import { historyWork } from '../test-support/history-record-fixture.ts';
import { readResolvedRunInput } from './run-input-resolution.ts';
import { freezeRunPolicy } from './freeze-run-policy.ts';
import { parseRunSelection } from './run-selection-schema.ts';

export const testNode = suite('last-failed resolution', [
    test('ordinary requests never access history storage', async function (scope: TestScope) {
        const fixture = lastFailedRunFixture(false);
        const resolved = await readResolvedRunInput(fixture.invocation, {
            ...fixture.dependencies,
            createHistoryStorage() {
                throw new Error('Ordinary resolution must not access history.');
            }
        }, { kind: 'configured-files' });
        scope.assert.deepEqual(resolved.request.selection, { kind: 'all' });
        return scope.assert.collect();
    }),
    test('failed identities resolve without mutating the supplied request', async function (scope: TestScope) {
        const fixture = lastFailedRunFixture(true);
        await fixture.recordOutcome('fail');
        const resolved = await readResolvedRunInput(fixture.invocation, fixture.dependencies, {
            kind: 'configured-files'
        });
        scope.assert.deepEqual(resolved.request.selection, {
            kind: 'filter',
            filter: { kind: 'any', filters: [ { kind: 'case-id', id: historyWork.case } ] }
        });
        scope.assert.equal(resolved.request.lastFailed, true);
        scope.assert.equal(fixture.invocation.command.request.selection.kind, 'all');
        return scope.assert.collect();
    }),
    test('history without failures resolves to a transportable empty selection', async function (scope: TestScope) {
        const fixture = lastFailedRunFixture(true);
        await fixture.recordOutcome('pass');
        const resolved = await readResolvedRunInput(fixture.invocation, fixture.dependencies, {
            kind: 'configured-files'
        });
        const serializedSelection = JSON.stringify(resolved.request.selection);
        const selection = parseRunSelection(JSON.parse(serializedSelection));
        scope.assert.deepEqual(selection, { kind: 'none' });
        return scope.assert.collect();
    }),
    ...([ null, '{' ] as const).map(function unavailableHistory(content) {
        return test(
            `unavailable history ${String(content)} requires explicit repair`,
            async function (scope: TestScope) {
                const fixture = lastFailedRunFixture(true);
                if (content !== null) {
                    await fixture.writeIndex(content);
                }
                await scope.assert.rejects(async function resolveUnavailableHistory() {
                    await readResolvedRunInput(fixture.invocation, fixture.dependencies, { kind: 'configured-files' });
                }, { message: /overkill history compact/ });
                return scope.assert.collect();
            }
        );
    }),
    test(
        'frozen policies retain failed identities without rediscovery or history reads',
        async function (scope: TestScope) {
            const fixture = lastFailedRunFixture(true);
            await fixture.recordOutcome('fail');
            const policy = await freezeRunPolicy({
                command: fixture.invocation.command,
                moduleBoundary: null,
                source: { kind: 'memory' }
            }, fixture.dependencies);
            const command = {
                ...fixture.invocation.command,
                request: { ...fixture.invocation.command.request, selection: policy.request.selection }
            };
            const resolved = await readResolvedRunInput({ ...fixture.invocation, command }, {
                ...fixture.dependencies,
                createHistoryStorage() {
                    throw new Error('Frozen selection must not access history.');
                },
                async discoverRunFilesWithProjectRoot() {
                    throw new Error('Frozen selection must not rediscover files.');
                }
            }, { kind: 'frozen-policy', policy });
            scope.assert.deepEqual(resolved.request.selection, policy.request.selection);
            return scope.assert.collect();
        }
    )
]);

await runIfMain(import.meta, testNode);
