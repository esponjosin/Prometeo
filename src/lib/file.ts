import EventEmitter from "events";
import fs from "fs";
import Error from "../utils/errors";
import { resolve } from "path";
import URLUtils from "../utils/url";
import Connection from "./connection";
import StreamSpeed from "streamspeed";
import Writer from "../utils/writeStream";
import { mkdirp } from "mkdirp";
import { setTimeout as wait } from "node:timers/promises";
import { FileEvents, FileHandler } from "../types/file.events";

export interface Part {
	[index: number]: [string, [number, number]];
}

export type PartArray = [number, string, [number, number]];

export interface FileOptions {
	url: string;
	path: string;
	name: string;
	size: number;
	parts: Part;
	resumed?: boolean;
	speed: number;
	destination: string;
	contentType: string;
	finished: boolean;
}

export class File extends EventEmitter {
	readonly url: string;
	readonly path: string;
	readonly name: string;
	readonly size: number;
	readonly progress: number;
	readonly parts: Part;
	private logStream: Writer;
	private connections: Connection[];
	private speed: number;
	private inter?: NodeJS.Timeout;
	private contentType: string;
	private stoped: boolean;
	private destination: string;
	private allConfig: FileOptions;

	/**
	 * Represents an ongoing file download with multiple connections.
	 * @param download An object containing download configuration.
	 * @throws {Error} If any of the download configuration properties are invalid.
	 */
	constructor(download: FileOptions) {
		super();

		// Validate the properties of the download.
		if (typeof download.url !== "string" || download.url.trim() === "") {
			throw new Error(
				"InvalidArgumentError",
				"The URL must be a non-empty string.",
			);
		}

		if (typeof download.path !== "string" || download.path.trim() === "") {
			throw new Error(
				"InvalidArgumentError",
				"The path must be a non-empty string.",
			);
		}

		if (
			typeof download.destination !== "string" ||
			download.destination.trim() === ""
		) {
			throw new Error(
				"InvalidArgumentError",
				"The destination must be a non-empty string.",
			);
		}

		if (typeof download.name !== "string" || download.name.trim() === "") {
			throw new Error(
				"InvalidArgumentError",
				"The name must be a non-empty string.",
			);
		}

		if (
			typeof download.contentType !== "string" ||
			download.contentType.trim() === ""
		) {
			throw new Error(
				"InvalidArgumentError",
				"The contentType must be a non-empty string.",
			);
		}

		if (typeof download.size !== "number" || download.size <= 0) {
			throw new Error(
				"InvalidArgumentError",
				"The size must be a positive number.",
			);
		}

		if (typeof download.speed !== "number" || download.speed <= 0) {
			throw new Error(
				"InvalidArgumentError",
				"The speed must be a positive number.",
			);
		}

		if (!fs.existsSync(download.path)) {
			try {
				mkdirp.sync(download.path);
			} catch (e) {
				throw new Error(
					"InternalError",
					"An error occurred while trying to create the temporary folder for the file.",
					e,
				);
			}
		}

		// Store the properties in the private class variables.
		this.url = download.url;
		this.path = download.path;
		this.name = download.name;
		this.destination = download.destination;
		this.size = download.size;
		this.progress = 0;
		this.parts = download.parts;
		this.speed = download.speed;
		this.stoped = false;
		this.allConfig = download;
		this.contentType = download.contentType;
		this.connections = [];
		this.logStream = new Writer(resolve(this.path, "./prometeo.log"), {
			flags: "a",
		});

		// Log download information or restart if resumed.
		if (!download.resumed) {
			this.log(`Starting Download`);
			this.log(`URL: ${this.url}`);
			this.log(`Path: ${this.path}`);
			this.log(`Name: ${this.name}`);
			this.log(`Size: ${this.size}`);
			fs.writeFileSync(
				resolve(this.path, "./prometeo.config"),
				Buffer.from(JSON.stringify(download)).reverse().toString("hex"),
			);
		} else {
			this.log(`Restarting download`);
			this.log(`Revalidating URL`);
			this.revalidateURL().then((val) => {
				if (val) {
					this.log(`URL is valid`);
					this.log(`Download restarted`);
				}
			});
		}
	}

	override on<K extends keyof FileEvents>(
		event: K,
		func: (...args: FileEvents[K]) => void,
	): this;
	override on<K extends string>(
		event: `${K}`,
		func: (...args: unknown[]) => unknown,
	): this {
		const ev = super.on(event, func);

		// @ts-expect-error Eventemitter can sometimes return a listener
		return ev.emitter ? ev.emitter : ev;
	}
	override off<K extends keyof FileEvents>(
		event: `${K}`,
		func: (...args: FileEvents[K]) => void,
	): this;
	override off<K extends keyof FileEvents>(
		event: `${K}`,
		func: (...args: unknown[]) => unknown,
	): this {
		return super.off(event, func);
	}

	override once<K extends keyof FileEvents>(
		event: `${K}`,
		func: (...args: FileEvents[K]) => void,
	): this;
	override once<K extends string>(
		event: `${K}`,
		func: (...args: unknown[]) => unknown,
	): this {
		const ev = super.on(event, func);

		// @ts-expect-error Eventemitter can sometimes return a listener
		return ev.emitter ? ev.emitter : ev;
	}

	override emit<K extends keyof FileEvents>(
		event: `${K}`,
		...params: Parameters<FileHandler[K]>
	): boolean;
	override emit<K extends string>(
		event: `${K}`,
		...params: unknown[]
	): boolean {
		return super.emit(event, ...params);
	}

	/**
	 * Revalidates the URL of the ongoing download to ensure its validity and availability.
	 * @returns A promise that resolves to `true` if the URL is valid and available; otherwise, it resolves to `false`.
	 */
	private async revalidateURL(): Promise<boolean> {
		// Validate the URL.
		const URLData = URLUtils.validate(this.url);

		if (!URLData) {
			this.log(`Invalid URL: ${this.url}`);
			this.log(`Stopping Download`);
			return false;
		}

		// Check if the URL is accessible.
		const Metadata = await URLUtils.getData(this.url)
			.then(() => true)
			.catch(() => false);

		return Metadata;
	}

	/**
	 * Set the download speed limit for the ongoing file download.
	 * @param speed The desired download speed limit in MBps (megabytes per second).
	 */
	setSpeed(speed: number) {
		// Validate the speed.
		if (isNaN(speed)) {
			throw new Error(
				"InvalidArgumentError",
				"The speed must be a positive number.",
			);
		}

		// Update the download speed limit.
		this.speed = speed;

		// Emit the 'speed' event with the updated speed for each connection.
		this.emit("speed", speed / this.connections.length);
	}

	/**
	 * Logs a message to the download log stream with a timestamp.
	 * @param message The message to be logged.
	 */
	private log(message: string) {
		// Write the message with a timestamp to the download log stream.
		this.logStream.write(`${new Date().toISOString()} - ${message}\n`);
	}

	/**
	 * Stops the ongoing file download and ensures any pending log writes are completed.
	 * @returns A promise that resolves to `true` when the download is stopped and all log writes are finished.
	 */
	async stop() {
		const file = this;

		// Mark the download as stopped.
		this.stoped = true;

		return new Promise((resolve, reject) => {
			// Wait for pending log writes to complete.
			file.logStream.on("writed", () => {
				if (file.logStream.pendingWrites === 0) resolve(true);
			});

			// Emit the 'stop' event to signal download stop.
			this.emit("stop");

			// Set a timeout to ensure resolution if log writes don't complete within 1 second.
			setTimeout(() => {
				if (file.logStream.pendingWrites === 0) resolve(true);
			}, 1000);
		});
	}

	/**
	 * Initiates the download of file parts, manages progress updates, and resolves when the download is completed.
	 * @returns A promise that resolves when the download is completed or rejects on certain errors.
	 */
	async start() {
		const File = this;

		return new Promise(async (resolve, reject) => {
			const Download = this;
			let waitingLog = false;

			// Log download start and speed limit.
			Download.log(
				`Starting file parts download with a speed limit of ${StreamSpeed.toHuman(
					Math.round(Download.speed),
					{ timeUnit: "s", precision: 3 },
				)}`,
			);
			Download.emit("start");

			// Set an interval to monitor download progress and emit progress events.
			File.inter = setInterval(() => {
				const connections = Download.connections.filter((c) => !c.finished);

				if (Download.connections.length === 0) {
					// If all connections are finished, resolve the promise.
					if (!waitingLog) {
						Download.logStream.on("finish", () => {
							clearInterval(File.inter);
							resolve(false);
						});
						waitingLog = true;
					}
				} else if (connections.length) {
					// Calculate and emit download progress.
					const progress = Math.round(
						connections.reduce((a, b) => a + b.progress, 0) /
							connections.length,
					);
					const totalDownloaded = Download.connections.reduce(
						(a, b) => a + b.totalDownloaded,
						0,
					);
					const speed = Math.round(
						connections.reduce((a, b) => a + b.speed, 0),
					);

					this.emit(
						`progress`,
						StreamSpeed.toHuman(speed, { timeUnit: "s", precision: 3 }),
						progress > 100 ? 100 : progress,
						Math.round(
							Download.calculateTime(speed, Download.size, totalDownloaded),
						),
					);
				}
			}, 500);

			// Create the download directory if it doesn't exist.
			if (!fs.statSync(this.path).isDirectory()) fs.mkdirSync(this.path);

			// Validate the URL.
			const URLData = URLUtils.validate(this.url);
			if (!URLData) {
				this.log(`Invalid URL: ${this.url}`);
				this.log(`Stopping Download`);
				throw new Error(
					"BadURLError",
					"The URL is invalid",
					`The argument sent was ${this.url} a correct URL was needed`,
				);
			}

			// Start connections for each file part.
			for (const part of Object.entries(this.parts)) {
				const connection = new Connection(Download, {
					speed: Download.speed / Object.entries(this.parts).length,
					url: Download.url,
					part: [Number(part[0]), part[1][0], part[1][1]],
					contentType: Download.contentType,
				});

				connection.on("log", (msg) => {
					Download.log(msg);
				});

				connection.on("destroy", () => {
					Download.log(`Connection ${Number(part[0])} destroyed`);
					Download.connections = Download.connections.filter(
						(c) => c !== connection,
					);
				});

				this.connections.push(connection);
				connection.start();
			}

			// Wait for the download to complete and resolve the promise with the downloaded file information.
			const file = await Download.observer();
			resolve(file);
		});
	}

	/**
	 * Calculates the estimated time (in milliseconds) required to complete a download.
	 * @param bytes The number of bytes downloaded per second (download speed).
	 * @param size The total size of the file to be downloaded in bytes.
	 * @param downloaded The total number of bytes already downloaded.
	 * @returns The estimated time in milliseconds required to complete the download.
	 */
	calculateTime(bytes: number, size: number, downloaded: number): number {
		// Calculate the bytes left to download.
		const sizeLeft = size - downloaded;

		// Calculate the estimated time in seconds.
		const estimatedTime = sizeLeft / bytes;

		// Convert the estimated time to milliseconds.
		const ms = estimatedTime * 1000;

		return ms;
	}

	/**
	 * Monitors the progress of individual file part downloads and resolves when the download is completed.
	 * @param prevValue (Optional) The previous value indicating the number of finished connections.
	 * @returns A promise that resolves to the path of the downloaded file or rejects on errors.
	 */
	observer(prevValue?: number): Promise<string> {
		const Download = this;

		return new Promise(async (res, reject) => {
			// Get the list of connections that are not finished.
			const finished = Download.connections.filter((c) => !c.finished);

			// Check if all connections are finished and the download is not stopped.
			if (finished.length === 0 && !Download.stoped) {
				clearInterval(Download.inter);

				// Log download completion and emit 'finished' event.
				Download.log(`File download finished`);
				Download.emit("finish");

				// Log the process of joining parts to form the original file.
				Download.log(`Joining parts to form the original file`);

				// Compose the file from its parts and handle errors if any.
				const file = await Download.composeFile(
					Download.parts,
					Download.destination,
				).catch((e) => e);

				if (file instanceof Error) {
					// Log and reject in case of an error while joining parts.
					Download.log(`Error while joining parts: ${file.message}`);
					reject(file);
				} else {
					// Log successful file joining and cleanup.
					Download.log(`File joined successfully`);
					Download.log(`Cleaning up`);

					// Perform cleanup and resolve with the path of the downloaded file.
					await Download.cleanup();
					res(file);
				}
			} else {
				if (prevValue !== finished.length) {
					// Emit the 'speed' event with the updated speed based on the number of finished connections.
					Download.emit("speed", Download.speed / finished.length);
				}

				// Wait for a short duration and recursively call the observer to check progress.
				await wait(100);
				resolve(await Download.observer(finished.length));
			}
		});
	}

	/**
	 * Cleans up resources after the download is completed or canceled.
	 * @returns A promise that resolves to `true` when cleanup is successful or rejects on errors.
	 */
	cleanup() {
		return new Promise((res, reject) => {
			// Stop the log stream.
			this.logStream.stop();

			try {
				// Remove the download directory and its contents.
				fs.rmSync(this.path, { recursive: true, force: true });
			} catch (e) {
				if (fs.existsSync(this.path)) {
					// If the directory still exists, mark the download as finished and save its configuration.
					this.allConfig.finished = true;
					fs.writeFileSync(
						resolve(this.path, "./prometeo.config"),
						Buffer.from(JSON.stringify(this.allConfig))
							.reverse()
							.toString("hex"),
					);
				}
			}

			// Resolve with `true` to indicate successful cleanup.
			res(true);
		});
	}

	/**
	 * Composes the downloaded file from its individual parts and saves it to the specified path.
	 * @param parts An object containing information about individual file parts.
	 * @param path The path where the composed file will be saved.
	 * @returns A promise that resolves to the path of the composed file or rejects on errors.
	 */
	composeFile(parts: Part, path: string): Promise<string> {
		const Download = this;

		return new Promise(async (res, reject) => {
			// Convert the 'parts' object to an array and sort it based on part numbers.
			const partsArray = Object.entries(parts);

			// Create a write stream to save the composed file.
			const stream = fs.createWriteStream(path, { flags: "a" });

			stream.on("error", (err) => {
				// Reject the promise in case of an error.
				reject(err);
			});

			// Iterate through and append each file part to the composed file.
			for (let file of partsArray.sort((a, b) => Number(a[0]) - Number(b[0]))) {
				file = file[1];

				// Log the process of joining the file part.
				Download.log(`Joining part ${file[0]}`);

				// Create a read stream for the file part.
				const fileContent = fs.createReadStream(file[1][0]);

				// Pipe the file content to the composed file stream, with 'end' set to false.
				fileContent.pipe(stream, { end: false });

				// Wait for the file content stream to end and then remove the file part.
				await new Promise((resolve, reject) => {
					fileContent.on("end", () => {
						resolve(path);
						fs.rmSync(file[1][0]);
					});
				});
			}

			// Close the composed file stream.
			stream.close();

			stream.on("close", () => {
				// Resolve with the path of the composed file.
				res(path);
			});
		});
	}

	/**
	 * Validates and reads download configuration data from a specified directory.
	 * @param path The path to the directory containing the download configuration.
	 * @returns A Download object representing the validated configuration, or `undefined` if validation fails.
	 */
	static validate(path: string): FileOptions | undefined {
		// Check if the specified path is not a directory, and return undefined.
		if (!fs.statSync(path).isDirectory()) {
			return undefined;
		}

		try {
			// Read and parse the download configuration data from the 'prometeo.config' file.
			const data = Buffer.from(
				fs.readFileSync(path + "/prometeo.config").toString("utf-8"),
				"hex",
			)
				.reverse()
				.toString("utf-8");
			const json: FileOptions = JSON.parse(data);

			return json;
		} catch (error) {
			// Handle any errors that occur during validation and return undefined.
			return undefined;
		}
	}
}
