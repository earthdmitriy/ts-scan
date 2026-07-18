import type {
	/*cursor:runner-event-import*/
	RuntimeRunnerEvent,
} from '../../runtime/src/types.js';
import type { RuntimeEdge } from '../../runtime/src/types.js';
import type { LinkedSource } from '../../runtime/dist/types.js';

/**
 * RuntimeEdge navigation via NodeNext .js import.
 */
export function useEdge(
	edge:
		/*cursor:runtime-edge*/
		RuntimeEdge,
): string {
	return edge.id;
}

/**
 * Import that resolves through the linked .d.ts path; ranking should
 * still prefer the workspace .ts implementation when available.
 */
export function useLinked(
	source:
		/*cursor:linked-dts*/
		LinkedSource,
): number {
	return source.value;
}

export function useRunnerEvent(event: RuntimeRunnerEvent): string {
	return event.kind;
}
