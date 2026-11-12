import { defineTestFamily, type TestFamily } from './test-family.ts';

export type BuiltinFamilyId = 'benchmark' | 'integration' | 'microtest' | 'property';

const familyOptions = {
    benchmark: [ 'capture', 'resources' ],
    integration: [ 'capture', 'resources', 'retries' ],
    microtest: [ 'coverage' ],
    property: []
} as const;

function runtimeFamily(id: BuiltinFamilyId): TestFamily<null> {
    return defineTestFamily({
        id,
        version: '1',
        module: null,
        features: {
            execution: 'runtime',
            processModels: [ 'in-process', 'supervised-process', 'worker-pool' ],
            profileOptions: familyOptions[id]
        },
        parseSettings(input) {
            if (input !== null) {
                throw new TypeError('Built-in family settings must be null; configure policy at profile level.');
            }
            return null;
        },
        async load() {
            return {
                async prepare(input) {
                    return {
                        testPlan: input.testPlan,
                        facts: null,
                        async collect() {
                            return { kind: 'runtime', facts: null };
                        },
                        async dispose() {
                            return undefined;
                        }
                    };
                }
            };
        }
    });
}

const builtins = {
    benchmark: runtimeFamily('benchmark'),
    integration: runtimeFamily('integration'),
    microtest: runtimeFamily('microtest'),
    property: runtimeFamily('property')
};

export function builtinTestFamily(id: BuiltinFamilyId): TestFamily<null> {
    return builtins[id];
}

export function isBuiltinFamilyId(value: string): value is BuiltinFamilyId {
    return Object.hasOwn(builtins, value);
}
