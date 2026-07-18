import { trackedValue } from './declaration.js';

export function testUsesTracked(): number {
	/*cursor:test-use*/
	return trackedValue;
}
