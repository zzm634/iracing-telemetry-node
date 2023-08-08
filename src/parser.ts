// Telemetry file parser, usable for both .ibt files and memory mapped files

import { Observable } from "rxjs";
import { Bufferer, DataSource, EndOfFileError } from "./buffers";
import { rootLogger } from "./logger";
import { TelemetrySample } from "./events/TelemetrySample";
import { IRSDKVarType, IRSDKVarTypeWidth, IRTVar } from "./irsdk";
import { SessionData } from "./events/SessionData";
import { lazy } from "./async";

const logger = rootLogger.child({
  source: "parser.ts",
});

/**
 * Reads data from the given data source (something in .ibt format, memory-mapped or otherwise) and exports data sections as they are read. A new data source will be opened every time a subscriber subscribes to the returned observable and will be closed when either parsing completes or they unsubscribe.
 *
 * @param from a supplier that provides the data source. A new data source will be used for every subscription made to the returned observable
 */
export function createTelemetryObservable(
  from: () => DataSource,
  options?: ParserOptions,
) {
  return new Observable<TelemetrySample | SessionData | TelemetryMetadata>(
    (subscriber) => {
      let interrupt = false;

      const unsubscribe = () => {
        interrupt = true;
      };

      const isInterrupted = () => {
        return interrupt;
      };

      readIBT(from, isInterrupted, (data) => subscriber.next(data), options)
        .then(() => subscriber.complete())
        .catch((err) => subscriber.error(err));

      return unsubscribe;
    },
  );
}

/**
 * Every telemetry file contains one or more variable buffers. Each buffer contains an array of samples, and each sample contains an array of channels (Each channel is also an array of values)
 *
 * This header entry describes the number of samples in a buffer and the position within the file that the buffer starts
 */
type IBT_VarBuf = {
  tickCount: number;
  offset: number;
};

/**
 * An IBT variable (header) describes metadata about a variable, including its type, description, size, and position within a sample line
 */
type IBT_Variable = IRTVar & {
  /** The byte offset *within a sample* at which this variable is located */
  offset: number;
  /** The number of values this variable has. (i.e., carIDX stuff will have 64 values, subtick variables (360hz) will have multiples as well) */
  count: number;
  /** No idea what this is for */
  countAsTime: boolean;
};

type ParserOptions = {
  /**
   * The number of telemetry samples to skip over. If not provided, emit all telemetry samples.
   */
  skipToSample?: number;
  /**
   * If the session info update number in the header is greater than this number, then the YAML will be parsed and a SessionData instance will be emitted, otherwise, session info will be skipped.
   *
   * If not provided, always emit SessionData
   */
  sessionInfoUpdate?: number;
};

/**
 * TelemetryMetadata describes properties of a telemetry file that are not included in the session info or telemetry samples. Always emitted when parsing an IBT file
 */
export class TelemetryMetadata {
  constructor(private readonly vars: IBT_Variable[]) {}

  getVars() {
    const varobj: any = {};

    this.vars.forEach((v) => {
      varobj[v.name] = {
        description: v.description,
        unit: v.unit,
        isArray: v.count > 1,
      };
    });

    return varobj;
  }
}

// export function observeIBT(source: () => DataSource, options?: ParserOptions): Observable<TelemetrySample | TelemetryMetadata | SessionData> {
//   return new Observable((subscriber) )
// }

/**
 * Reads IBT data from the given source and pipes it to the given consumer function (out).
 *
 * As the file is read, parsed objects will be passed to the given `out` function. `TelemetryMetadata` will always be emitted first, followed by a single `SessionData` and multiple `TelemetrySample`s.
 * - If `options.lastSessionInfoUpdate` is provided, `SessionData` will only be emitted if the update number (available in `TelemetryMetadata`) in the file is greater than the number provided in `options.lastSessionInfoUpdate`.
 * - If `options.skipToSample` is provided, then parsing will jump ahead in the telemetry file that number of samples before emitting `TelemetrySample`s. Note that this should only be used when incrementally parsing disk files; live (memory-mapped) telemetry will only contain one sample.
 *
 * @param source the data source to read data from. The data source will be closed by this method
 * @param isInterrupted a callback method that can check to see if we've been interrupted yet and should stop sending data
 * @param out a consumer function that accepts data. If the consumer function returns a promise, it will be waited on. This will slow down processing, but guarantee a synchronous output. For fastest processing, use a synchronous consumer function
 * @param skipTo options governing whether we should skip reading samples or session data
 */
export async function readIBT(
  source: DataSource | (() => DataSource),
  isInterrupted: () => boolean,
  out: (
    data: TelemetrySample | SessionData | TelemetryMetadata,
  ) => void | Promise<void>,
  options?: ParserOptions,
) {
  const { skipToSample = 0, sessionInfoUpdate: lastSessionInfoUpdate = -1 } =
    options ?? {};

  const generateTelemetryCode =
    (options && (options as any)["generate"] === true) ?? false;

  const input = new Bufferer(source, isInterrupted, false);

  // IBT files seem to be organized like this:
  // header,
  // variable definitions[]
  // session info string
  // buffers[] (stream of samples, max of 4 in a file, probably just one actual buffer)
  // - samples[] (sample is a single "line" in telemetry representing a single point in time)
  //   - channels[] (channel is a variable with a signal source)
  //     - values[] (most channels have one value, but some can have more, such as carIDX or the subtick channels)

  // The header contains lots of metadata about the structure of the file, including the variable descriptors
  const header = await parseHeader(input);

  // await out(new TelemetryMetadata(header.sessionInfoUpdate));

  if (logger.isDebugEnabled()) {
    logger.debug("header", header);
  }

  // Each "varbuf" (variable buffer) is a big array of "variable lines". A telemetry file can contain more than one variable buffer, but will likely only contain one
  const hVarBufs: IBT_VarBuf[] = await parseVariableBufferHeaders(input);

  // Things gets weird if there are more than one variable buffer, so let's just fail if there's more than one
  if (hVarBufs.length > 1) {
    throw new Error("Cannot handle more than one variable buffer right now");
  } else if (hVarBufs.length === 0) {
    // weird?
    return;
  }
  const hVarBuf = hVarBufs[0]!;

  // TODO not entirely sure what the order of data is within a file. Technically, session info, variable headers, and data buffers could all come in a different order. But we're reading the file moving forward only, so we can't just jump to arbitrary points, we need to know the order they appear in.
  // I'm not entirely sure if they have a fixed order like header > variables > session > samples, or if it's arbitrary.
  // The file format would seem to support these sections being at arbitrary positions, but I'm making a lot of assumptions about being able to read them in a specific order

  // read variable metadata

  // skip to variable headers that define the format of each variable
  await input.skipTo(header.varHeadersOffset);
  const varHeaders = await readVariableHeaders(input, header.numVars);

  await out(new TelemetryMetadata(varHeaders));
  const varHeadersByName = new Map<string, IBT_Variable>();
  varHeaders.forEach((vh) => varHeadersByName.set(vh.name, vh));

  if (generateTelemetryCode) {
    // for help while writing this code, just generate code and leave
    generate(varHeaders);
    input.close();
    return;
  }

  if (lastSessionInfoUpdate < header.sessionInfoUpdate) {
    // advance to session info and read it
    await input.skipTo(header.sessionInfoOffset);

    // source should be pointed at the start of session info now
    const sessionInfoYaml = await input.nextString(header.sessionInfoLen);

    // TODO parse this string and send it out
    await out(new SessionData(sessionInfoYaml, header.sessionInfoUpdate));
  }

  // skip to start of sample buffer
  await input.skipTo(hVarBuf?.offset);

  if (skipToSample > 0) {
    await input.skip(skipToSample * header.bufLen);
  }

  // read samples
  while (!isInterrupted()) {
    // read a line at a time, since variable header offsets are from the start of a line, not the start of a file
    let lineBuf: Buffer;
    try {
      lineBuf = await input.read(header.bufLen);
    } catch (err) {
      if (err instanceof EndOfFileError) {
        return;
      } else {
        throw err;
      }
    }

    const lazySample = lazy(() => {
      const values = new Map<string, any>();

      for (const variable of varHeaders) {
        // since we already read the line into a buffer, this should technically be synchronous. But it's nice to reuse Bufferer
        let value = readVariableSync(lineBuf, variable);
        values.set(variable.name, value);
      }
      return values;
    });

    await out(new TelemetrySample(varHeadersByName, lazySample));
  }

  await input.close();
}

/**
 * Parses an array of variable metadata headers from the given input source.
 *
 * @param input the source from which the headers should be read
 * @param numVars the expected number of variable headers
 * @returns an array of variable headers, sorted by offset
 */
async function readVariableHeaders(input: Bufferer, numVars: number) {
  const varHeaders: IBT_Variable[] = [];

  // each variable header is the same size and contains information about the variables themselves
  for (let i = 0; i < numVars; ++i) {
    const variable = {
      type: (await input.nextInt()) as IRSDKVarType,
      offset: await input.nextInt(),
      count: await input.nextInt(),
      countAsTime: (await input.nextInt()) > 0,
      name: await input.nextString(32),
      description: await input.nextString(64),
      unit: await input.nextString(32),
    };

    varHeaders.push(variable);
  }

  // sort variables by their offset so we can read them incrementally
  varHeaders.sort((a, b) => a.offset - b.offset);
  return varHeaders;
}

/** Parses variable buffer headers from the given input.
 *
 * @param input the source to read data from. Expected to be already pointing at the start of the buffer headers array
 * @return an array of variable buffer headers, sorted by offset, and filtered to only buffers that contain samples
 */
async function parseVariableBufferHeaders(input: Bufferer) {
  const IRSDK_MAX_BUFS = 4;
  let hVarBufs: IBT_VarBuf[] = [];
  for (let i = 0; i < IRSDK_MAX_BUFS; ++i) {
    // each varbuf is 2 actual ints and 2 padding ints
    hVarBufs.push({
      tickCount: await input.nextInt(),
      offset: await input.nextInt(),
    });
    await input.read(4 * 2);
  }

  // sort and filter variable buffers so we can read them in order
  hVarBufs = hVarBufs
    .filter((hVarBuf) => hVarBuf.tickCount > 0)
    .sort((a, b) => a.offset - b.offset);
  return hVarBufs;
}

/**
 * Parses the header fields of the given input buffer pointed at the beginning of an IBT file
 *
 * The input bufferer will be left to start right after the end of the header.
 */
async function parseHeader(input: Bufferer) {
  return {
    /** Version */
    ver: await input.nextInt(),
    status: await input.nextInt(),
    tickRate: await input.nextInt(),
    /** Incremented when the session info changes during a session */
    sessionInfoUpdate: await input.nextInt(),
    /** The length of the session info string, in bytes */
    sessionInfoLen: await input.nextInt(),
    /**
     * The number of bytes into the file that the session info string resides
     */
    sessionInfoOffset: await input.nextInt(),
    /** The total number of telemetry variables (channels) */
    numVars: await input.nextInt(),
    /** The position within the file that the list of telemetry variable headers start */
    varHeadersOffset: await input.nextInt(),
    /** The number of telemetry channel buffers ( a file contains a list of buffers, each buffer is a list of samples, each sample is a list of values, and each value is a list of... even more values) */
    numBuf: await input.nextInt(),
    /** The length, in bytes, of a single telemetry sample "line" */
    bufLen: await input.nextInt(),
    padding: await input.read(4 * 2),
  };
}

/**
 * Reads a variable from the given buffer.
 *
 * Unlike, `readVariable`, this one is synchronous
 *
 * @param input a buffer containing a complete telemtry sample line
 * @param variable metadata that describes the type and location of the variable to read
 * @returns an array of sample values (based on `variable.count`)
 */
function readVariableSync(input: Buffer, variable: IBT_Variable) {
  const values: any[] = [];
  for (let i = 0; i < variable.count; ++i) {
    const varSize = IRSDKVarTypeWidth[variable.type];
    const byteOffset = variable.offset + i * varSize;
    switch (variable.type) {
      case IRSDKVarType.irsdk_char:
        values.push(input.toString("ascii", byteOffset, byteOffset + 1));
        break;
      case IRSDKVarType.irsdk_bool:
        values.push(input.readUint8(byteOffset) !== 0);
        break;
      case IRSDKVarType.irsdk_int:
      case IRSDKVarType.irsdk_bitField:
        values.push(input.readInt32LE(byteOffset));
        break;
      case IRSDKVarType.irsdk_float:
        values.push(input.readFloatLE(byteOffset));
        break;
      case IRSDKVarType.irsdk_double:
        values.push(input.readDoubleLE(byteOffset));
        break;
    }
  }

  return values as string[] | boolean[] | number[];
}

function capitalizeFirstLetter(str: string) {
  if (str.length > 0) {
    return str.substring(0, 1).toUpperCase() + str.substring(1);
  } else {
    return str;
  }
}

function generate(vars: IBT_Variable[]) {
  for (const v of vars) {
    const methodName = "get" + capitalizeFirstLetter(v.name);

    console.log("/**");
    console.log(` * ${v.description}`);
    console.log(" *");
    console.log(` * Unit: ${v.unit}`);
    console.log(" */");
    console.log(`${methodName}() {`);

    const single = v.count === 1;
    let valueType: string;
    switch (v.type) {
      case IRSDKVarType.irsdk_char:
        valueType = "string[]";
        break;
      case IRSDKVarType.irsdk_bool:
        valueType = "boolean[]";
        break;
      case IRSDKVarType.irsdk_int:
      case IRSDKVarType.irsdk_bitField:
      case IRSDKVarType.irsdk_float:
      case IRSDKVarType.irsdk_double:
        valueType = "number[]";
        break;
    }

    console.log(`  const val = this.data.get("${v.name}");`);
    console.log(
      `  if(val !== undefined) return (val as ${valueType})${
        single ? "[0]" : ""
      } ?? null;`,
    );
    console.log(`  return null;`);
    console.log("}");

    console.log("");
  }
}
