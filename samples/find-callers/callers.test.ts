import { targetFn } from './targets.js';

export function testCaller(): number {
	/*cursor:test-call*/
	return targetFn(99);
}
