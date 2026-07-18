/**
 * Public helper shared across find-callers workspace packages.
 */
export function sharedCallable(label: string): string {
	/*cursor:shared-impl*/
	return `lib:${label}`;
}
