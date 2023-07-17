// Buffer stuff... reading from incomplete sources, waiting for data to come, etc.

import { PathLike, ReadStream } from "fs";
import { FileHandle, open } from "fs/promises";

import { rootLogger } from "./logger.js";

const logger = rootLogger.child({
    source: "buffer.ts",
});

/**
 * A callback method that allows us to read more data from some source.
 * 
 * If an error is thrown, it will be assumed that the data source has no more data to read
 */
export type DataSource = {
    /**
     * Reads a chunk of data from the source, returning the result as a buffer.
     * 
     * @param count the number of bytes to read. This is merely a suggestion, the source can return a buffer as large or as small as it wants 
     */
    read: (count: number) => Promise<Buffer>,
    /**
     * Signals to the data source that we no-longer need to read any data from it and it may close any resources it had open.
     */
    close: () => Promise<void>,
}

/**
 * Exposes a file at a given path using a DataSource.
 * 
 * The file is not opened until the first call to "read()"
 */
export class FileDataSource implements DataSource {

    private file = null as null | {
        handle: FileHandle,
        readStream: ReadStream,
        itr: AsyncIterableIterator<any>,
    }

    private isClosed = false;

    constructor(private readonly path: PathLike) { }

    async read(): Promise<Buffer> {
        if (this.file === null) {
            const handle = await open(this.path);
            const readStream = handle.createReadStream();
            const itr = readStream[Symbol.asyncIterator]();
            this.file = {
                handle, readStream, itr,
            }
        }

        const chunk = await this.file.itr.next();
        if (chunk.done) {
            await this.close();
            throw new EndOfFileError();
        } else {
            return chunk.value as Buffer;
        }
    }

    async close() {
        if (this.isClosed) return;
        this.isClosed = true;

        if (this.file !== null) {

            const f = this.file;
            await new Promise((res, rej) => {
                f.readStream.close((err) => {
                    if (err) {
                        rej(err);
                    } else {
                        res(undefined);
                    }
                });
            });

            await f.handle.close();
        }
    }
}

/**
 * An error that signals that the file ended before we could read enough of the requested data.
 */
export class EndOfFileError extends Error {

    constructor(readonly remainingData?: Buffer) {
        super("End of file.");
    }
}

/**
 * Bufferer is a class that manages data from an input source that can be called to retrieve new data
 */
export class Bufferer {
    // the current buffer we are reading data from, or null if we've already completely consumed the available data and need to get more
    private buffer: Buffer | null = null;
    // a byte offset into the current buffer that we should start reading data from
    private offset = 0;

    private bytesRead = 0;

    private isClosed = false;

    constructor(private readonly source: DataSource, private readonly isInterrupted = () => false, private readonly bigEndian = true) {
    }

    static from(buffer: Buffer, bigEndian = true) {
        let b: Buffer | null = buffer;

        const ds: DataSource = {
            close() {
                return Promise.resolve();
            },
            read() {
                if (b === null) throw new Error("no more datas");
                else {
                    const data = Promise.resolve(b);
                    b = null;
                    return data;
                }
            }
        }

        return new Bufferer(ds, () => false, bigEndian);
    }

    getPosition() {
        return this.bytesRead;
    }

    async skipTo(offset: number) {
        if (offset < this.bytesRead) {
            throw new Error("Cannot skip to previous point in buffer");
        } else if (offset > this.bytesRead) {
            await this.read(offset - this.bytesRead);
        }
    }

    /**
     * Reads the given number of bytes from the source, fetching additional data as necessary
     * 
     * @param bytes the number of bytes to read. Must be greater than zero and less than buffer.constants.MAX_LENGTH
     * @returns a buffer of the appropriate size containing the requested data
     */
    async read(bytes: number): Promise<Buffer> {
        if (bytes <= 0) {
            throw new Error("cannot read zero or fewer bytes");
        }

        if (this.isClosed) {
            throw new Error("closed");
        }

        const packet = Buffer.allocUnsafe(bytes);
        let writeOffset = 0;

        while (bytes > 0) {
            if (this.isInterrupted()) {
                throw new Error("interrupted while reading from source");
            }


            if (this.buffer === null) {
                try {
                    this.buffer = await this.source.read(bytes);
                } catch (err) {
                    throw new EndOfFileError();
                }
                this.offset = 0;
            }

            // copy some bytes from the saved buffer to the packet
            const endIndex = Math.min(this.buffer.byteLength, this.offset + bytes);
            
            const bytesWritten = this.buffer.copy(packet, writeOffset, this.offset, endIndex);
            this.offset = endIndex;
            bytes -= bytesWritten;
            writeOffset += bytesWritten;

            if (endIndex === this.buffer.byteLength) {
                this.buffer = null;
            }
        }

        this.bytesRead += packet.byteLength;

        return packet;
    }

    /**
     * Reads the next 32-bit signed integer from the source.
     */
    async nextInt() {
        const buf = (await this.read(4));
        if (this.bigEndian) {
            return buf.readInt32BE();
        } else {
            return buf.readInt32LE();
        }
    }

    /**
     * Reads a single 8-bit ascii character from the stream.
     */
    async nextChar() {
        return (await this.read(1)).toString("ascii", 0, 1);
    }

    /**
     * Reads a boolean from the stream. (a one-byte value that is non-zero if true)
     */
    async nextBool() {
        return (await this.read(1)).readInt8() !== 0;
    }

    /**
     * Reads a 32-bit floating point number from the stream.
     */
    async nextFloat() {
        const buf = (await this.read(4));
        if (this.bigEndian) {
            return buf.readFloatBE();
        } else {
            return buf.readFloatLE();
        }
    }

    /**
     * Reads a 64-bit floating point number from the stream
     * @returns 
     */
    async nextDouble() {
        const buf = (await this.read(8));
        if (this.bigEndian) {
            return buf.readDoubleBE();
        } else {
            return buf.readDoubleLE();
        }
    }

    async nextBitField() {
        return this.nextInt();
    }

    async nextString(length: number) {
        const str = (await this.read(length)).toString();
        // fix null terminated shit
        const nul = str.indexOf("\0");
        if(nul > 0) {
            return str.substring(0,nul);
        } else {
            return str;
        }
    }

    async close() {
        if (!this.isClosed) {
            this.isClosed = true;
            await this.source.close();
        }
    }
}

