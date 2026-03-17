import fs from "fs";
import path from "path";
import os from "os";
import { v4 as uuidv4 } from "uuid";

/**
 * Multer storage engine that keeps small files in memory and
 * streams large files (above `threshold` bytes) to disk.
 *
 * The resulting `req.file` will have:
 *   - `file.buffer`  (Buffer)  when stored in memory
 *   - `file.path`    (string)  when stored on disk
 *   - `file.storage`  "memory" | "disk"
 */
export default class SmartStorage {
  constructor({ threshold, destination } = {}) {
    this.threshold = threshold ?? 25 * 1024 * 1024;
    this.destination = destination || os.tmpdir();
  }

  _handleFile(_req, file, cb) {
    const chunks = [];
    let size = 0;
    let diskPath = null;
    let writeStream = null;
    let flushedToDisk = false;

    file.stream.on("data", (chunk) => {
      size += chunk.length;

      if (!flushedToDisk && size > this.threshold) {
        flushedToDisk = true;
        const ext = path.extname(file.originalname).toLowerCase();
        diskPath = path.join(this.destination, `${uuidv4()}${ext}`);
        writeStream = fs.createWriteStream(diskPath);
        for (const c of chunks) writeStream.write(c);
        chunks.length = 0;
        writeStream.write(chunk);
      } else if (flushedToDisk) {
        writeStream.write(chunk);
      } else {
        chunks.push(chunk);
      }
    });

    file.stream.on("error", (err) => {
      if (writeStream) writeStream.destroy();
      cb(err);
    });

    file.stream.on("end", () => {
      if (flushedToDisk) {
        writeStream.end(() => {
          cb(null, { path: diskPath, size, storage: "disk" });
        });
      } else {
        cb(null, { buffer: Buffer.concat(chunks), size, storage: "memory" });
      }
    });
  }

  _removeFile(_req, file, cb) {
    if (file.path) {
      fs.unlink(file.path, cb);
    } else {
      cb(null);
    }
  }
}
