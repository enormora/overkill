import { pathToFileURL } from 'node:url';
import { z } from 'zod/v4';
import { serializeValue } from '../compare/serialized-value.ts';
import { propertyWitnessSchema } from '../engine/property-corpus.ts';
import { decodePropertyInput, migratePropertyInput } from '../property/property-graph.ts';
import { defineCodec, type PropertyCodecPayload } from '../property/property-codec.ts';

process.stdin.setEncoding('utf8');
let input = '';
for await (const chunk of process.stdin) {
    if (typeof chunk !== 'string') {
        throw new TypeError('Expected text input.');
    }
    input += chunk;
}
const request = z
    .strictObject({
        witness: propertyWitnessSchema,
        migrate: z.boolean(),
        codec: z.discriminatedUnion('kind', [
            z.strictObject({ kind: z.literal('built-in') }),
            z.strictObject({ kind: z.literal('module'), path: z.string(), exportName: z.string() })
        ])
    })
    .parse(JSON.parse(input));
function workBudget(): () => void {
    let consumed = 0;
    const limit = 100_000;
    return function consume() {
        consumed += 1;
        if (consumed > limit) {
            throw new Error('Corpus codec work limit exceeded.');
        }
    };
}
const consume = workBudget();
const codecDefinition = z.strictObject({
    name: z.string(),
    version: z.number(),
    encode: z.custom<(value: unknown) => PropertyCodecPayload>(function callable(value) {
        return typeof value === 'function';
    }),
    decode: z.custom<(value: unknown) => unknown>(function callable(value) {
        return typeof value === 'function';
    }),
    previousDecoders: z.array(z.strictObject({
        version: z.number(),
        decode: z.custom<(value: unknown) => unknown>(function callable(value) {
            return typeof value === 'function';
        })
    }))
});
const codec = request.codec.kind === 'built-in' ? null : defineCodec(codecDefinition.parse(
    Reflect.get(await import(pathToFileURL(request.codec.path).href), request.codec.exportName)
));
const source = serializeValue(decodePropertyInput(request.witness.counterexample, codec, consume));
const witness = request.migrate
    ? {
        ...request.witness,
        counterexample: migratePropertyInput(request.witness.counterexample, codec, consume)
    }
    : request.witness;
const output = request.migrate
    ? serializeValue(decodePropertyInput(witness.counterexample, codec, consume))
    : source;
process.stdout.write(JSON.stringify({ witness, source, output }));
