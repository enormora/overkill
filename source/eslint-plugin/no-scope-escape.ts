import { AST_NODE_TYPES as NodeType, type TSESLint, type TSESTree as Tree } from '@typescript-eslint/utils';
import { match } from 'ts-pattern';
import { bindingAnalysis, type BindingAnalysis } from './binding-analysis.ts';
import { isFunction, type BindingOrigin, type FunctionNode } from './binding-origin.ts';
import { scopeParameters } from './authoring-contracts.ts';

type Node = Readonly<Tree.Node>;
type Call = Readonly<Tree.CallExpression | Tree.NewExpression>;
type Write = Readonly<Tree.AssignmentExpression>;
type RuleContext = TSESLint.RuleContext<'escape' | 'forward', []>;

function argumentsOf(call: Call): readonly Node[] {
    return call.arguments.map(function (argument) {
        return argument.type === NodeType.SpreadElement ? argument.argument : argument;
    });
}

function parentOf(node: Node): Node | undefined {
    return node.parent ?? undefined;
}

function enclosingFunction(node: Node): FunctionNode | null {
    for (let parent = parentOf(node); parent !== undefined; parent = parentOf(parent)) {
        if (isFunction(parent)) {
            return parent;
        }
    }
    return null;
}

function within(node: Node, owner: Node): boolean {
    for (let current: Node | undefined = node; current !== undefined; current = parentOf(current)) {
        if (current === owner) {
            return true;
        }
    }
    return false;
}

function caughtInside(node: Readonly<Tree.ThrowStatement>, owner: FunctionNode): boolean {
    let child: Node = node;
    for (let parent = parentOf(node); parent !== undefined && parent !== owner; parent = parentOf(parent)) {
        if (parent.type === NodeType.TryStatement && parent.block === child && parent.handler !== null) {
            return true;
        }
        child = parent;
    }
    return false;
}

function returnedExpression(node: Node): boolean {
    return node.parent?.type === NodeType.ArrowFunctionExpression && node.parent.body === node;
}

function patternMembers(node: Node): readonly Node[] | null {
    return match(node)
        .with({ type: NodeType.ObjectPattern }, function (pattern) {
            return pattern.properties.map(function (property) {
                return property.type === NodeType.Property ? property.value : property.argument;
            });
        })
        .with({ type: NodeType.ArrayPattern }, function (pattern) {
            return pattern.elements.filter(function (element) {
                return element !== null;
            });
        })
        .with({ type: NodeType.RestElement }, function (element) {
            return [ element.argument ];
        })
        .with({ type: NodeType.AssignmentPattern }, function (pattern) {
            return [ pattern.left ];
        })
        .otherwise(function () {
            return null;
        });
}

function writeTargets(node: Node): readonly Node[] {
    const targets: Node[] = [];
    const pending = new Set([ node ]);
    for (const target of pending) {
        const members = patternMembers(target);
        if (members === null) {
            targets.push(target);
        } else {
            members.forEach(function (member) {
                pending.add(member);
            });
        }
    }
    return targets;
}

function transferValues(node: Node): readonly Node[] {
    return match(node)
        .with({ type: NodeType.CallExpression }, { type: NodeType.NewExpression }, argumentsOf)
        .with({ type: NodeType.AssignmentExpression }, function (write) {
            return [
                write.right,
                ...writeTargets(write.left).flatMap(function (target) {
                    return target.type === NodeType.MemberExpression ? [ target.object ] : [];
                })
            ];
        })
        .with({ type: NodeType.ReturnStatement }, { type: NodeType.ThrowStatement }, function (statement) {
            return statement.argument === null ? [] : [ statement.argument ];
        })
        .otherwise(function () {
            return [];
        });
}

function query(node: Node): readonly Node[] {
    const values = transferValues(node);
    return returnedExpression(node) ? [ ...values, node ] : values;
}

function binding(
    source: Readonly<TSESLint.SourceCode>,
    node: Readonly<Tree.Identifier>
): TSESLint.Scope.Variable | null {
    for (let scope: TSESLint.Scope.Scope | null = source.getScope(node); scope !== null; scope = scope.upper) {
        const variable = scope.set.get(node.name);
        if (variable !== undefined) {
            return variable;
        }
    }
    return null;
}

function storesOutside(
    context: RuleContext,
    analysis: BindingAnalysis,
    owner: FunctionNode,
    write: Write
): boolean {
    return writeTargets(write.left).some(function (target) {
        if (target.type === NodeType.Identifier) {
            const variable = binding(context.sourceCode, target);
            return variable?.defs.some(function (definition) {
                return within(definition.node, owner);
            }) !== true;
        }
        if (target.type === NodeType.MemberExpression) {
            const allocations = analysis.allocationsAt(target.object, write);
            return allocations.length === 0 || allocations.some(function (allocation) {
                return !within(allocation, owner);
            });
        }
        return false;
    });
}

const timers = new Set([ 'setTimeout', 'setInterval', 'setImmediate' ]);

const timerModules = new Set([ 'node:timers', 'timers' ]);

function importedTimer(origin: BindingOrigin | null): boolean {
    if (origin?.root.kind !== 'import' || !timerModules.has(origin.root.source)) {
        return false;
    }
    const method = origin.path.at(-1);
    return method !== undefined && timers.has(method);
}

function globalTimer(source: Readonly<TSESLint.SourceCode>, callee: Node): boolean {
    return callee.type === NodeType.Identifier && timers.has(callee.name) &&
        (binding(source, callee)?.defs.length ?? 0) === 0;
}

const assertionMethodPathLength = 2;

function isProtected(path: readonly string[]): boolean {
    const [ member ] = path;
    return path.length === 0 || member === 'plan' && path.length === 1 ||
        (member === 'assert' || member === 'require') && path.length <= assertionMethodPathLength;
}

type OwnerOf = (origin: BindingOrigin | null) => FunctionNode | null;

function scopeOwner(parameters: ReturnType<typeof scopeParameters>): OwnerOf {
    return function (origin) {
        if (origin?.root.kind !== 'parameter' || !isProtected(origin.path)) {
            return null;
        }
        const { owner, index } = origin.root;
        const ownsScope = parameters.some(function (parameter) {
            return parameter.body === owner && parameter.index === index;
        });
        return ownsScope ? owner : null;
    };
}

function capturedOwners(
    analysis: BindingAnalysis,
    references: readonly Node[],
    ownerOf: OwnerOf
): ReadonlyMap<FunctionNode, ReadonlySet<FunctionNode>> {
    const captures = new Map<FunctionNode, Set<FunctionNode>>();
    const usesOfFunction = new Map<FunctionNode, Node[]>();

    function recordCapture(reference: Node, owner: FunctionNode): boolean {
        let changed = false;
        let enclosing = enclosingFunction(reference);
        while (enclosing !== null && enclosing !== owner && within(enclosing, owner)) {
            const owningScopes = captures.get(enclosing) ?? new Set<FunctionNode>();
            if (!owningScopes.has(owner)) {
                owningScopes.add(owner);
                captures.set(enclosing, owningScopes);
                changed = true;
            }
            enclosing = enclosingFunction(enclosing);
        }
        return changed;
    }

    function recordReference(reference: Node): void {
        const origin = analysis.originOf(reference);
        const owner = ownerOf(origin);
        if (owner !== null) {
            recordCapture(reference, owner);
        }
        if (origin?.root.kind === 'function' && origin.path.length === 0) {
            const uses = usesOfFunction.get(origin.root.node) ?? [];
            uses.push(reference);
            usesOfFunction.set(origin.root.node, uses);
        }
    }

    function inheritCaptures(): boolean {
        let changed = false;
        for (const [ callback, uses ] of usesOfFunction) {
            const owners = captures.get(callback) ?? [];
            for (const owner of owners) {
                for (const use of uses) {
                    changed = recordCapture(use, owner) || changed;
                }
            }
        }
        return changed;
    }

    references.forEach(recordReference);
    let changed = inheritCaptures();
    while (changed) {
        changed = inheritCaptures();
    }
    return captures;
}

type RuleNodes = {
    readonly calls: readonly Readonly<Tree.CallExpression>[];
    readonly sites: readonly Node[];
    readonly references: readonly Node[];
};

function returnedValue(site: Node): Node | null {
    if (site.type === NodeType.ReturnStatement || site.type === NodeType.ThrowStatement) {
        return site.argument;
    }
    return returnedExpression(site) ? site : null;
}

function leavesOwner(site: Node, owner: FunctionNode): boolean {
    return site.type !== NodeType.ThrowStatement || !caughtInside(site, owner);
}

function reportEscapes(context: RuleContext, analysis: BindingAnalysis, nodes: RuleNodes): void {
    const ownerOf = scopeOwner(scopeParameters(context.sourceCode, analysis, nodes.calls));
    const captures = capturedOwners(analysis, nodes.references, ownerOf);

    function protectedOwners(value: Node, site: Node, includeCallbacks: boolean): readonly FunctionNode[] {
        return analysis.originsWithin(value, site).flatMap(function (origin) {
            const owner = ownerOf(origin);
            if (owner !== null) {
                return [ owner ];
            }
            return includeCallbacks && origin.root.kind === 'function' && origin.path.length === 0
                ? Array.from(captures.get(origin.root.node) ?? [])
                : [];
        });
    }

    function escapesInTimer(call: Call, callback: Node): boolean {
        if (call.parent.type !== NodeType.ExpressionStatement) {
            return false;
        }
        const timer = importedTimer(analysis.originOf(call.callee)) || globalTimer(context.sourceCode, call.callee);
        const owner = enclosingFunction(call);
        return timer && owner !== null && protectedOwners(callback, call, true).includes(owner);
    }

    function reportCall(call: Call): void {
        const args = argumentsOf(call);
        for (const [ index, argument ] of args.entries()) {
            if (protectedOwners(argument, call, false).length > 0) {
                context.report({ node: argument, messageId: 'forward' });
            } else if (index === 0 && escapesInTimer(call, argument)) {
                context.report({ node: argument, messageId: 'escape' });
            }
        }
    }

    function reportWrite(write: Write): void {
        if (write.operator !== '=') {
            return;
        }
        const escapes = protectedOwners(write.right, write, true).some(function (owner) {
            return storesOutside(context, analysis, owner, write);
        });
        if (escapes) {
            context.report({ node: write.right, messageId: 'escape' });
        }
    }

    function reportReturn(site: Node): void {
        const value = returnedValue(site);
        const owner = enclosingFunction(site);
        if (
            value !== null && owner !== null &&
            leavesOwner(site, owner) && protectedOwners(value, site, true).includes(owner)
        ) {
            context.report({ node: value, messageId: 'escape' });
        }
    }

    for (const site of nodes.sites) {
        match(site)
            .with({ type: NodeType.CallExpression }, { type: NodeType.NewExpression }, reportCall)
            .with({ type: NodeType.AssignmentExpression }, reportWrite)
            .otherwise(function () {
                return undefined;
            });
        reportReturn(site);
    }
}

export const noScopeEscape: TSESLint.RuleModule<'escape' | 'forward'> = {
    meta: {
        type: 'problem',
        schema: [],
        messages: {
            forward: 'Pass application data or a resource handle instead of an Overkill scope or its assertion API.',
            escape: 'Keep the Overkill scope and its assertion API within the owning test or trial.'
        }
    },
    create(context) {
        const calls: Readonly<Tree.CallExpression>[] = [];
        const sites: Node[] = [];
        const references: Node[] = [];
        return bindingAnalysis(context.sourceCode, function report(result) {
            reportEscapes(context, result, { calls, sites, references });
        }, {
            query,
            visit(node) {
                if (query(node).length > 0) {
                    sites.push(node);
                }
                if (node.type === NodeType.CallExpression) {
                    calls.push(node);
                }
                if (node.type === NodeType.Identifier || node.type === NodeType.MemberExpression) {
                    references.push(node);
                }
            }
        });
    }
};
