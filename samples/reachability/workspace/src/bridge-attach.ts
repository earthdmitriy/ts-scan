/**
 * Only reached via attachAppBridge / createServer (export path fixture).
 */
export function bridgeOnlyLeaf(): number {
	return 1;
}

/**
 * Bridge attach entry (handler heuristic: attach*Bridge).
 */
export function attachAppBridge(): number {
	/*cursor:attach-bridge*/
	return bridgeOnlyLeaf();
}
