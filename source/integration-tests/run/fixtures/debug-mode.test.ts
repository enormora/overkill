import { suite, test } from '../../../packages/test/test.entry-point.ts';
export const testNode = suite('debug fixture', [
    test('recording', async (scope) => {
        const events: unknown[] = [ { kind: 'http.request', at: 5n } ];
        scope.debug.includeRecording({
            name: 'http',
            recorded() {
                return events;
            }
        });
        scope.cleanup(function retainCleanup() {
            events.push({ kind: 'cleanup' });
        });
        const specifier: string = 'data:text/javascript,export const value=42';
        const loaded: unknown = await import(specifier);
        const value: unknown = typeof loaded === 'object' && loaded !== null ? Reflect.get(loaded, 'value') : null;
        scope.assert.equal(value, 42);
        return scope.assert.collect();
    }),
    test('plain', (scope) => {
        scope.assert.equal(2, 2);
        return scope.assert.collect();
    })
]);
