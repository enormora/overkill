import { testDouble } from '../packages/test/test.entry-point.ts';
import type { DarwinPressureProbe } from '../run/benchmark-host-darwin.ts';
import type { PlatformPressureRuntime } from '../run/benchmark-host-platform.ts';

export const linuxPressureText = 'some avg10=1.2 avg60=2 avg300=3 total=42\nfull avg10=0 avg60=0 avg300=0 total=0';
type DarwinProbeFixture = { readonly probe: DarwinPressureProbe; readonly calls: readonly string[]; };
export function darwinProbe(thermal: Error | string, memory: Error | string): DarwinProbeFixture {
    const calls: string[] = [];
    return {
        calls,
        async probe(executable, args, signal) {
            signal.throwIfAborted();
            calls.push(`${executable} ${args.join(' ')}`);
            const value = executable === '/usr/bin/pmset' ? thermal : memory;
            if (value instanceof Error) {
                throw value;
            }
            return value;
        }
    };
}
type PlatformPressureFixture = { readonly runtime: PlatformPressureRuntime; readonly calls: readonly string[]; };
export function platformPressure(content: string, failure: unknown): PlatformPressureFixture {
    const calls: string[] = [];
    return {
        calls,
        runtime: {
            async read(file, signal) {
                signal.throwIfAborted();
                calls.push(file);
                if (failure !== null) {
                    testDouble.throws<() => void>(failure)();
                }
                return content;
            },
            async darwin(signal) {
                signal.throwIfAborted();
                calls.push('darwin');
                return {
                    pressure: { availability: 'available', source: 'darwin', scope: 'host', unit: 'count', value: 42 }
                };
            }
        }
    };
}
