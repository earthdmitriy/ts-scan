import type { RuntimeEdge } from '../runtime/workspace-types.js';

/**
 * Consumes a runtime edge via a NodeNext .js import specifier.
 */
export function useEdge(
	edge:
		/*cursor:imported-type*/
		RuntimeEdge,
): string {
	return edge.id;
}
