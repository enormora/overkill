import path from 'node:path';
import { parse } from 'acorn';
import { transform } from 'sucrase';

const typeScriptExtensions = new Set([ '.cts', '.mts', '.ts' ]);

type TransformedCoverageSource = {
    readonly source: string;
    readonly sourceMap: unknown;
};

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

export function hasRuntimeCoverageSource(source: string, filePath: string): boolean {
    const program = parse(
        isTypeScriptCoverageSource(filePath) ? transformCoverageSource(source, filePath).source : source,
        {
            allowReturnOutsideFunction: true,
            ecmaVersion: 'latest',
            sourceType: 'module'
        }
    );

    return program.body.some(function executesCode(statement) {
        return statement.type !== 'EmptyStatement' &&
            !(statement.type === 'ExportNamedDeclaration' && statement.declaration === null &&
                statement.specifiers.length === 0 && statement.source === null);
    });
}
