/**
 * Runtime edge identity used across packages (source implementation).
 */
export type RuntimeEdge = {
	id: string;
};

/**
 * Runner event union (declaration must win over test usages).
 */
export type RuntimeRunnerEvent =
	| { readonly kind: 'output'; readonly id: string }
	| { readonly kind: 'done'; readonly id: string };

export interface LinkedSource {
	value: number;
}
