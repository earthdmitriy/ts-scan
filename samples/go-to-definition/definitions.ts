export const localValue = 42;

export type LocalId = string;

export interface MergedShape {
	kind: 'a';
}

export interface MergedShape {
	extra: number;
}

export namespace MergedNS {
	export const flag = true;
}

export namespace MergedNS {
	export function ping(): string {
		return 'pong';
	}
}

export function useLocal(): number {
	/*cursor:local-use*/
	return localValue;
}

export function useMerged(
	shape:
		/*cursor:merged-interface*/
		MergedShape,
): number {
	return shape.extra;
}

export function useNamespace(): string {
	/*cursor:merged-namespace*/
	return MergedNS.ping();
}

export type AliasTarget = LocalId;

export { localValue as reexportedValue };
