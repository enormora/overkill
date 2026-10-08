import { parse } from 'acorn';
import { simple } from 'acorn-walk';
import { z } from 'zod/v4';

type MethodRange = {
    readonly start: number;
    readonly parameters: number;
};
const rangeSchema = z.object({ count: z.number(), endOffset: z.number(), startOffset: z.number() });
const functionsSchema = z.array(z.object({
    functionName: z.string(),
    isBlockCoverage: z.boolean(),
    ranges: z.tuple([ rangeSchema ]).rest(rangeSchema)
}));

function coverageMethods(source: string): ReadonlyMap<number, MethodRange> {
    const methods = new Map<number, MethodRange>();
    const program = parse(source, { allowReturnOutsideFunction: true, ecmaVersion: 'latest', sourceType: 'module' });

    simple(program, {
        Property(node) {
            if (node.value.type === 'FunctionExpression' && (node.method || node.kind !== 'init')) {
                methods.set(node.end, { parameters: node.value.start, start: node.start });
            }
        },
        MethodDefinition(node) {
            methods.set(node.end, { parameters: node.value.start, start: node.start });
        }
    });
    return methods;
}

type CoverageRange = Readonly<z.infer<typeof functionsSchema>[number]['ranges'][number]>;

function startsInsideMethod(range: CoverageRange, method: MethodRange): boolean {
    return range.startOffset >= method.start && range.startOffset <= method.parameters;
}

export function normalizeCoverageMethodRanges(functions: unknown, source: string): z.infer<typeof functionsSchema> {
    const methods = coverageMethods(source);
    const normalized = functionsSchema.parse(functions);

    for (const fn of normalized) {
        const [ range ] = fn.ranges;
        const method = methods.get(range.endOffset);

        if (method !== undefined && startsInsideMethod(range, method)) {
            range.startOffset = method.parameters;
        }
    }
    return normalized;
}
