import { z } from 'zod/v4';
import { coverageTokens, type CoverageToken } from './coverage-tokens.ts';

const rangeSchema = z.object({ count: z.number(), endOffset: z.number(), startOffset: z.number() });
const functionsSchema = z.array(z.object({
    functionName: z.string(),
    isBlockCoverage: z.boolean(),
    ranges: z.tuple([ rangeSchema ]).rest(rangeSchema)
}));
const keyTypes = new Set([ 'IdentifierName', 'PrivateIdentifier', 'StringLiteral', 'NumericLiteral' ]);

function closingToken(tokens: readonly CoverageToken[], start: number, opening: string, closing: string): number {
    let depth = 0;

    for (let index = start; index < tokens.length; index += 1) {
        const value = tokens[index]?.value;

        if (value === opening) {
            depth += 1;
        } else if (value === closing) {
            depth -= 1;
            if (depth === 0) {
                return index;
            }
        }
    }
    return tokens.length;
}

function enclosingDelimiter(tokens: readonly CoverageToken[], start: number): string | undefined {
    const delimiters: string[] = [];

    for (const token of tokens.slice(0, start)) {
        if ([ '(', '[', '{' ].includes(token.value)) {
            delimiters.push(token.value);
        } else if ([ ')', ']', '}' ].includes(token.value)) {
            delimiters.pop();
        }
    }
    return delimiters.at(-1);
}

function startsMethod(tokens: readonly CoverageToken[], start: number): boolean {
    const previous = tokens[start - 1]?.value ?? '';

    return enclosingDelimiter(tokens, start) === '{' && [ '{', '}', ';', ',', 'static' ].includes(previous);
}

function isMethodPrefix(tokens: readonly CoverageToken[], start: number): boolean {
    return [ 'async', 'get', 'set' ].includes(tokens[start]?.value ?? '') && tokens[start + 1]?.value !== '(';
}

function methodKeyStart(tokens: readonly CoverageToken[], start: number): number {
    const index = isMethodPrefix(tokens, start) ? start + 1 : start;
    return tokens[index]?.value === '*' ? index + 1 : index;
}

function methodKeyEnd(tokens: readonly CoverageToken[], start: number): number | null {
    const key = tokens[start];

    if (key?.value === '[') {
        return closingToken(tokens, start, '[', ']') + 1;
    }
    return key !== undefined && keyTypes.has(key.type) ? start + 1 : null;
}

function parametersAfterKey(tokens: readonly CoverageToken[], start: number): number | null {
    const token = tokens[start];

    if (token?.value !== '(') {
        return null;
    }
    const end = closingToken(tokens, start, '(', ')');

    return tokens[end + 1]?.value === '{' ? token.start : null;
}

function methodParameters(tokens: readonly CoverageToken[], start: number): number | null {
    const keyStart = methodKeyStart(tokens, start);

    if (tokens[keyStart]?.value === 'function' && !startsMethod(tokens, start)) {
        return null;
    }
    const keyEnd = methodKeyEnd(tokens, keyStart);

    return keyEnd === null ? null : parametersAfterKey(tokens, keyEnd);
}

export function createCoverageMethodNormalizer(
    tokens: readonly CoverageToken[]
): (functions: unknown) => z.infer<typeof functionsSchema> {
    const positions = new Map(tokens.map(function tokenPosition(token, index) {
        return [ token.start, index ];
    }));
    const methods = new Map<number, number | null>();

    function parametersAt(offset: number): number | null {
        const start = positions.get(offset);

        if (start === undefined) {
            return null;
        }
        if (!methods.has(start)) {
            methods.set(start, methodParameters(tokens, start));
        }
        return methods.get(start) ?? null;
    }

    return function normalizeMethods(functions) {
        const normalized = functionsSchema.parse(functions);

        for (const fn of normalized) {
            const [ range ] = fn.ranges;
            const parameters = parametersAt(range.startOffset);

            if (parameters !== null && parameters < range.endOffset) {
                range.startOffset = parameters;
            }
        }
        return normalized;
    };
}

export function normalizeCoverageMethodRanges(functions: unknown, source: string): z.infer<typeof functionsSchema> {
    return createCoverageMethodNormalizer(Array.from(coverageTokens(source)))(functions);
}
