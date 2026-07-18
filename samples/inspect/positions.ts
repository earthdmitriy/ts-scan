export type EdgeId = string;

export interface Value {
	edgeId: EdgeId;
}

/**
 * Runs a value through the pipeline.
 *
 * Second paragraph should not appear in compact docs.
 */
export function run(value: Value): EdgeId {
	return value.edgeId;
}

/**
 * Handler-parameter smoke target.
 */
export function forwardRunnerEvent(
	/*cursor:param*/
	value: Value,
): EdgeId {
	const id = value
		/*cursor:property*/
		.edgeId;
	/*cursor:callee*/
	return run(value);
}

export class BridgeHandler {
	edgeId: EdgeId = 'x';

	handle(value: Value): void {
		/*cursor:this*/
		this.edgeId = value.edgeId;
	}
}

type LocalAlias =
	/*cursor:type-ref*/
	Value;

export function withExternalGeneric(
	items:
		/*cursor:generic*/
		Promise<Map<string, Value[]>>,
): Promise<Map<string, Value[]>> {
	return items;
}

export function omittedColumnDemo(): void {
	/*cursor:omitted-column*/
	const indentedConst: EdgeId = 'ready';
	void indentedConst;
}
