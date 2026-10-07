import path from 'node:path';
// eslint-disable-next-line node/no-unsupported-features/node-builtins -- Match native V8 offsets.
import { stripTypeScriptTypes } from 'node:module';
import { parse } from 'acorn';
import { transform } from 'sucrase';

const typeScriptExtensions = new Set([ '.cts', '.mts', '.ts' ]);
const sourceExtensions = new Set([ '.cjs', '.cts', '.js', '.mjs', '.mts', '.ts' ]);

type TransformedCoverageSource = {
    readonly source: string;
    readonly sourceMap: unknown;
};
type CoverageSourceInspection = {
    readonly comments: readonly string[];
    readonly hasRuntime: boolean;
};

export function nativeTypeScriptCoverageSource(source: string): string {
    return stripTypeScriptTypes(source, { mode: 'strip' });
}

export function transformCoverageSource(source: string, filePath: string): TransformedCoverageSource {
    const result = transform(source, {
        filePath,
        sourceMapOptions: { compiledFilename: filePath.replace(/\.[cm]?ts$/u, '.js') },
        transforms: [ 'typescript' ]
    });

    return { source: result.code, sourceMap: { ...result.sourceMap, sourcesContent: [ source ] } };
}

export function isTypeScriptCoverageSource(filePath: string): boolean {
    return typeScriptExtensions.has(path.extname(filePath));
}

export function isSupportedCoverageSource(filePath: string): boolean {
    return sourceExtensions.has(path.extname(filePath));
}

export function inspectCoverageSource(source: string, filePath: string): CoverageSourceInspection {
    const comments: string[] = [];
    const program = parse(
        isTypeScriptCoverageSource(filePath) ? transformCoverageSource(source, filePath).source : source,
        {
            allowReturnOutsideFunction: true,
            ecmaVersion: 'latest',
            onComment(block, value) {
                comments.push(block ? `/*${value}*/` : `//${value}`);
            },
            sourceType: 'module'
        }
    );

    const hasRuntime = program.body.some(function executesCode(statement) {
        return statement.type !== 'EmptyStatement' &&
            !(statement.type === 'ExportNamedDeclaration' && statement.declaration === null &&
                statement.specifiers.length === 0 && statement.source === null);
    });

    return { comments, hasRuntime };
}
