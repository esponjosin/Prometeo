import Error from "./errors";
import path from "path";
import crypto from "crypto";

interface URLData {
	fileType: string;
	size: number;
	acceptRange: boolean;
	fileName: string;
	contentType: string;
}

export default class {
	static validate(url: string) {
		try {
			new URL(url);
			return true;
		} catch (err) {
			return false;
		}
	}

	static isValidFileName(filename: string) {
		const patron = /^[a-zA-Z0-9\.\-\_]+$/;

		return patron.test(filename);
	}

	static generateFilename(ext: string) {
		return crypto.randomBytes(16).toString("hex") + ext;
	}

	static getFileName(url: string, data: Response) {
		const contentDisposition = data.headers.get("content-disposition");

		if (contentDisposition) {
			const matches = contentDisposition.match(/filename="(.+)"/);
			if (matches) {
				const nombreDelArchivo = matches[1];
				return nombreDelArchivo;
			}
		}

		const urlParts = url.split("/");
		const fileName = urlParts[urlParts.length - 1];

		return fileName;
	}

	static getFileType(url: string, data: Response) {
		const header = data.headers.get("content-type");

		if (!header) return ".unknow";

		const partes = header.split(";");

		const contentTypeParte = partes[0].trim();

		const tipoDeArchivo = contentTypeParte.split("/").pop();

		const fileType =
			path.extname(new URL(url).pathname).length > 0
				? path.extname(new URL(url).pathname)
				: tipoDeArchivo || "unknow";

		return `.${fileType.replace(".", "")}`;
	}

	static async getData(url: string): Promise<URLData> {
		const res = await fetch(url, {
			method: "HEAD",
		});

		if (!res.ok) {
			throw new Error(
				"InvalidArgumentError",
				"The url entered returned an incorrect response",
				`The argument sent was ${url} a file url was needed`,
			);
		}

		const contentType = res.headers.get("content-type") ?? "";
		let size = Number(res.headers.get("content-length"));
		size = isNaN(size) ? 0 : Number(size);
		const acceptRange = res.headers.get("accept-ranges") == "bytes";
		const fileType = this.getFileType(url, res);
		const fileName = this.getFileName(url, res);

		return {
			fileType,
			size,
			acceptRange,
			fileName,
			contentType,
		};
	}
}
