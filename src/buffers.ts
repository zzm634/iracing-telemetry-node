// Buffer stuff... reading from incomplete sources, waiting for data to come, etc.

import { PathLike, ReadStream } from "fs";
import { FileHandle, open } from "fs/promises";

import { rootLogger } from "./logger.js";

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

    /** Skips ahead the given number of bytes. Unlike `read` this number needs to be accurate. The next call to `read` should start the given number of bytes after the end of the buffer returned from the last call to `read` */
    skip?: (count: number) => Promise<void>,

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

    private static LOGGER = rootLogger.child({ class: "FileDataSource" });

    private file = null as null | {
        handle: FileHandle,
        readStream: ReadStream,
        itr: AsyncIterableIterator<any>,
    }

    private isClosed = false;
    private bufferPosition = 0;

    constructor(private readonly path: PathLike) { }

    private async openFileAt(offset = 0) {
        if (this.file !== null) {
            await this.closeFile();
        }
        if (FileDataSource.LOGGER.isDebugEnabled()) {
            FileDataSource.LOGGER.debug(`opening file at ${offset}: ${this.path}`);
        }
        const handle = await open(this.path);
        const readStream = handle.createReadStream({
            start: offset,
        });
        const itr = readStream[Symbol.asyncIterator]();
        return {
            handle, readStream, itr,
        }
    }

    private async closeFile() {
        if (this.file !== null) {
            FileDataSource.LOGGER.debug("closing file: " + this.path);
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
        } else {
            FileDataSource.LOGGER.debug("file already closed.");
        }
    }

    async read(): Promise<Buffer> {
        if (this.isClosed) {
            throw new Error("File data source is closed");
        }

        if (this.file === null) {
            this.file = await this.openFileAt();
        }

        const chunk = await this.file.itr.next();
        if (chunk.done) {
            await this.close();
            throw new EndOfFileError();
        } else {
            const buf = chunk.value as Buffer;
            this.bufferPosition += buf.byteLength;
            if (FileDataSource.LOGGER.isDebugEnabled()) {
                FileDataSource.LOGGER.debug(`read ${buf.byteLength} bytes.`);
            }
            return buf;
        }
    }

    async skip(count: number): Promise<void> {
        if (this.isClosed) {
            throw new Error("File data source is closed");
        }

        // Close the file and re-open it starting at the desired point in the stream
        if (this.file !== null) {
            await this.closeFile();
        }

        const targetOffset = this.bufferPosition + count;
        this.file = await this.openFileAt(targetOffset);
        this.bufferPosition = targetOffset;
    }


    async close() {
        if (this.isClosed) return;
        this.isClosed = true;

        this.closeFile();
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
 * Bufferer is a class that manages data from an input source that can be called to retrieve new data.
 * 
 * Bufferer reads arbitrary-sized chunks of data from an asynchronous data source, fulfilling requests for data and retrieving new data as necessary. Bufferers can only move forward in the data source, they cannot be re-opened.  Bufferers are not "thread safe" in this regard.
 */
export class Bufferer {
    // the current buffer we are reading data from, or null if we've already completely consumed the available data and need to get more
    private buffer: Buffer | null = null;
    // a byte offset into the current buffer that we should start reading data from
    private offset = 0;

    private bytesRead = 0;

    private isClosed = false;

    /**
     * Creates a new Bufferer
     * @param source the source to read data from
     * @param isInterrupted a callback method that can be used to check if this bufferer has been interrupted and should stop producing data. Note that this will not actually interrupt ongoing reads, it will just stop future reads from completing.
     * @param bigEndian true if the values in the data source are big-endian (largest byte first), false if they are little-endian
     */
    constructor(private readonly source: DataSource, private readonly isInterrupted = () => false, private readonly bigEndian = true) {
    }

    /**
     * Creates a new Bufferer from the given Buffer.
     * 
     * @param buffer the buffer to read data from
     * @param bigEndian whether the values are big-endian
     * @returns a new Bufferer
     */
    static from(buffer: Buffer, bigEndian = true) {

        let b: Buffer | null = buffer;

        // create a data source that returns the buffer on the first call, and null on all subsequent calls
        const ds: DataSource = {
            close() {
                b = null;
                return Promise.resolve();
            },
            read() {
                if (b === null) return Promise.reject(new EndOfFileError());
                else {
                    const data = Promise.resolve(b);
                    b = null;
                    return data;
                }
            }
        }

        return new Bufferer(ds, () => false, bigEndian);
    }

    /**
     * @returns The current byte offset into the data source. (aka, the number of bytes read)
     */
    getPosition() {
        return this.bytesRead;
    }

    // max bytes to skip at a time if the source does not provide a "skip" method
    private static SKIP_BUFFER_SIZE = 64 * 1024;

    // calls to skip data less than this number of bytes will be handled by reading and discarding instead
    private static MIN_SKIP_SIZE = 64 * 1024 * 8;

    /**
     * Skips ahead the given number of bytes
     * @param bytes the number of bytes to discard
     */
    async skip(bytes: number) {
        await this.skipTo(this.bytesRead + bytes);
    }

    /**
     * Skips ahead in the data source to the given position
     * @param offset the position within the data source to skip to (in bytes)
     */
    async skipTo(offset: number) {
        if (offset < this.bytesRead) {
            throw new Error("Cannot skip to previous point in buffer");
        }

        if (this.isClosed) {
            throw new Error("Closed");
        }

        let bytesToSkip = offset - this.bytesRead;

        // consume from the remaining buffer, if there is one
        if (this.buffer !== null) {
            // if there is data remaining in the buffer, consume it first
            const bytesLeftInBuffer = this.buffer.byteLength - this.offset;
            if (bytesLeftInBuffer > bytesToSkip) {
                // if there's more bytes in the buffer than we need to skip, we can just move our offset up
                this.offset += bytesToSkip;
                this.bytesRead += bytesToSkip;
                return;
            } else {
                // consume the rest of the buffer
                bytesToSkip -= bytesLeftInBuffer;
                this.bytesRead += bytesLeftInBuffer;
                this.buffer = null;
                this.offset = 0;
            }
        }

        await this.checkState();

        // if the source supports native skipping, use it
        if (this.source.skip && bytesToSkip > Bufferer.MIN_SKIP_SIZE) {
            await this.source.skip(bytesToSkip);
            this.bytesRead += bytesToSkip;
            return;
        }

        // otherwise, skip by reading chunks of the file at a time and not doing anything with it
        while (bytesToSkip > 0) {
            const bytesToDiscard = Math.min(Bufferer.SKIP_BUFFER_SIZE, bytesToSkip);
            await this.read(bytesToDiscard);
            bytesToSkip -= bytesToDiscard;
        }
    }

    /**
     * Make sure it's OK to proceed, i.e., we're not closed and haven't been interrupted
     */
    private async checkState() {
        if (this.isClosed) {
            throw new Error("Closed");
        }

        if (this.isInterrupted()) {
            await this.close();
            throw new Error("Interrupted");
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

        await this.checkState();

        const packet = Buffer.allocUnsafe(bytes);
        let writeOffset = 0;

        while (bytes > 0) {
            await this.checkState();

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
        if (nul > 0) {
            return str.substring(0, nul);
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

