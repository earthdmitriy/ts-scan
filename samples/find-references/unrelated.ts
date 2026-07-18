/** Unrelated symbol that shares a name with a different declaration. */
export const trackedValue = 'unrelated';

export function useUnrelated(): string {
	/*cursor:unrelated-use*/
	return trackedValue;
}
