/**
 * Shared symbol consumed across workspace packages (no TS project references).
 */
export type SharedEdge = {
	id: string;
};

export function
	/*cursor:shared-helper*/
	sharedHelper(edge: SharedEdge): string {
	return edge.id;
}
