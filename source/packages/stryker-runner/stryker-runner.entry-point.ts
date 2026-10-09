import { declareFactoryPlugin, PluginKind } from '@stryker-mutator/api/plugin';
import { createOverkillTestRunner } from './overkill-test-runner.ts';

export const strykerPlugins = [
    declareFactoryPlugin(PluginKind.TestRunner, 'overkill', createOverkillTestRunner)
];
