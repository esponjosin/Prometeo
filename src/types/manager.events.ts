import { File } from "../lib/file";

export type PrometeoEvents = {
	download: [file: File];
};

export type PrometeoHandler = {
	[K in keyof PrometeoEvents]: (...args: PrometeoEvents[K]) => unknown;
};
