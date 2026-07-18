import { sharedHelper, type SharedEdge } from '../../library/src/api.js';

export function runShared(edge: SharedEdge): string {
	return sharedHelper(edge);
}
