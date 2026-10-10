import { declareFactoryPlugin, PluginKind } from '@stryker-mutator/api/plugin';
import { createOverkillTestRunner } from './overkill-test-runner.ts';

export { strykerValidationSchema } from './runner-options.ts';

export const strykerPlugins = [
    declareFactoryPlugin(PluginKind.TestRunner, 'overkill', createOverkillTestRunner)
];
