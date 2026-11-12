import { describe, expect, test } from 'tstyche';
import { z } from 'zod/v4';
import { defineTestFamily } from '../engine/engine.entry-point.ts';
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

describe('family profile settings', function () {
    test('infers heterogeneous definitions independently', function () {
        const config = defineConfig({
            profiles: {
                numbers: { testFamily: numeric, settings: { iterations: 3 }, files },
                text: { testFamily: textual, settings: { project: './tsconfig.json' }, files },
                unit: { testFamily: 'microtest' }
            }
        });
        expect(config.profiles.numbers.testFamily).type.toBe<typeof numeric>();
        expect(config.profiles.text.testFamily).type.toBe<typeof textual>();
        expect<FamilySettingsOf<typeof numeric>>().type.toBe<z.output<typeof numericSettings>>();
    });
    test('rejects swapped settings and optional family strings', function () {
        expect<typeof defineConfig>().type.not.toBeCallableWith({
            profiles: {
                numbers: { testFamily: numeric, settings: { project: './tsconfig.json' }, files }
            }
        });
        expect<typeof defineConfig>().type.not.toBeCallableWith({
            profiles: {
                text: { testFamily: textual, settings: {}, files }
            }
        });
        expect<typeof defineConfig>().type.not.toBeCallableWith({
            profiles: {
                text: { testFamily: 'type-test', settings: {}, files }
            }
        });
    });
});
