import { createDeterministicClock } from '@enormora/clock';
import { z } from 'zod/v4';
import { normalizeConfig } from '../config/config.ts';
import type { ResolvedRunInput } from '../run/run-input-resolution.ts';
import type { RunRecordExecutionDependencies } from '../run/recorded-run.ts';
import { defaultRunRequest } from './run-command-factory.ts';

const recordSnapshot = z.object({
    id: z.string(),
    status: z.enum([ 'started', 'completed', 'interrupted' ]),
    result: z.object({ status: z.enum([ 'passed', 'failed' ]) }).nullable()
});
type RecordSnapshot = Readonly<z.infer<typeof recordSnapshot>>;

type PolicyFixture = {
    readonly input: ResolvedRunInput;
    readonly writes: readonly RecordSnapshot[];
    readonly dependencies: RunRecordExecutionDependencies;
};

export function runRecordPolicyFixture(persist: 'always' | 'on-demand', record: boolean): PolicyFixture {
    const config = normalizeConfig({
        profiles: {
            microtest: {
                testFamily: 'microtest',
                runRecords: { persist }
            }
        }
    });
    const profile = config.profiles.microtest;
    if (profile === undefined) {
        throw new Error('Expected microtest profile.');
    }
    const writes: RecordSnapshot[] = [];
    const input: ResolvedRunInput = {
        benchmarkPurpose: 'compare',
        benchmarkHost: null,
        benchmarkCalibration: null,
        benchmarkNormalization: null,
        config,
        profile,
        engine: { kind: 'default' },
        files: [ { file: 'test.ts', fileSet: null, href: 'file:///project/test.ts', path: '/project/test.ts' } ],
        projectRoot: '/project',
        request: defaultRunRequest({ record })
    };
    return {
        writes,
        input,
        dependencies: {
            node: { arch: 'x64', platform: 'linux', version: '26.9.0' },
            wallClock: createDeterministicClock({ initialUnixEpochMicroseconds: 0n }),
            runtimeStateStore: {
                async read() {
                    return null;
                },
                async write(_path: string, content: string) {
                    writes.push(recordSnapshot.parse(JSON.parse(content)));
                }
            }
        }
    };
}
