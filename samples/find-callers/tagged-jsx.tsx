/** Minimal React factory so JSX parses without a real React install. */
declare const React: {
	createElement: (...args: unknown[]) => unknown;
};

import { JsxTarget, taggedTarget } from './targets.js';

export function useTagged(): string {
	/*cursor:tagged*/
	return taggedTarget`hello`;
}

export function useJsx(): string {
	/*cursor:jsx*/
	return <JsxTarget label="x" />;
}
