export function identityPair<T, U>(left: T, right: U): [T, U] {
	return [left, right];
}

export function useGenerics(): void {
	identityPair(/*sig:generic-arg0*/ 'hello', /*sig:generic-arg1*/ 123);
}
