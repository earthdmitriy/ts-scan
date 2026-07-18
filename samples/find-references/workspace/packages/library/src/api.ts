/**
 * Public helper shared across workspace packages.
 */
export function sharedHelper(label: string): string {
	return `lib:${label}`;
}

export type SharedLabel = string;
