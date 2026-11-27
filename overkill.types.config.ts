import { defineConfig } from '@overkill-dev/test-type-authoring/config';
import { family as typeTestFamily } from '@overkill-dev/type-test';

export const config = defineConfig({
    runtimeStateDir: 'target/overkill',
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
