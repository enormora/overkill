import { table, suite, test } from '@overkill-dev/test';

import { darwinProbe, platformPressure, linuxPressureText } from '../test-support/platform-pressure.ts';
import { collectDarwinHostPressure } from './benchmark-host-darwin.ts';
import { collectHostPlatformPressure } from './benchmark-host-platform.ts';

const thermal = 'CPU_Speed_Limit = 80\nCPU_Scheduler_Limit = 90';
export const testNode = suite('platform pressure collection policy', [
    table({
        title: 'parses Darwin memory pressure codes',
        cases: [ '1', '2', '4' ] as const,
        caseTitle(code) {
            return code;
        },
        async test(scope) {
            const code = scope.parameters;

            const fixture = darwinProbe(thermal, ` ${code}\n`);
            const result = await collectDarwinHostPressure(scope.signal, fixture.probe);
            scope.assert.partialDeepEqual(result, {
                CPU_Speed_Limit: { availability: 'available', value: 80 },
                CPU_Scheduler_Limit: { availability: 'available', value: 90 },
                darwinMemoryPressureCode: { availability: 'available', unit: 'native-code', value: Number(code) }
            });
            scope.assert.deepEqual(fixture.calls, [
                '/usr/bin/pmset -g therm',
                '/usr/sbin/sysctl -n kern.memorystatus_vm_pressure_level'
            ]);
            return scope.assert.collect();
        }
    }),
    table({
        title: 'marks unsupported Darwin memory pressure unavailable',
        cases: [ 'invalid', '0', '3', '8' ] as const,
        caseTitle(code) {
            return code;
        },
        async test(scope) {
            const code = scope.parameters;

            const fixture = darwinProbe(thermal, code);
            const result = await collectDarwinHostPressure(scope.signal, fixture.probe);
            scope.assert.partialDeepEqual(result, {
                CPU_Speed_Limit: { availability: 'available' },
                darwinMemoryPressureCode: { availability: 'unavailable' }
            });
            return scope.assert.collect();
        }
    }),
    test('retains independent probe failures in unavailable readings', async function (scope) {
        const fixture = darwinProbe(new Error('thermal failed'), new Error('memory failed'));
        const result = await collectDarwinHostPressure(scope.signal, fixture.probe);
        scope.assert.partialDeepEqual(result, {
            CPU_Speed_Limit: { availability: 'unavailable', reason: 'thermal failed' },
            CPU_Scheduler_Limit: { availability: 'unavailable', reason: 'thermal failed' },
            darwinMemoryPressureCode: { availability: 'unavailable', reason: 'memory failed' }
        });
        return scope.assert.collect();
    }),
    test('collects and prefixes Linux CPU, memory, and IO readings', async function (scope) {
        const fixture = platformPressure(linuxPressureText, null);
        const result = await collectHostPlatformPressure('linux', scope.signal, fixture.runtime);
        scope.assert.deepEqual(fixture.calls, [ '/proc/pressure/cpu', '/proc/pressure/memory', '/proc/pressure/io' ]);
        scope.assert.partialDeepEqual(result, {
            'linux.cpu.some.avg10': { availability: 'available', value: 1.2 },
            'linux.memory.some.total': { availability: 'available', value: 42, unit: 'microseconds' },
            'linux.io.full.total': { availability: 'available', value: 0 }
        });
        return scope.assert.collect();
    }),
    table({
        title: 'retains Linux probe failures',
        cases: [ new Error('read failed'), 'non-error' ] as const,
        caseTitle: String,
        async test(scope) {
            const failure = scope.parameters;

            const fixture = platformPressure('', failure);
            const result = await collectHostPlatformPressure('linux', scope.signal, fixture.runtime);
            scope.assert.partialDeepEqual(result, {
                'linux.cpu.some.avg10': {
                    availability: 'unavailable',
                    reason: failure instanceof Error
                        ? failure.message
                        : failure
                }
            });
            return scope.assert.collect();
        }
    }),
    test('rejects oversized Linux pressure output', async function (scope) {
        const fixture = platformPressure('x'.repeat(65_537), null);
        const result = await collectHostPlatformPressure('linux', scope.signal, fixture.runtime);
        scope.assert.partialDeepEqual(result, {
            'linux.cpu.some.avg10': { availability: 'unavailable', reason: 'PSI probe exceeded its output limit.' }
        });
        return scope.assert.collect();
    }),
    test(
        'routes Darwin collection and skips probes on unsupported platforms',
        async function (scope) {
            const fixture = platformPressure('', null);
            const darwin = await collectHostPlatformPressure('darwin', scope.signal, fixture.runtime);
            const unsupported = await collectHostPlatformPressure('win32', scope.signal, fixture.runtime);
            scope.assert.partialDeepEqual(darwin, { pressure: { value: 42 } });
            scope.assert.deepEqual(unsupported, {});
            scope.assert.deepEqual(fixture.calls, [ 'darwin' ]);
            return scope.assert.collect();
        }
    )
]);
