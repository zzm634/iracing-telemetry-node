// Buffer stuff... reading from incomplete sources, waiting for data to come, etc.

import { PathLike, ReadStream } from "fs";
import { FileHandle, open } from "fs/promises";

import { rootLogger } from "./logger";
/**
 * A DataSource is a forward-moving, asynchronous provider of data buffers. Data sources can provide as much or as little data as they want when a request comes in for more data.
 *
 * DataSource implementations do not need to be "thread safe"; it is okay for a data source to assume that it will not get another `read` request for more data until the last promise it returned from `read` has resolved.
 *
 * After a data source has fully consumed all of its data, the next call to `read` or `skip` should throw an EndOfFileError to signal that there is no more data to read.
 *
 * When a consumer is finished reading data from a DataSource, it must call the `close` method. DataSource implementations are allowed to automatically close themselves after they've produced all the data they can, but are not required to. Calling `close` on an already closed data source should have no effect.
 */
export type DataSource = {
  /**
   * Reads a chunk of data from the source, returning the result as a buffer.
   *
   * @param count the number of bytes to read. This is merely a hint from the consumer about how much data it expects to consume; the source can return a buffer as large or as small as it wants, as long as it returns a buffer with some data in it.
   *
   * @throws EndOfFileError if there is no more data to read from.
   */
  read: (count?: number) => Promise<Buffer>;

  /**
   * Skips ahead the given number of bytes. Unlike `read` this number needs to be accurate. The next call to `read` should start the given number of bytes after the end of the buffer returned from the last call to `read`
   *
   * This is an optional method; consumers using a DataSource that has not implemented `skip` should use `read` instead to receive and discard data.
   *
   * @param count the number of bytes to discard
   *
   * @throws EndOfFileError if there is no more data to skip, or if the number of bytes requested to skip is greater than the number of bytes left in the data source.
   */
  skip?: (count: number) => Promise<void>;

  /**
   * Signals to the data source that we no longer need to read any data from it and it may close any resources it had open.
   */
  close: () => Promise<void>;
};

/**
 * Exposes a file at a given path using a DataSource.
 *
 * The file is not opened until the first call to "read()"
 */
export class FileDataSource implements DataSource {
  private static LOGGER = rootLogger.child({ class: "FileDataSource" });

  /**
   * Resources based on the open file which must be cleaned up when the data source is closed
   */
  private file = null as null | {
    /** an open handle to the file at the target path */
    handle: FileHandle;
    /** an open read stream to the file that should be closed when we're done with it */
    readStream: ReadStream;
    /** an iterator produced from the read stream that we can use to return chunks of data from the file */
    itr: AsyncIterableIterator<Buffer>;
  };

  /**
   * True if the data source has been closed
   */
  private isClosed = false;

  /**
   * The total number of bytes we've read into the file
   */
  private bufferPosition = 0;

  /**
   * Creates a new FileDataSource that exposes data from the file at the given path.
   *
   * @param path
   */
  constructor(private readonly path: PathLike) {}

  /**
   * Closes (if necessary) and re-opens the file, skipping ahead to the given offset
   *
   * @param offset The number of bytes at the start of the file to skip (default: 0)
   * @return a non-null handle to this.file
   */
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

    // should be returning Buffers since we did not provide an encoding to createReadStream
    const itr = readStream[
      Symbol.asyncIterator
    ]() as AsyncIterableIterator<Buffer>;

    const f = {
      handle,
      readStream,
      itr,
    };
    this.file = f;
    return f;
  }

  /**
   * Closes file, if open.
   */
  private async closeFile() {
    if (this.file !== null) {
      FileDataSource.LOGGER.debug("closing file: " + this.path);
      const f = this.file;
      f.readStream.destroy();
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
      await this.openFileAt();
    }

    const chunk = await this.file!.itr.next();
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

    await this.closeFile();
  }
}

// export class MemoryMapDataSource implements DataSource {
//   private done = false;
//   constructor(private readonly mmapFileName: string) {}
//   async read() {
//     if (this.done) {
//       throw new EndOfFileError();
//     } else {
//       this.done = true;
//       return await readMemoryMappedFile(this.mmapFileName);
//     }
//   }
//   close() {
//     return Promise.resolve();
//   }
// }

export class BufferDataSource implements DataSource {
  private done = false;
  constructor(private readonly buffer: Buffer) {}
  read() {
    if (this.done) {
      return Promise.reject(new EndOfFileError());
    } else {
      this.done = true;
      return Promise.resolve(this.buffer);
    }
  }

  async close() {}
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
 * Bufferer reads arbitrary-sized chunks of data from an asynchronous data source, fulfilling requests for data and retrieving new data as necessary. Bufferers are not thread safe in this regard.
 *
 * In most circumstances, Bufferers can only move forward in the data stream, as they work using DataSources that only move in one direction. However, if a Bufferer is created with a function that *provides* a data source, then it will be possible to move backwards in a stream by creating a new data source and skipping ahead to a previous point in the data.  In this case, it is important that the data source provider returns a data source that scans the same data.
 *
 * Bufferers should be `close()`'d when the are no longer needed
 */
export class Bufferer {
  /**
   * the current buffer we are providing data from, or null if we've already completely consumed the available data and need to get more
   */
  private buffer: Buffer | null = null;
  /**
   * The number of bytes we've currently read from the `buffer`, if there is a buffer to read from.
   */
  private offset = 0;

  /**
   * THe total number of bytes we've read so far
   */
  private bytesRead = 0;

  private isClosed = false;

  private currentSource: DataSource;

  /**
   * Creates a new Bufferer.
   *
   * @param source the source to read data from. If the given source is a data source provider (a function that returns a data source), the Bufferer will be resettable, in that it will be possible to skip *backwards* in the stream using `skip` and `skipTo`
   * @param isInterrupted a callback method that can be used to check if this bufferer has been interrupted and should stop producing data. Note that this will not actually interrupt ongoing reads, it will just prevent future reads from producing any data.
   * @param bigEndian true if the values in the data source are big-endian (largest byte first), false if they are little-endian
   */
  constructor(
    private readonly source: DataSource | (() => DataSource),
    private readonly isInterrupted = () => false,
    private readonly bigEndian = true,
  ) {
    if (typeof source === "object") {
      this.currentSource = source;
    } else {
      this.currentSource = source();
    }
  }

  /**
   * @returns true if this Bufferer is capable of skipping backwards in the data stream
   */
  isResettable() {
    return typeof this.source === "function";
  }

  /**
   * Creates a new Bufferer from the given Buffer.
   *
   * The returned Bufferer will be resettable.
   *
   * @param buffer the buffer to read data from
   * @param bigEndian whether the values are big-endian
   * @returns a new Bufferer
   */
  static from(buffer: Buffer, bigEndian = true) {
    const getDs = () => {
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
        },
      };
      return ds;
    };

    return new Bufferer(getDs, () => false, bigEndian);
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
  async skipTo(offset: number): Promise<void> {
    if (offset < 0) {
      throw new Error("Cannot skip to a negative offset");
    }

    if (offset < this.bytesRead) {
      if (typeof this.source === "function") {
        // reset the data source back to the beginning and skip again

        await this.currentSource.close();
        this.currentSource = this.source();
        return this.skipTo(offset);
      } else {
        throw new Error("Cannot skip to previous point in buffer");
      }
    }

    await this.checkState();

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

    // if the source supports native skipping, use it
    if (this.currentSource.skip && bytesToSkip > Bufferer.MIN_SKIP_SIZE) {
      await this.currentSource.skip(bytesToSkip);
      this.bytesRead += bytesToSkip;
      return;
    }

    // otherwise, skip by reading chunks of the file at a time and not doing anything with it
    while (bytesToSkip > 0) {
      await this.checkState();
      const bytesToDiscard = Math.min(Bufferer.SKIP_BUFFER_SIZE, bytesToSkip);
      await this.read(bytesToDiscard);
      bytesToSkip -= bytesToDiscard;
    }
  }

  /**
   * Make sure it's OK to proceed, i.e., we're not closed and haven't been interrupted.
   *
   * Throws an error if we're closed or have been interrupted
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
   * @throws EndOfFileError when there is no more data left in the source
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
          this.buffer = await this.currentSource.read(bytes);
        } catch (err) {
          // might not actually be safe to close this if there was an error
          await this.close();
          throw err;
        }
        this.offset = 0;
      }

      // copy some bytes from the saved buffer to the packet
      const endIndex = Math.min(this.buffer.byteLength, this.offset + bytes);

      const bytesWritten = this.buffer.copy(
        packet,
        writeOffset,
        this.offset,
        endIndex,
      );
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

  /** returns the number of bytes that can be read without fetching new data */
  private bytesLeft() {
    if (this.buffer === null) {
      return 0;
    } else {
      return this.buffer.byteLength - this.offset;
    }
  }

  /**
   * Reads the next 32-bit signed integer from the source.
   */
  nextInt(): Promise<number> {
    if (this.bytesLeft() >= 4) {
      const val = this.bigEndian
        ? this.buffer!.readInt32BE(this.offset)
        : this.buffer!.readInt32LE(this.offset);
      this.offset += 4;
      this.bytesRead += 4;
      return Promise.resolve(val);
    }

    return this.read(4).then((buf) => {
      if (this.bigEndian) {
        return buf.readInt32BE();
      } else {
        return buf.readInt32LE();
      }
    });
  }

  /**
   * Reads a single 8-bit ascii character from the stream.
   */
  nextChar(): Promise<string> {
    if (this.bytesLeft() >= 1) {
      const val = this.buffer!.toString("ascii", this.offset, this.offset + 1);
      this.offset += 1;
      this.bytesRead += 1;
      return Promise.resolve(val);
    }

    return this.read(1).then((buf) => buf.toString("ascii", 0, 1));
  }

  /**
   * Reads a boolean from the stream. (a one-byte value that is non-zero if true)
   */
  nextBool(): Promise<boolean> {
    if (this.bytesLeft() >= 1) {
      const val = this.buffer!.readUInt8(this.offset) !== 0;
      this.offset += 1;
      this.bytesRead += 1;
      return Promise.resolve(val);
    }

    return this.read(1).then((buf) => buf.readUInt8() !== 0);
  }

  /**
   * Reads a 32-bit floating point number from the stream.
   */
  nextFloat(): Promise<number> {
    if (this.bytesLeft() >= 4) {
      const val = this.bigEndian
        ? this.buffer!.readFloatBE(this.offset)
        : this.buffer!.readFloatLE(this.offset);
      this.offset += 4;
      this.bytesRead += 4;
      return Promise.resolve(val);
    }

    return this.read(4).then((buf) => {
      if (this.bigEndian) {
        return buf.readFloatBE();
      } else {
        return buf.readFloatLE();
      }
    });
  }

  /**
   * Reads a 64-bit floating point number from the stream
   */
  nextDouble(): Promise<number> {
    if (this.bytesLeft() >= 8) {
      const val = this.bigEndian
        ? this.buffer!.readDoubleBE(this.offset)
        : this.buffer!.readDoubleLE(this.offset);
      this.offset += 8;
      this.bytesRead += 8;
      return Promise.resolve(val);
    }

    return this.read(8).then((buf) => {
      if (this.bigEndian) {
        return buf.readDoubleBE();
      } else {
        return buf.readDoubleLE();
      }
    });
  }

  /**
   * Reads a 32-bit bitfield from the stream. An alias for `nextInt`
   */
  nextBitField() {
    return this.nextInt();
  }

  /**
   * Reads a fixed-length string array and parses it like a null-terminated string
   * @param length the maximum size of the character array
   * @param encoding the string encoding to use. Pretty sure the default is utf8
   * @returns the parsed string.
   */
  nextString(length: number, encoding?: BufferEncoding): Promise<string> {
    if (this.bytesLeft() >= length) {
      const str = this.buffer!.toString(
        encoding,
        this.offset,
        this.offset + length,
      );
      this.offset += length;
      this.bytesRead += length;
      return Promise.resolve(Bufferer.trimNull(str));
    } else {
      return this.read(length).then((buf) =>
        Bufferer.trimNull(buf.toString(encoding)),
      );
    }
  }

  /**
   * Trims null characters off the end of a string
   */
  private static trimNull(str: string) {
    const nul = str.indexOf("\0");
    if (nul >= 0) {
      return str.substring(0, nul);
    } else {
      return str;
    }
  }

  /**
   * Closes this bufferer and releases any resources held by the underlying data source.
   *
   * After closing a bufferer, any future calls to read or skip data will throw an error.
   *
   * Closing an already-closed bufferer has no effect
   */
  async close() {
    if (!this.isClosed) {
      this.isClosed = true;
      await this.currentSource.close();
    }
  }
}
