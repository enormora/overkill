import assert from 'node:assert/strict';
import type { TestScope } from '../packages/engine/engine.entry-point.ts';
import type { ConfigDefinition, ConfigFileCheck, ConfigInventory, ConfigSource } from './config-definition.ts';
import { configLayers, inConfigProject, projectPath } from './config-project.ts';
import { configEngine, resolvedConfig } from './config-execution.ts';
import { checkInventory, declaredRules } from './config-inventory.ts';
import { checkResolvedConfig } from './config-expectations.ts';

export async function inventoryCheck(
    definition: ConfigDefinition<string>,
    source: ConfigSource,
    inventory: ConfigInventory<string>,
    scope: TestScope
): Promise<void> {
    if (inventory.target.kind === 'declared' && typeof source !== 'function') {
        checkInventory(declaredRules(source), inventory);
        return;
    }
    await inConfigProject(definition.project, scope.signal, async function check(context) {
        const configs = await configLayers(source, context);
        if (inventory.target.kind === 'declared') {
            checkInventory(declaredRules(configs), inventory);
        } else {
            const engine = configEngine({ context, configs, materialized: false }, 'lint');
            const config = await resolvedConfig(engine, projectPath(context.root, inventory.target.filename));
            assert.ok(config !== undefined, 'Inventory target is ignored.');
            checkInventory(config.rules, inventory);
        }
    });
}

export async function fileCheck(
    definition: ConfigDefinition<string>,
    source: ConfigSource,
    file: ConfigFileCheck<string>,
    scope: TestScope
): Promise<void> {
    await inConfigProject(definition.project, scope.signal, async function check(context) {
        const configs = await configLayers(source, context);
        const engine = configEngine({ context, configs, materialized: false }, 'lint');
        const filename = projectPath(context.root, file.filename);
        if (file.expect.kind === 'ignored') {
            assert.equal(await engine.isPathIgnored(filename), true, 'Expected an ignored file.');
        } else {
            assert.equal(await engine.isPathIgnored(filename), false, 'Unexpected ignored file.');
            const config = await resolvedConfig(engine, filename);
            assert.ok(config !== undefined);
            checkResolvedConfig(config, file.expect);
        }
    });
}
