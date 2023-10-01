import { EventEmitter } from "node:events";
import Error from "../utils/errors";
import { File, Part } from "./file";
import fs from "fs";
import { extname, resolve } from "path";
import URLUtils from "../utils/url";
import { tmpdir } from "os";
import { mkdirp } from "mkdirp";
import { PrometeoEvents, PrometeoHandler } from "../types/manager.events";

// Default values for Prometeo options.
const defaultProps = {
	connections: 4,
	tempdir: resolve(
		process.env.APPDATA || process.env.HOME || tmpdir(),
		"Prometeo",
	),
	userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit",
	speedLimit: 10,
};

// Interface defining options that can be provided to the Prometeo constructor.
export interface PrometeoOptions {
	connections?: number; // Number of simultaneous connections.
	tempdir?: string; // Temporary directory for downloads.
	userAgent?: string; // User agent for requests.
	speedLimit?: number; // Speed limit in MBps (megabytes per second).
}

// The main Prometeo class that extends EventEmitter.
export default class Prometeo extends EventEmitter {
	// Read-only properties to store options and configuration.
	readonly connections: number;
	readonly tempDir: string;
	readonly userAgent: string;
	private speedLimit: number;

	// Array to store ongoing downloads.
	private downloads: File[];

	/**
	 * Constructor for the Prometeo class.
	 * @param options Configuration options for Prometeo.
	 */
	constructor(options: PrometeoOptions = {}) {
		super();

		if(typeof options !== 'object') {
			throw new Error(
				'InvalidArgumentError',
				'Prometeo constructor requires an object argument.'
			)
		}

		// Validate and configure Prometeo options.
		this._validateOptions(options);

		// Assign option values to instance properties.
		this.connections = options.connections || defaultProps.connections;
		this.tempDir = options.tempdir || defaultProps.tempdir;
		this.userAgent = options.userAgent || defaultProps.userAgent;
		this.speedLimit = (options.speedLimit || defaultProps.speedLimit) * 125000; // Convert to bytes per second.
		this.downloads = [];

		// Load pending downloads on instance start.
		this._loadDownloads_();

		// Set up exit and SIGINT event handlers.
		this._setupExitHandlers_();
	}

	override on<K extends keyof PrometeoEvents>(
		event: `${K}`,
		func: (...args: PrometeoEvents[K]) => void,
	): this;
	override on<K extends string>(
		event: `${K}`,
		func: (...args: unknown[]) => unknown,
	): this {
		const ev = super.on(event, func);

		// @ts-expect-error Eventemitter can sometimes return a listener
		return ev.emitter ? ev.emitter : ev;
	}
	override off<K extends keyof PrometeoEvents>(
		event: `${K}`,
		func: (...args: PrometeoEvents[K]) => void,
	): this;
	override off<K extends keyof PrometeoEvents>(
		event: `${K}`,
		func: (...args: unknown[]) => unknown,
	): this {
		return super.off(event, func);
	}

	override once<K extends keyof PrometeoEvents>(
		event: `${K}`,
		func: (...args: PrometeoEvents[K]) => void,
	): this;
	override once<K extends string>(
		event: `${K}`,
		func: (...args: unknown[]) => unknown,
	): this {
		const ev = super.on(event, func);

		// @ts-expect-error Eventemitter can sometimes return a listener
		return ev.emitter ? ev.emitter : ev;
	}

	override emit<K extends keyof PrometeoEvents>(
		event: `${K}`,
		...params: Parameters<PrometeoHandler[K]>
	): boolean;
	override emit<K extends string>(
		event: `${K}`,
		...params: unknown[]
	): boolean {
		return super.emit(event, ...params);
	}

	/**
	 * Sets up exit and SIGINT (Ctrl+C) event handlers to handle cleanup and graceful termination of downloads.
	 */
	private _setupExitHandlers_() {
		let stopping: boolean | Promise<unknown[]> = false;

		// Handle the 'exit' event to stop downloads before exiting the process.
		process.on("exit", async () => {
			if (stopping) {
				await stopping;
				return;
			}
			if (!stopping) this.downloads.forEach((download) => download.stop());
		});

		// Handle the 'SIGINT' (Ctrl+C) event to stop downloads and exit the process gracefully.
		process.on("SIGINT", async () => {
			if (stopping) return;
			stopping = Promise.all(this.downloads.map((download) => download.stop()));
			await stopping;
			process.exit(1);
		});
	}

	/**
	 * Validates the options provided for configuring the Prometeo instance.
	 * @param options The options object to validate.
	 * @throws {Error} If any of the provided options are invalid.
	 */
	private _validateOptions(options: PrometeoOptions) {
		// Validate the number of connections.
		if (
			options.connections &&
			(typeof options.connections !== "number" || options.connections <= 0)
		) {
			throw new Error(
				"InvalidArgumentError",
				"The number of connections must be a positive integer.",
				`The argument sent was ${options.connections}, and a number greater than 0 was needed.`,
			);
		}

		// Validate the temporary directory path.
		if (
			options.tempdir &&
			(typeof options.tempdir !== "string" || options.tempdir.trim() === "")
		) {
			throw new Error(
				"InvalidArgumentError",
				"The temporary directory (tempdir) must be a non-empty string.",
				`The argument sent was ${options.tempdir}, and a directory path was needed.`,
			);
		}

		// Ensure that the temporary directory exists or attempt to create it.
		if (
			options.tempdir &&
			(!fs.existsSync(options.tempdir) ||
				!fs.statSync(options.tempdir).isDirectory())
		) {
			try {
				fs.mkdirSync(options.tempdir);
			} catch (e) {
				throw new Error(
					"InvalidArgumentError",
					"Check the temporary storage address. An error occurred while trying to create the directory.",
					e,
				);
			}
		}

		// Validate the user agent string.
		if (
			options.userAgent &&
			(typeof options.userAgent !== "string" || options.userAgent.trim() === "")
		) {
			throw new Error(
				"InvalidArgumentError",
				"The user agent (userAgent) must be a non-empty string.",
				`The argument sent was ${options.userAgent}, and a user agent was needed.`,
			);
		}

		// Validate the speed limit.
		if (
			options.speedLimit &&
			(typeof options.speedLimit !== "number" || options.speedLimit <= 0)
		) {
			throw new Error(
				"InvalidArgumentError",
				"The speed limit must be a positive number.",
				`The argument sent was ${options.speedLimit}, and a number greater than 0 was needed.`,
			);
		}
	}

	/**
	 * Load pending downloads from the temporary directory.
	 * Scans the temporary directory for partially completed downloads and resumes them.
	 * Additionally, removes invalid or completed downloads from the directory.
	 */
	private _loadDownloads_() {
		// Read the list of folders in the temporary directory.
		const folders = fs.readdirSync(this.tempDir);

		for (const folder of folders) {
			// Build the full path to the folder.
			const folderPath = resolve(this.tempDir, folder);

			// Validate and retrieve data about the download from the folder.
			const data = File.validate(folderPath);

			// Check if the download data is valid and if the download is not finished.
			if (data && !data.finished) {
				// Create a new File instance for the download and mark it as resumed.
				const file = new File(
					Object.assign(data, { resumed: true, speed: this.speedLimit }),
				);

				// Add the resumed download to the downloads array.
				this.downloads.push(file);

				// Emit a 'download' event to notify listeners about the resumed download.
				this.emit("download", file);
			} else {
				// If the download is invalid or already finished, attempt to remove it from the directory.
				try {
					fs.rmSync(folderPath, { recursive: true, force: true });
				} catch (e) {
					// Handle errors that may occur during the removal process.
				}
			}
		}
	}

	/**
	 * Initiates a new download from the provided URL to the specified destination path.
	 * @param url The URL of the file to download.
	 * @param path The destination path where the file will be saved.
	 * @param filename Optional. The desired filename for the downloaded file.
	 * @returns A Promise that resolves to a File object representing the ongoing download.
	 * @throws {Error} If the URL, filename, or path is invalid, or if the download encounters an error.
	 */
	async download(options: {url: string, path: string, filename?: string}): Promise<File> {
		// Validate the URL, filename, and path parameters.
		if (typeof options.url !== "string" || options.url.length === 0) {
			throw new Error(
				"InvalidArgumentError",
				"The URL must be a non-empty string.",
			);
		}

		if (options.filename && (typeof options.filename !== "string" || options.filename.length === 0)) {
			throw new Error(
				"InvalidArgumentError",
				"The filename must be a non-empty string.",
			);
		}

		if (typeof options.path !== "string" || options.path.length === 0) {
			throw new Error(
				"InvalidArgumentError",
				"The path must be a non-empty string.",
			);
		}

		// Validate the URL for correctness.
		if (!URLUtils.validate(options.url)) {
			throw new Error("BadURLError", "The URL is invalid.");
		}

		// Retrieve data about the URL, such as its size and content type.
		const URLData = await URLUtils.getData(options.url).catch(
			(e) =>
				new Error("BadURLError", "The URL returned an incorrect answer.", e),
		);

		// Handle any errors that occur during URL data retrieval.
		if (URLData instanceof Error) {
			throw URLData;
		}

		// Check if the URL accepts range requests.
		if (!URLData.acceptRange) {
			throw new Error("BadURLError", "The URL does not accept range requests.");
		}

		// Create the destination folder if it doesn't exist.
		if (!fs.existsSync(options.path)) {
			try {
				mkdirp.sync(options.path);
			} catch (e) {
				throw new Error(
					"InternalError",
					"An error occurred while trying to create the temporary folder for the file.",
					e,
				);
			}
		}

		// Determine the file type and final name of the downloaded file.
		const fileType = options.filename ? extname(options.filename) : URLData.fileType;
		let finalName = options.filename || URLData.fileName;

		// Generate a valid filename if the current name is not valid.
		if (!URLUtils.isValidFileName(finalName)) {
			finalName = URLUtils.generateFilename(fileType);
		}

		// Construct the temporary directory path.
		const tempDir = resolve(this.tempDir, finalName.replace(fileType, ""));

		// Build the final path for the downloaded file.
		options.path = resolve(options.path, finalName);

		// Check if a file with the same name already exists at the destination path.
		if (fs.existsSync(options.path) && fs.statSync(options.path).isFile()) {
			throw new Error(
				"InvalidArgumentError",
				"The path already exists. Delete the file or rename it.",
			);
		}

		// Calculate the number of parts based on the specified connections.
		const connections = this.connections;

		// Calculate the start and end bytes for each part of the download.
		const parts: Part = Object.fromEntries(
			[...new Array(connections)].map((x, i) => {
				const size = URLData.size;
				const sliceSize = Math.floor(size / connections);
				const startByte = i * sliceSize;
				const endByte =
					i === connections - 1 ? size - 1 : startByte + sliceSize - 1;
				const currentRange = [startByte, endByte];
				const part = [i, [resolve(tempDir, `${finalName}${i}`), currentRange]];
				return part;
			}),
		);

		// Create a new File instance representing the download.
		const file = new File({
			url: options.url,
			path: tempDir,
			name: finalName,
			size: URLData.size,
			parts: parts,
			destination: options.path,
			speed: this.speedLimit,
			contentType: URLData.contentType,
			finished: false,
		});

		// Add the download to the list of ongoing downloads.
		this.downloads.push(file);

		// Emit a 'download' event to notify listeners about the new download.
		this.emit("download", file);

		// Return the File object representing the ongoing download.
		return file;
	}

	/**
	 * Retrieve a File object representing an ongoing download based on specified criteria.
	 * @param query An object containing optional criteria for filtering downloads.
	 * @returns A File object representing the ongoing download that matches the criteria, or undefined if no match is found.
	 */
	getDownload(query: { filename?: string; url?: string }): File | undefined {
		return this.downloads.find((file) => {
			return (
				(query.filename && file.name === query.filename) ||
				(query.url && file.url === query.url)
			);
		});
	}

	/**
	 * Set the download speed limit for ongoing downloads.
	 * @param speed The desired download speed limit in MBps (megabytes per second).
	 * @throws {Error} If the provided speed is not a positive number.
	 */
	setSpeed(speed: number) {
		if (typeof speed !== "number" || speed <= 0) {
			throw new Error(
				"InvalidArgumentError",
				"The speed limit must be a positive number.",
				`The argument sent was ${speed}, and a number greater than 0 was needed.`,
			);
		}

		// Convert the speed limit to bytes per second.
		this.speedLimit = speed * 125000;

		// Update the speed limit for each ongoing download.
		this.downloads.forEach((download) => {
			download.setSpeed(speed * 125000);
		});
	}
}
