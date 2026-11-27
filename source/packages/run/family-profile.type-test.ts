import { suite, test } from '../../../tools/type-tests/authoring.entry-point.ts';
import { acceptsCall, rejectsCall, sameType } from '../../../tools/type-tests/relations.entry-point.ts';
import { z } from 'zod/v4';
import { defineTestFamily } from '../engine/engine.entry-point.ts';
import { isEqualTo } from '../../test-support/type-relations.ts';
import { orchestrator, type ConfiguredRunCommand } from './run.entry-point.ts';
import { defineConfig, type FamilySettingsOf } from './config.entry-point.ts';

const numericSettings = z.strictObject({ iterations: z.number() });
const numeric = defineTestFamily({
    id: '@example/numeric',
    version: '1',
    module: null,
    features: { execution: 'runtime', processModels: [ 'in-process' ], profileOptions: [] },
    parseSettings(input) {
        return numericSettings.parse(input);
    },
    async load() {
        throw new Error('Type test must not load a backend.');
    }
});
const textual = defineTestFamily({
    id: '@example/textual',
    version: '1',
    module: null,
    features: { execution: 'analysis', processModels: [ 'in-process' ], profileOptions: [] },
    parseSettings(input) {
        return z.strictObject({ project: z.string() }).parse(input);
    },
    async load() {
        throw new Error('Type test must not load a backend.');
    }
});
const files = { include: [ 'source/**/*.test.ts' ] } as const;

declare const configuredCommand: ConfiguredRunCommand;

declare const defineConfigUnderTest: typeof defineConfig;

export const testNode = suite('family profile', [
    suite('family profile settings', [
        test('infers heterogeneous definitions independently', function (typeScope) {
            const config = defineConfig({
                profiles: {
                    numbers: { testFamily: numeric, settings: { iterations: 3 }, files },
                    text: { testFamily: textual, settings: { project: './tsconfig.json' }, files },
                    unit: { testFamily: 'microtest' }
                }
            });
            typeScope.assert(
                sameType.withActual<true>(),
                isEqualTo<typeof numeric>()(config.profiles.numbers.testFamily)
            );
            typeScope.assert(sameType.withActual<true>(), isEqualTo<typeof textual>()(config.profiles.text.testFamily));
            typeScope.assert(sameType<FamilySettingsOf<typeof numeric>, z.output<typeof numericSettings>>());
            return typeScope.assert.collect();
        }),
        test('rejects swapped settings and optional family strings', function (typeScope) {
            typeScope.assert(rejectsCall('no-matching-overload'), () =>
                defineConfigUnderTest({
                    profiles: {
                        numbers: { testFamily: numeric, settings: { project: './tsconfig.json' }, files }
                    }
                }));
            typeScope.assert(rejectsCall('no-matching-overload'), () =>
                defineConfigUnderTest({
                    profiles: {
                        text: { testFamily: textual, settings: {}, files }
                    }
                }));
            typeScope.assert(rejectsCall('no-matching-overload'), () =>
                defineConfigUnderTest({
                    profiles: {
                        text: { testFamily: 'type-test', settings: {}, files }
                    }
                }));
            return typeScope.assert.collect();
        })
    ]),
    test('explicit configuration sources are accepted by ordinary operations', function (typeScope) {
        typeScope.assert(acceptsCall, async () => orchestrator.run(configuredCommand));
        typeScope.assert(acceptsCall, async () => orchestrator.resolve(configuredCommand));
        typeScope.assert(acceptsCall, async () => orchestrator.initialize(configuredCommand));
        return typeScope.assert.collect();
    })
]);
