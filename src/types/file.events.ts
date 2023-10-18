export type FileEvents = {
	speed: [speed: number];
	stop: [];
	progress: [speed: string, progress: number, estimated: number];
	finish: [];
	start: [];
	removed: []
};

export type FileHandler = {
	[K in keyof FileEvents]: (...args: FileEvents[K]) => unknown;
};
