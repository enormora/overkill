import { z } from 'zod';
import type { Generator as PropertyGenerator } from '../packages/property/property.entry-point.ts';
import type { ConfigGeneration, ConfigInput, ConfigSource } from './config-definition.ts';
import { sourceInputs } from './source-inputs.ts';

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
