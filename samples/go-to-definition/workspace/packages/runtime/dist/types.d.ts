/**
 * Generated declaration for RuntimeEdge (linked .d.ts).
 */
export type RuntimeEdge = {
	id: string;
};
export type RuntimeRunnerEvent =
	| { readonly kind: 'output'; readonly id: string }
	| { readonly kind: 'done'; readonly id: string };
export interface LinkedSource {
	value: number;
}
