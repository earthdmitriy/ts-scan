import { onlyFromTest } from '../src/internal.js';

function testOnlyFromTest(): void {
	/*cursor:test-caller*/
	onlyFromTest();
}

void testOnlyFromTest;
