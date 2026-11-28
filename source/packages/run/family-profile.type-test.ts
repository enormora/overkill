import { z } from 'zod/v4';
import type { IsEqual } from 'type-fest';
import { suite, test } from '../test/test.entry-point.ts';
import { acceptsCall, rejectsCall, sameType } from '../type-test/type-test.entry-point.ts';
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

export const testNode = suite('Test family registration and profile settings', [
    suite('family profile settings', [
        test('infers heterogeneous definitions independently', function (scope) {
            const config = defineConfig({
                profiles: {
                    numbers: { testFamily: numeric, settings: { iterations: 3 }, files },
                    text: { testFamily: textual, settings: { project: './tsconfig.json' }, files },
                    unit: { testFamily: 'microtest' }
                }
            });
            scope.assert(
                sameType.withActual<true>(),
                isEqualTo<typeof numeric>()(config.profiles.numbers.testFamily)
            );
            scope.assert(sameType.withActual<true>(), isEqualTo<typeof textual>()(config.profiles.text.testFamily));
            scope.assert(
                sameType<IsEqual<FamilySettingsOf<typeof numeric>, z.output<typeof numericSettings>>, true>()
            );
            return scope.assert.collect();
        }),
        test('rejects swapped settings and optional family strings', function (scope) {
            scope.assert(rejectsCall('no-matching-overload'), function () {
                return defineConfigUnderTest({
                    profiles: {
                        numbers: { testFamily: numeric, settings: { project: './tsconfig.json' }, files }
                    }
                });
            });
            scope.assert(rejectsCall('no-matching-overload'), function () {
                return defineConfigUnderTest({
                    profiles: {
                        text: { testFamily: textual, settings: {}, files }
                    }
                });
            });
            scope.assert(rejectsCall('no-matching-overload'), function () {
                return defineConfigUnderTest({
                    profiles: {
                        text: { testFamily: 'type-test', settings: {}, files }
                    }
                });
            });
            return scope.assert.collect();
        })
    ]),
    test('explicit configuration sources are accepted by ordinary operations', function (scope) {
        scope.assert(acceptsCall, async function () {
            return orchestrator.run(configuredCommand);
        });
        scope.assert(acceptsCall, async function () {
            return orchestrator.resolve(configuredCommand);
        });
        scope.assert(acceptsCall, async function () {
            return orchestrator.initialize(configuredCommand);
        });
        return scope.assert.collect();
    })
]);
