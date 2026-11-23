import type { Type, Symbol as CompilerSymbol } from 'typescript-beta/async';
import type { Declaration } from 'typescript-beta/ast';
import type { CompilerSyntax } from './installed-compiler.ts';
import { sourceDeclarations } from './source-analysis.ts';
import { established, type RelationEvidence } from './relation-evidence.ts';

export async function sameNominalSymbols(
    actual: Type,
    expected: Type,
    unsupported: RelationEvidence
): Promise<RelationEvidence> {
    const [ symbol, target ] = await Promise.all([ actual.getSymbol(), expected.getSymbol() ]);
    return symbol === undefined || target === undefined ? unsupported : established(symbol === target);
}

function isNominalDeclaration(compiler: CompilerSyntax, declaration: Declaration): boolean {
    const name = compiler.getNameOfDeclaration(declaration);
    if (name !== undefined && compiler.isPrivateIdentifier(name)) {
        return true;
    }
    let nonPublic = false;
    declaration.forEachChild(function checkModifier(child) {
        if (child.kind === compiler.SyntaxKind.PrivateKeyword || child.kind === compiler.SyntaxKind.ProtectedKeyword) {
            nonPublic = true;
        }
    });
    return nonPublic;
}

async function nominalDeclarations(compiler: CompilerSyntax, symbol: CompilerSymbol): Promise<readonly string[]> {
    const declarations = await sourceDeclarations(symbol);
    return declarations.flatMap(function origin(declaration) {
        return isNominalDeclaration(compiler, declaration)
            ? [ JSON.stringify([ declaration.getSourceFile().fileName, declaration.pos, declaration.end ]) ]
            : [];
    });
}

export async function sameNominalMember(
    compiler: CompilerSyntax,
    actual: CompilerSymbol,
    expected: CompilerSymbol
): Promise<boolean> {
    const [ left, right ] = await Promise.all([
        nominalDeclarations(compiler, actual),
        nominalDeclarations(compiler, expected)
    ]);
    return left.length === right.length && left.every(function shared(origin) {
        return right.includes(origin);
    });
}
