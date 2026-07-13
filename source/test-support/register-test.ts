import { after, test } from 'node:test';

type TestFunction = () => Promise<void> | void;

const registeredTests: Promise<void>[] = [];

export function registerTest(title: string, testFunction: TestFunction): void {
    registeredTests.push(test(title, testFunction));
}

after(async function waitForRegisteredTests() {
    await Promise.all(registeredTests);
});
