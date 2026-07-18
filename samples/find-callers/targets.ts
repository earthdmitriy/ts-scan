/**
 * Shared callable targets for find_callers fixtures.
 */

export function targetFn(n: number): number {
	/*cursor:target-body*/
	return n + 1;
}

export const arrowTarget = (n: number): number => {
	return n * 2;
};

export class TargetClass {
	constructor(public value: number) {}

	method(): number {
		return this.value;
	}
}

export function taggedTarget(
	strings: TemplateStringsArray,
	..._values: unknown[]
): string {
	return strings.join('');
}

/** JSX-callable component (used from tagged-jsx.tsx). */
export function JsxTarget(props: { label: string }): string {
	return props.label;
}

export function emitBootstrap(): void {
	/*cursor:emit-bootstrap*/
}

export const notCallable = 42;
