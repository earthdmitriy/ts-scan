import type { RuntimeRunnerEvent } from '../../runtime/src/types.js';
import { useRunnerEvent } from './use.js';

/**
 * Usage site that LS may return via getImplementationAtPosition
 * (array type `[]` → anonymous span). Must never become primary.
 */
it('collects runner events', () => {
	const doneReceived: RuntimeRunnerEvent[] = [];
	void useRunnerEvent({ kind: 'done', id: '1' });
	void doneReceived;
});
