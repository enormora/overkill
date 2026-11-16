import assert from 'node:assert/strict';
import type { Linter } from 'eslint';
import { z } from 'zod';
import type { ConfigCatalogRule, ConfigInventory, ConfigRuleCatalog } from './config-definition.ts';
import { normalizedRule } from './config-expectations.ts';

export function catalogRules(catalog: ConfigRuleCatalog): readonly ConfigCatalogRule[] {
    if (catalog.kind === 'rules') {
        return catalog.rules;
    }
    return Object.entries(catalog.rules).map(function rule([ name, value ]) {
        const parsed = z.object({ meta: z.object({ deprecated: z.unknown().optional() }).optional() }).parse(value);
        return { ruleId: `${catalog.namespace}/${name}`, deprecated: Boolean(parsed.meta?.deprecated) };
    });
}

export function declaredRules(configs: readonly Linter.Config[]): NonNullable<Linter.Config['rules']> {
    return configs.reduce<NonNullable<Linter.Config['rules']>>(function rules(result, config) {
        return { ...result, ...config.rules };
    }, {});
}

export function checkInventory(rules: Readonly<Record<string, unknown>>, inventory: ConfigInventory<string>): void {
    const catalog = catalogRules(inventory.catalog);
    const excluded = new Set(inventory.exclusions.map(function name(entry) {
        return entry.ruleId;
    }));
    const names = new Set(catalog.map(function name(entry) {
        return entry.ruleId;
    }));
    assert.ok(names.size > 0, 'Rule inventory must not be empty.');
    const namespaces = new Set(catalog.map(function namespace(entry) {
        return entry.ruleId.slice(0, entry.ruleId.lastIndexOf('/') + 1);
    }));
    const unknown = Object.keys(rules).filter(function unknownRule(name) {
        return namespaces.has(name.slice(0, name.lastIndexOf('/') + 1)) && !names.has(name);
    });
    const missing = catalog.filter(function missingRule(entry) {
        return !entry.deprecated && !excluded.has(entry.ruleId) && !Object.hasOwn(rules, entry.ruleId);
    });
    const deprecated = catalog.filter(function deprecatedRule(entry) {
        if (!entry.deprecated || excluded.has(entry.ruleId) || !Object.hasOwn(rules, entry.ruleId)) {
            return false;
        }
        const configured = rules[entry.ruleId];
        if (inventory.deprecated === 'allow') {
            return false;
        }
        return inventory.deprecated === 'absent' || normalizedRule(configured)[0] !== 0;
    });
    assert.deepEqual(
        {
            missing: inventory.completeness === 'all'
                ? missing.map(function name(entry) {
                    return entry.ruleId;
                })
                : [],
            unknown,
            deprecated: deprecated.map(function name(entry) {
                return entry.ruleId;
            })
        },
        { missing: [], unknown: [], deprecated: [] },
        'Rule inventory differs.'
    );
}
