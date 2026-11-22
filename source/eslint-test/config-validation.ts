import { z } from 'zod';
import { isGenerator } from '../packages/property/property.entry-point.ts';
import type {
    ConfigContract,
    ConfigDefinition,
    ConfigGeneration,
    ConfigFixture,
    ConfigSelectionSet
} from './config-definition.ts';
import { catalogRules } from './config-inventory.ts';
import { projectPath, validateProject } from './config-project.ts';

type NamedConfigCase = { readonly title: string; readonly configs: ConfigSelectionSet<string>; };
function uniqueNames(names: readonly string[], message: string): void {
    const unique = new Set(names);
    if (names.length === 0 || unique.size !== names.length) {
        throw new TypeError(message);
    }
}

export function configNames(names: readonly string[], selection: ConfigSelectionSet<string>): readonly string[] {
    const selected = selection === 'all' ? names : selection;
    uniqueNames(selected, 'Select unique known configuration names.');
    if (
        selected.some(function unknown(name) {
            return !names.includes(name);
        })
    ) {
        throw new TypeError('Select unique known configuration names.');
    }
    return selected;
}

export function generationContracts(generation: ConfigGeneration<string>): readonly ConfigContract[] {
    if (Object.hasOwn(generation, 'contracts')) {
        return z
            .object({
                contracts: z.array(z.discriminatedUnion('kind', [
                    z.object({ kind: z.enum([ 'crash-freedom', 'fix-syntax', 'suggestion-syntax', 'repeatability' ]) }),
                    z.object({ kind: z.literal('fix-stability'), maxRounds: z.number().int().positive() })
                ]))
            })
            .parse(generation)
            .contracts;
    }
    return [
        { kind: 'crash-freedom' },
        { kind: 'fix-syntax' },
        { kind: 'suggestion-syntax' }
    ];
}

function validateInventories(definition: ConfigDefinition<string>): void {
    for (const inventory of definition.inventories) {
        const names = catalogRules(inventory.catalog).map(function name(entry) {
            return z.string().trim().min(1).parse(entry.ruleId);
        });
        uniqueNames(names, 'Rule catalogs must contain unique rules.');
        for (const exclusion of inventory.exclusions) {
            z.string().trim().min(1).parse(exclusion.reason);
            if (!names.includes(exclusion.ruleId)) {
                throw new TypeError('Inventory exclusions must name catalog rules.');
            }
        }
        if (inventory.target.kind === 'effective') {
            projectPath('/project', inventory.target.filename);
        }
    }
}

function validateGeneration(entry: ConfigGeneration<string>): void {
    validateProject(entry.project);
    if (entry.generator.kind === 'syntax') {
        projectPath('/project', entry.generator.filename);
    } else if (!isGenerator(entry.generator.input)) {
        throw new TypeError('Config input must be an Overkill generator.');
    }
    const kinds = generationContracts(entry).map(function kind(contract) {
        return contract.kind;
    });
    uniqueNames(kinds, 'Select unique property contracts.');
}

function validateFixture(entry: ConfigFixture<string>): void {
    projectPath('/project', entry.source.filename);
    if (entry.expect.kind === 'fix' && entry.expect.output.kind === 'file') {
        projectPath('/project', entry.expect.output.filename);
    }
}

function validateTargets(entries: readonly NamedConfigCase[], names: readonly string[]): void {
    const titles = entries.map(function entry(value) {
        configNames(names, value.configs);
        return z.string().trim().min(1).parse(value.title);
    });
    if (titles.length > 0) {
        uniqueNames(titles, 'Config case titles must be unique within each suite.');
    }
}

function namedConfigurations(definition: ConfigDefinition<string>): readonly string[] {
    const names = Object.keys(definition.configs);
    if (names.length === 0) {
        throw new TypeError('Declare at least one named configuration.');
    }
    for (const name of names) {
        z.string().trim().min(1).parse(name);
    }
    return names;
}

function validateInputs(definition: ConfigDefinition<string>): void {
    for (const entry of definition.files) {
        projectPath('/project', entry.filename);
    }
    for (const entry of definition.fixtures) {
        validateFixture(entry);
    }
    for (const entry of definition.generation) {
        validateGeneration(entry);
    }
}

export function validateConfigDefinition(definition: ConfigDefinition<string>): void {
    z.string().trim().min(1).parse(definition.name);
    validateProject(definition.project);
    const names = namedConfigurations(definition);
    const groups = [ [ ...definition.inventories, ...definition.files ], definition.fixtures, definition.generation ];
    for (const entries of groups) {
        validateTargets(entries, names);
    }
    validateInventories(definition);
    validateInputs(definition);
}
