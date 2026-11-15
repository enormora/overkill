import { z } from 'zod';
import { gen, type Generator as PropertyGenerator } from '../packages/property/property.entry-point.ts';

export function readSchema(value: unknown): Readonly<Record<string, unknown>> {
    return z.record(z.string(), z.unknown()).parse(value);
}
export function jsonValue(): PropertyGenerator<unknown> {
    return gen.recursive<unknown>({
        leaf: gen
            .choice(
                gen.constant(null),
                gen.boolean(),
                gen.number({ min: -100, max: 100 }),
                gen.string({ minLength: 0, maxLength: 20 })
            )
            .map(function scalar(value): unknown {
                return value;
            }),
        maxDepth: 4,
        branch(child) {
            return gen
                .choice(gen.array(child, { minLength: 0, maxLength: 4 }), gen.record({ value: child }))
                .map(function collection(value): unknown {
                    return value;
                });
        }
    });
}
