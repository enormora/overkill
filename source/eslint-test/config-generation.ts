import { z } from 'zod';
import type { Generator as PropertyGenerator } from '../packages/property/property.entry-point.ts';
import type { ConfigGeneration, ConfigInput, ConfigSource, ConfigContract } from './config-definition.ts';
import { sourceInputs } from './source-inputs.ts';

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

export function configInputs(
    generation: ConfigGeneration<string>,
    source: ConfigSource
): PropertyGenerator<ConfigInput> {
    const { generator } = generation;
    if (generator.kind === 'custom') {
        return generator.input.map(function input(value): ConfigInput {
            return z.object({ filename: z.string(), code: z.string(), files: z.record(z.string(), z.string()) }).parse(
                value
            );
        });
    }
    return sourceInputs(
        {
            syntax: generator.syntax,
            filename: generator.filename,
            convergence: { kind: 'disabled' }
        },
        typeof source === 'function' ? [] : source,
        []
    )
        .map(function input(code): ConfigInput {
            return { filename: generator.filename, code, files: {} };
        });
}
