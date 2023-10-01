import EventEmitter from "events";
import fs from "fs";
import StreamSpeed from "streamspeed";
import { pipeline } from "stream/promises";
import { Throttle as OriginalThrottle } from "stream-throttle";
import { File } from "./file";
import axios from "axios";
import utils from "util";
import {
	ConnectionEvents,
	ConnectionHandler,
} from "../types/connection.events";

interface ConnectionOptions {
	url: string;
	part: [number, string, [number, number]];
	speed: number;
	contentType: string;
}

interface Throttle extends OriginalThrottle {
	chunksize?: number;
	bucket?: {
		bucketSize?: number;
		tokensPerInterval?: number;
	};
}

/**
 * Represents a connection for downloading a part of a file.
 */

export default class Connection extends EventEmitter {
	private file: string;
	private url: string;
	private speedLimit: number;
	private range: [number, number];
	speed: number;
	private index: number;
	private _progress: number;
	private Manager: File;
	finished: boolean;
	private stopped: boolean;
	totalDownloaded: number;

	/**
	 * Creates a new connection.
	 * @param {File} Manager - The file manager that manages this connection.
	 * @param {ConnectionOptions} options - Connection options including speed, URL, and part details.
	 */
	constructor(Manager: File, options: ConnectionOptions) {
		super();

		this.file = options.part[1];
		this.range = options.part[2];
		this.Manager = Manager;
		this.index = options.part[0];
		this.speed = 0;
		this.speedLimit = options.speed;
		this.url = options.url;
		this._progress = 0;
		this.finished = false;
		this.totalDownloaded = 0;
		this.stopped = false;
	}

	override on<K extends keyof ConnectionEvents>(
		event: `${K}`,
		func: (...args: ConnectionEvents[K]) => void,
	): this;
	override on<K extends string>(
		event: `${K}`,
		func: (...args: unknown[]) => unknown,
	): this {
		const ev = super.on(event, func);

		// @ts-expect-error Eventemitter can sometimes return a listener
		return ev.emitter ? ev.emitter : ev;
	}
	override off<K extends keyof ConnectionEvents>(
		event: `${K}`,
		func: (...args: ConnectionEvents[K]) => void,
	): this;
	override off<K extends keyof ConnectionEvents>(
		event: `${K}`,
		func: (...args: unknown[]) => unknown,
	): this {
		return super.off(event, func);
	}

	override once<K extends keyof ConnectionEvents>(
		event: `${K}`,
		func: (...args: ConnectionEvents[K]) => void,
	): this;
	override once<K extends string>(
		event: `${K}`,
		func: (...args: unknown[]) => unknown,
	): this {
		const ev = super.on(event, func);

		// @ts-expect-error Eventemitter can sometimes return a listener
		return ev.emitter ? ev.emitter : ev;
	}

	override emit<K extends keyof ConnectionEvents>(
		event: `${K}`,
		...params: Parameters<ConnectionHandler[K]>
	): boolean;
	override emit<K extends string>(
		event: `${K}`,
		...params: unknown[]
	): boolean {
		return super.emit(event, ...params);
	}

	/**
	 * Get the current download speed limit for this connection.
	 * @returns {number} - The speed limit in bytes per second.
	 */
	get getSpeed(): number {
		return this.speedLimit;
	}

	/**
	 * Get the current progress of the connection.
	 * @returns {number} - The progress percentage (0-100).
	 */
	get progress(): number {
		return this._progress;
	}

	/**
	 * Log a message related to this connection.
	 * @param {string} message - The log message.
	 */
	log(message: string): void {
		this.emit("log", `[Connection - ${this.index}] ${message}`);
	}

	/**
	 * Start the download process for this connection.
	 * @returns {Promise<boolean>} A promise that resolves to `true` when the download is complete.
	 */
	async start(): Promise<boolean> {
		const connection = this;

		return new Promise(async (resolve, reject) => {
			// Log the start of the download with the speed limit.
			connection.log(
				`Starting download with a limit speed of: ${StreamSpeed.toHuman(
					connection.speedLimit,
					{ timeUnit: "s", precision: 3 },
				)}`,
			);

			// Determine the size of the part that has already been downloaded.
			const partSize =
				fs.existsSync(connection.file) && fs.statSync(connection.file)
					? fs.statSync(connection.file).size
					: 0;

			if (connection.range[0] + partSize >= connection.range[1]) {
				// If the entire part is already downloaded, mark it as finished.
				connection.log("Part is already downloaded");
				connection.emit("finish", true);
				connection.finished = true;
				return resolve(true);
			} else if (partSize > 0) {
				// If only a portion of the part is downloaded, log and continue.
				connection.log(
					"Part already downloaded, but not complete, resuming...",
				);
			}

			// Create a write stream to save the downloaded data.
			const st = fs.createWriteStream(connection.file, { flags: "a" });
			const controller = new AbortController();
			const throttle: Throttle = new OriginalThrottle({ rate: this.getSpeed });
			try {
				// Make a GET request to download the part with a range header to resume.
				const req = await axios({
					method: "GET",
					url: connection.url,
					responseType: "stream",
					headers: {
						Range:
							"bytes=" +
							(connection.range[0] + partSize) +
							"-" +
							connection.range[1],
						"User-Agent":
							"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/53",
					},
					signal: controller.signal,
					onDownloadProgress: (progressEvent) => {
						// Update the download progress and speed.
						connection.speed = progressEvent.rate || 0;
						connection._progress = (progressEvent.progress || 0) * 100;
						connection.totalDownloaded = progressEvent.loaded + partSize;
						if (!connection.stopped)
							connection.log(
								`Downloading ${connection.progress.toFixed(
									2,
								)}% with a speed of ${StreamSpeed.toHuman(connection.speed, {
									timeUnit: "s",
									precision: 3,
								})}`,
							);
					},
				}).catch((e) => {
					// Handle errors during the download.
					if (!["closed", "Premature close", "canceled"].includes(e.message)) {
						connection.log(
							`Stopping Connection ${connection.index} [${e.message}]`,
						);
						connection.log(`Connection ${connection.index} Error:`);
						connection.log(utils.inspect(e, { depth: null }));
					}
					st.close();
					controller.abort();
					connection.emit("destroy");
				});

				if (!req) return;

				// Listen for speed changes and adjust the throttle accordingly.
				connection.Manager.on("speed", (speed: number) => {
					if (!connection.finished) {
						connection.log(
							`Changing speed to: ${StreamSpeed.toHuman(speed, {
								timeUnit: "s",
								precision: 3,
							})}`,
						);
						connection.speedLimit = speed;
						throttle.chunksize = speed;
						if (throttle.bucket) {
							throttle.bucket.bucketSize = speed;
							throttle.bucket.tokensPerInterval = speed;
						}
					}
				});

				const readStream = req.data;

				// Listen for stop events to gracefully stop the download.
				connection.Manager.on("stop", () => {
					if (!connection.stopped && !connection.finished) {
						connection.log(`Stopping Connection ${connection.index}`);
						controller.abort();
						st.close();
						connection.emit("destroy");
						connection.stopped = true;
					}
				});

				// Pipeline the read stream through the throttle and write to the file.
				await pipeline(readStream.pipe(throttle), st);

				// Log and emit a finish event when the download is complete.
				connection.log(`Download finished`);
				connection.emit("finish", true);
				connection.finished = true;
			} catch (e) {
				// Handle errors that may occur during the download.
				const error: Error =
					e instanceof Error
						? e
						: new Error(typeof e == "string" ? e : "internal error");
				if (
					!["closed", "Premature close", "canceled"].includes(error.message)
				) {
					connection.log(
						`Stopping Connection ${connection.index} [${error.message}]`,
					);
					connection.log(`Connection ${connection.index} Error:`);
					connection.log(utils.inspect(error, { depth: null }));
					st.close();
					controller.abort();
					connection.emit("destroy");
				}
			}
		});
	}
}
