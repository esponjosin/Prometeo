export type ConnectionEvents = {
	log: [log: string];
	finish: [status: boolean];
	destroy: [];
};

export type ConnectionHandler = {
	[K in keyof ConnectionEvents]: (...args: ConnectionEvents[K]) => unknown;
};
