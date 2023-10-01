type ErrorName =
	| "InvalidArgumentError"
	| "BadMetadataError"
	| "BadURLError"
	| "InternalError";

export default class PrometeoError extends Error {
	name: ErrorName;
	message: string;
	cause: any;

	constructor(name: ErrorName, message: string, cause?: any) {
		super();
		this.message = message;
		this.name = name;
		this.cause = cause;
	}
}
