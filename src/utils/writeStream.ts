import fs, { WriteStream } from "fs";
import { EventEmitter } from "events";

export default class Writer extends EventEmitter {
	stream: WriteStream;
	pendingWrites: number;

	/**
	 * Create a new Writer instance.
	 * @param {string} path - The path to the file to be written.
	 * @param {Object} options - Write stream options.
	 */
	constructor(path: string, options: any) {
		super();
		this.stream = fs.createWriteStream(path, options);
		this.pendingWrites = 0;
	}

	/**
	 * Write data to the file using the writable stream.
	 * @param {any} data - The data to be written.
	 */
	write(data: any) {
		this.pendingWrites++;
		this.stream.write(data, () => {
			this.pendingWrites--;
			this.emit("write");
		});
	}

	/**
	 * Stop the write stream and reset pending writes.
	 */
	stop() {
		this.stream.close();
		this.pendingWrites = 0;
	}
}
