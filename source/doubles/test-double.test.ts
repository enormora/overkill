import assert from 'node:assert/strict';
import { registerTest } from '../test-support/register-test.ts';
import { testDouble } from './test-double.ts';

type PendingRuleConfiguration = {
    readonly rules: readonly unknown[];
};

type PendingConfiguredDoubleFactory = (configuration: PendingRuleConfiguration) => unknown;
type PrimitiveConstructionFactory = (instance: unknown) => unknown;

registerTest('testDouble() creates an untyped callable double', function () {
    const anyValue = testDouble();

    assert.equal(anyValue('ignored'), undefined);
});

registerTest('testDouble() rejects configuration before rule support exists', function () {
    const createConfiguredDouble = testDouble as unknown as PendingConfiguredDoubleFactory;

    assert.throws(function attemptConfiguredDouble() {
        createConfiguredDouble({ rules: [] });
    }, /does not accept configuration yet/u);
});

registerTest('testDouble.returns() creates a fixed-return double', function () {
    const loadValue = testDouble.returns(42);

    assert.equal(loadValue('ignored'), 42);
});

registerTest('testDouble.resolves() creates a fixed-resolution double', async function () {
    const loadValue = testDouble.resolves('value');

    assert.equal(await loadValue('ignored'), 'value');
});

registerTest('testDouble.rejects() creates a fixed-rejection double', async function () {
    const error = new Error('expected');
    const loadValue = testDouble.rejects(error);

    await assert.rejects(async function rejectValue() {
        await loadValue('ignored');
    }, error);
});

registerTest('testDouble.throws() creates a fixed-throw double', function () {
    const error = new Error('expected');
    const loadValue = testDouble.throws(error);

    assert.throws(function throwValue() {
        loadValue('ignored');
    }, error);
});

registerTest('testDouble.constructs() creates a fixed-construction double', function () {
    type ClientInstance = {
        readonly id: string;
    };

    const client: ClientInstance = { id: 'client' };
    const Client = testDouble.constructs(client);

    assert.equal(new Client('ignored'), client);
});

registerTest('created doubles reject wrong invocation modes', function () {
    const loadValue = testDouble.returns('value');
    const Client = testDouble.constructs({ id: 'client' });
    const LoadValue = loadValue as unknown as new () => unknown;

    assert.throws(function constructCallableDouble() {
        assert.equal(new LoadValue(), undefined);
    }, /not a constructor/u);
    assert.throws(function callConstructorDouble() {
        (Client as unknown as () => unknown)();
    }, /Class constructor/u);
});

registerTest('testDouble.constructs() rejects primitive instances at runtime', function () {
    const createConstructorDouble = testDouble.constructs as unknown as PrimitiveConstructionFactory;

    assert.throws(function constructPrimitive() {
        createConstructorDouble(1);
    }, /requires an object instance/u);
});
