import type { LocalId } from './definitions.js';
import { localValue as importedAlias } from './definitions.js';
import type { RuntimeEdge } from './workspace/packages/runtime/src/types.js';
import { ExternalWidget } from 'definition-package';

export function consumeId(
	id:
		/*cursor:type-only-js*/
		LocalId,
): LocalId {
	return id;
}

export function consumeAlias(): number {
	/*cursor:imported-alias*/
	return importedAlias;
}

export function consumeRuntime(
	edge:
		/*cursor:workspace-type*/
		RuntimeEdge,
): string {
	return edge.id;
}

export function consumeExternal(
	widget:
		/*cursor:external-symbol*/
		ExternalWidget,
): string {
	return widget.label;
}

export function nothingPositions(): void {
	/*cursor:comment*/
	// just a comment
	const literal =
		/*cursor:string-literal*/
		'hello';
	/*cursor:unknown-ident*/
	unknownIdentifier;
	void literal;
}
