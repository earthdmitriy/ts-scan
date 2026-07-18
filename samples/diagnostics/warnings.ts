/** @deprecated Use modernHelper instead. */
export function legacyHelper(): number {
	return 1;
}

export function callLegacy(): number {
	/*warn:deprecated*/ return legacyHelper();
}
