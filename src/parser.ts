// Telemetry file parser, usable for both .ibt files and memory mapped files

import { Observable } from "rxjs";
import { Bufferer, DataSource, EndOfFileError } from "./buffers.js";
import { rootLogger } from "./logger.js";
import { TelemetrySample } from "./TelemetrySample.js";
import { IRSDKVarType, IRTVar } from "./irsdk.js";
import { SessionData } from "./SessionData.js";

const logger = rootLogger.child({
    source: "parser.ts",
});

/**
 * Reads data from the given data source (something in .ibt format, memory-mapped or otherwise) and exports data sections as they are read. The data source will not be "opened" until a subscriber subscribes to the observable
 * 
 * @param from a supplier that provides the data source. A new data source will be used for every subscription made to the returned observable
 */
export function createTelemetryObservable(
    from: () => DataSource,
    options?: ParserOptions) {

    return new Observable<TelemetrySample | SessionData>((subscriber) => {

        let interrupt = false;

        const unsubscribe = () => {
            interrupt = true;
        }

        const isInterrupted = () => {
            return interrupt;
        }

        const out = (data: TelemetrySample | SessionData) => {
            subscriber.next(data);
        }

        const ds = from();

        readIBT(ds, isInterrupted, out, options)
            .catch((err) => subscriber.error(err))
            .finally(() => { subscriber.complete(); ds.close() });

        return unsubscribe;
    });
}

/**
 * Every telemetry file contains one or more variable buffers. Each buffer contains an array of samples, and each sample contains an array of channels (Each channel is also an array of values)
 * 
 * This header entry describes the number of samples in a buffer and the position within the file that the buffer starts
 */
type IBT_VarBuf = {
    tickCount: number;
    offset: number;
}

/**
 * An IBT variable (header) describes metadata about a variable, including its type, description, size, and position within a sample line
 */
type IBT_Variable = IRTVar & {
    /** The byte offset *within a sample* at which this variable is located */
    offset: number,
    /** The number of values this variable has. (i.e., carIDX stuff will have 64 values, subtick variables (360hz) will have multiples as well) */
    count: number,
    /** No idea what this is for */
    countAsTime: boolean,
}

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
 * Reads IBT data from the given source and pipes it to the given consumer function (out).
 * 
 * @param source the data source to read data from
 * @param isInterrupted a callback method that can check to see if we've been interrupted yet and should stop sending data
 * @param out a consumer function that accepts data
 * @param skipTo options governing whether we should skip reading samples or session data
 */
// I just named this parameter "_source" so that I would stop accidentally referring to it instead of "input"
export async function readIBT(
    _source: DataSource,
    isInterrupted: () => boolean,
    out: (data: TelemetrySample | SessionData) => void,
    options?: ParserOptions) {

    const input = new Bufferer(_source, isInterrupted, false);
    const { skipToSample = 0, sessionInfoUpdate: lastSessionInfoUpdate = -1 } = options ?? {};

    // IBT files seem to be organized like this:
    // header,
    // variable definitions[]
    // session info string
    // buffers[] (stream of samples, max of 4 in a file, probably just one actual buffer)
    // - samples[] (sample is a single "line" in telemetry representing a single point in time)
    //   - channels[] (channel is a variable with a signal source)
    //     - values[] (most channels have one value, but some can have more, such as carIDX or the subtick channels)

    // The header contains lots of metadata about the structure of the file, including the variable descriptors
    const header = await parseHeader(input)

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

    const varHeadersByName = new Map<string, IBT_Variable>();
    varHeaders.forEach(vh => varHeadersByName.set(vh.name, vh));

    if (lastSessionInfoUpdate < header.sessionInfoUpdate) {

        // advance to session info and read it
        await input.skipTo(header.sessionInfoOffset);

        // source should be pointed at the start of session info now
        const sessionInfoYaml = await input.nextString(header.sessionInfoLen);

        // TODO parse this string and send it out
        out(new SessionData(sessionInfoYaml, header.sessionInfoUpdate));
    }

    // skip to start of sample buffer
    await input.skipTo(hVarBuf?.offset);

    if (skipToSample > 0) {
        await input.skip(skipToSample * header.bufLen);
    }

    // read samples
    while (!isInterrupted()) {

        // read a line at a time, since variable header offsets are from the start of a line, not the start of a file
        let lineBuf: Buffer | null = null;
        try {
            lineBuf = await input.read(header.bufLen);
        } catch (err) {
            if (err instanceof EndOfFileError) {
                return;
            } else {
                throw err;
            }
        }

        const line = Bufferer.from(lineBuf, false);

        const values = new Map<string, any>();

        for (const variable of varHeaders) {

            // since we already read the line into a buffer, this should technically be synchronous. But it's nice to reuse Bufferer
            let value = await readVariable(line, variable);
            values.set(variable.name, value);
        }

        out(new TelemetrySample(varHeadersByName, values));
    }
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
            countAsTime: await input.nextInt() > 0,
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
    hVarBufs = hVarBufs.filter((hVarBuf) => hVarBuf.tickCount > 0)
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
        padding: await input.read(4 * 2)
    };
}

/**
 * Reads an array of variable values based on the variable type.
 * 
 * The input buffer will be skipped ahead to the offset included in the variable type
 */
async function readVariable(input: Bufferer, variable: IBT_Variable) {
    await input.skipTo(variable.offset);
    const values: any[] = [];
    for (let i = 0; i < variable.count; ++i) {
        values.push(await readSingleValue(input, variable.type));
    }

    switch (variable.type) {
        case IRSDKVarType.irsdk_bool:
            return values as boolean[];
        case IRSDKVarType.irsdk_char:
            return values as string[];
        case IRSDKVarType.irsdk_int:
        case IRSDKVarType.irsdk_bitField:
        case IRSDKVarType.irsdk_float:
        case IRSDKVarType.irsdk_double:
            return values as number[];
    }
}

/**
 * Reads a single variable value from the input based on the variable type.
 * 
 * The input buffer should already be pointed at the start of the variable
 */
async function readSingleValue(input: Bufferer, type: IRSDKVarType) {
    switch (type) {
        case IRSDKVarType.irsdk_char:
            return await input.nextChar();
        case IRSDKVarType.irsdk_bool:
            return await input.nextBool();
        case IRSDKVarType.irsdk_int:
            return await input.nextInt();
        case IRSDKVarType.irsdk_bitField:
            return await input.nextBitField();
        case IRSDKVarType.irsdk_float:
            return await input.nextFloat();
        case IRSDKVarType.irsdk_double:
            return await input.nextDouble();
    }
}
