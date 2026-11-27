import { defineConfig } from './tools/type-tests/authoring.entry-point.ts';
import { family as typeTestFamily } from './tools/type-tests/relations.entry-point.ts';

export const config = defineConfig({
    runtimeStateDir: 'target/overkill-type-tests',
    profiles: {
        types: {
            testFamily: typeTestFamily,
            execution: { processModel: 'supervised-process', scheduling: 'serial', maxConcurrency: 1 },
            timeouts: { collectionMilliseconds: 240_000, softMilliseconds: 480_000, hardMilliseconds: 730_000 },
            files: { include: [ 'source/**/*.type-test.ts' ] },
            settings: {
                projectConfigPath: './source/tsconfig.type-tests.json',
                compiler: { kind: 'package', specifier: 'typescript-beta', version: '7.1.0-beta' }
            }
        }
    }
});
