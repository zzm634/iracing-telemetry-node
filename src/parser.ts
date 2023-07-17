// Telemetry file parser, usable for both .ibt files and memory mapped files

import { Observable } from "rxjs";
import { Bufferer, DataSource, EndOfFileError } from "./buffers.js";
import { rootLogger } from "./logger.js";

const logger = rootLogger.child({
    source: "parser.ts",
});

export type IRSessionData = {
    type: "session",
}

type IRTVarBase = {
    name: string,
    description: string,
    unit?: string,
    type: IRSDKVarType,
}

export type IRTVarBool = IRTVarBase & {
    type: IRSDKVarType.irsdk_bool,
    values: boolean[]
}

export type IRTVarChar = IRTVarBase & {
    type: IRSDKVarType.irsdk_char,
    values: string[]
}

export type IRTVarInt = IRTVarBase & {
    type: IRSDKVarType.irsdk_int,
    values: number[]
}

export type IRTVarFloat = IRTVarBase & {
    type: IRSDKVarType.irsdk_float,
    values: number[]
}

export type IRTVarDouble = IRTVarBase & {
    type: IRSDKVarType.irsdk_double,
    values: number[]
}

export type IRTVarBitField = IRTVarBase & {
    type: IRSDKVarType.irsdk_bitField,
    values: number[]
}

export enum EngineWarning {
    WaterTemp = 1,
    FuelPressure = 2,
    OilPressure = 4,
    EngineStalled = 8,
    PitSpeedLimiter = 16,
    RevLimiterActive = 32,
}

export type IRTVarEngineWarnings = IRTVarBitField & {
    bitfieldType: "EngineWarnings",
    warnings: Set<EngineWarning>
}

export enum Flag {
    Checkered = 1,
    White = 2,
    Green = 4,
    Yellow = 8,
    Red = 16,
    Blue = 32,
    Debris = 64,
    Crossed = 128,
    YellowWaving = 256,
    OneToGreen = 512,
    GreenHeld = 1024,
    TenToGo = 2048,
    FiveToGo = 4096,
    RandomWaving = 0x2000,
    Caution = 0x4000,
    CautionWaving = 0x8000,
    Black = 0x10000,
    Disqualify = 0x20000,
    Servicible = 0x40000,
    Furled = 0x80000,
    Repair = 0x100000,
    StartHidden = 0x10000000,
    StartReady = 0x20000000,
    StartSet = 0x40000000,
    StartGo = 0x80000000,
}

export type IRTVarSessionFlags = IRTVarBitField & {
    bitfieldType: "SessionFlags",
    flags: Set<Flag>
}

export enum CameraState {
    IsSessionScreen = 1,
    IsScenicActive = 2,
    CamToolActive = 4,
    UIHidden = 8,
    UseAutoShotSelection = 0x10,
    UseTemporaryEdits = 0x20,
    UseKeyAcceleration = 0x40,
    UseKey10xAcceleration = 0x80,
    UseMouseAimMode = 0x100,
}

export type IRTVarCameraState = IRTVarBitField & {
    bitfieldType: "CameraState"
    cameraStates: Set<CameraState>
}

type IRTVarExtraBitFields = IRTVarCameraState | IRTVarEngineWarnings | IRTVarSessionFlags;

export type IRTVar = IRTVarBool | IRTVarChar | IRTVarInt | IRTVarFloat | IRTVarDouble | IRTVarBitField | IRTVarExtraBitFields;

// TODO
export class SessionData { }

/**
 * Reads data from the given data source (something in .ibt format, memory-mapped or otherwise) and exports data sections as they are read
 * 
 * @param from a supplier that provides the data source. A new data source will be used for every subscription made to the returned observable
 */
export function createTelemetryObservable(from: () => DataSource): Observable<TelemetrySample | SessionData> {

    return new Observable((subscriber) => {

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

        readIBT(ds, isInterrupted, out)
            .catch((err) => subscriber.error(err))
            .finally(() => { subscriber.complete(); ds.close() });

        return unsubscribe;
    });
}


enum IRSDKVarType {
    /** Single ascii character */
    irsdk_char = 0,
    /** Single byte */
    irsdk_bool,
    /** 32-bit signed integer */
    irsdk_int,
    /** Bit mask implemented as 32-bit integer */
    irsdk_bitField,
    /** Single precision floating point number (4 bytes) */
    irsdk_float,
    /** Double precision floating point number (8 bytes) */
    irsdk_double
}

/**
 * Every telemetry file contains one or more variable buffers. This header describes how many telemetry samples are included in the file and the position within the file that the buffer starts
 */
type IRSDK_VarBuf = {
    tickCount: number;
    offset: number;
}

type IRSDK_Variable = {
    type: IRSDKVarType,
    offset: number,
    count: number,
    countAsTime: boolean,
    name: string,
    description: string,
    unit: string,
}

/**
 * Reads IBT data from the given source and pipes it to the given consumer function (out).
 * 
 * @param source the data source to read data from
 * @param isInterrupted a callback method that can check to see if we've been interrupted yet and should stop sending data
 * @param out a consumer function that accepts data
 * @param skipTo options governing whether we should skip reading samples
 */
export async function readIBT(_source: DataSource, isInterrupted: () => boolean, out: (data: TelemetrySample | SessionData) => void, skipTo?: {
    sample?: number,
    sessionInfoUpdate?: number
}) {

    const input = new Bufferer(_source, isInterrupted, false);

    // IBT files seem to be organized like this:
    // header,
    // variable definitions[]
    // array of (array of variables)

    // The header contains lots of metadata about the structure of the file, including the variable descriptors
    const header = {
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
    }

    if (logger.isDebugEnabled()) {
        logger.debug("header", header);
    }

    // Each "varbuf" (variable buffer) is a big array of "variable lines". A telemetry file can contain more than one variable buffer, but will likely only contain one
    const IRSDK_MAX_BUFS = 4;
    let hVarBufs: IRSDK_VarBuf[] = [];
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

    // cannot neccessarily assume session info is first
    if (header.sessionInfoOffset < header.varHeadersOffset) {
        // advance to session info and read it
        await input.skipTo(header.sessionInfoOffset);

        // source should be pointed at the start of session info now
        const sessionInfoYaml = await input.nextString(header.sessionInfoLen);

        // TODO parse this string and send it out
    }

    // read variable metadata

    // skip to variable headers that define the format of each variable
    await input.skipTo(header.varHeadersOffset);

    const varHeaders: IRSDK_Variable[] = [];
    const varHeadersByName = new Map<string, IRSDK_Variable>();
    // each variable header is the same size and contains information about the variables themselves
    for (let i = 0; i < header.numVars; ++i) {
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
        varHeadersByName.set(variable.name, variable);
    }

    // sort variables by their offset so we can read them incrementally
    varHeaders.sort((a, b) => a.offset - b.offset);

    // this gets weird if there are more than one variable buffer, so let's just fail if there's more than one
    if (hVarBufs.length > 1) {
        throw new Error("Cannot handle more than one variable buffer right now");
    } else if (hVarBufs.length === 0) {
        // weird?
        return;
    }

    const hVarBuf = hVarBufs[0]!;

    // skip to start of buffer
    await input.skipTo(hVarBuf?.offset);

    // read variables
    while (!isInterrupted()) {

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

            let value = await readVariable(line, variable);
            values.set(variable.name, value);
        }

        out(new TelemetrySample(varHeadersByName, values));
    }
}

/**
 * Reads an array of variable values based on the variable type.
 * 
 * The input buffer will be skipped ahead to the offset included in the variable type
 */
async function readVariable(input: Bufferer, variable: IRSDK_Variable) {
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

/**
 * TelemetrySample is a set of telemetry variables exported from the simulator at a single point in time.
 */
export class TelemetrySample {
    constructor(
        private readonly metadata: Map<string, IRSDK_Variable>,
        private readonly data: Map<string, any[]>
    ) { }

    /**
     * Returns an object with all values dereferenced. Useful for debugging.
     * 
     * If a variable is single-valued, it will be returned as a single value. Otherwise, it will be an array.
     */
    getAll(): Record<string, any> {
        const all: Record<string, any> = {}
        for(const varName of this.metadata.keys()) {
            const value = this.data.get(varName);
            if(value === null || value === undefined) {
                all[varName] = null;
            } else if(value.length === 1) {
                all[varName] = value[0];
            } else {
                all[varName] = value;
            }
        }

        return all;
    }

    /**
     * Returns the "raw" information about a variable, including its name, description, type, unit, and values.
     * 
     * Or null if the value does not exist in this sample.
     */
    getRaw(name: string): IRTVar | null {
        const varMeta = this.metadata.get(name);
        if (varMeta !== undefined) {
            const value = this.data.get(name);
            if (value !== null) {

                switch (varMeta.type) {
                    case IRSDKVarType.irsdk_char:
                        return {
                            name: varMeta.name,
                            description: varMeta.description,
                            type: IRSDKVarType.irsdk_char,
                            values: value as string[],
                            unit: varMeta.unit
                        } satisfies IRTVarChar;
                    case IRSDKVarType.irsdk_bool:
                        return {
                            name: varMeta.name,
                            description: varMeta.description,
                            type: IRSDKVarType.irsdk_bool,
                            values: value as boolean[],
                            unit: varMeta.unit
                        } satisfies IRTVarBool;
                    case IRSDKVarType.irsdk_int:
                        return {
                            name: varMeta.name,
                            description: varMeta.description,
                            type: IRSDKVarType.irsdk_int,
                            values: value as number[],
                            unit: varMeta.unit
                        } satisfies IRTVarInt;
                    case IRSDKVarType.irsdk_bitField:
                        return {
                            name: varMeta.name,
                            description: varMeta.description,
                            type: IRSDKVarType.irsdk_bitField,
                            values: value as number[],
                            unit: varMeta.unit
                        } satisfies IRTVarBitField;
                    case IRSDKVarType.irsdk_float:
                        return {
                            name: varMeta.name,
                            description: varMeta.description,
                            type: IRSDKVarType.irsdk_float,
                            values: value as number[],
                            unit: varMeta.unit
                        } satisfies IRTVarFloat;
                    case IRSDKVarType.irsdk_double:
                        return {
                            name: varMeta.name,
                            description: varMeta.description,
                            type: IRSDKVarType.irsdk_double,
                            values: value as number[],
                            unit: varMeta.unit
                        } satisfies IRTVarDouble;
                }
            }
        }

        return null;
    }

    // These utility accessors make a lot of assumptions about the data
    // TODO type checks?

    private getSingleNumber(name: string): number | null {
        return (this.getRaw(name)?.values[0] ?? null) as number | null;
    }

    private getSingleBoolean(name: string): boolean | null {
        return (this.getRaw(name)?.values[0] ?? null) as boolean | null;
    }

    getAirDensity() {
        return this.getSingleNumber("AirDensity");
    }

    getAirPressure() {
        return this.getSingleNumber("AirPressure");
    }

    getAirTemp() {
        return this.getSingleNumber("AirTemp");
    }

    getAlt() {
        return this.getSingleNumber("Alt");
    }

    getBrake() {
        return this.getSingleNumber("Brake");
    }

    getBrakeABSActive() {
        return this.getSingleBoolean("BrakeABSactive");
    }

    getBrakeABScutPct() {
        return this.getSingleNumber("BrakeABScutPct");
    }

    getBrakeRaw() {
        return this.getSingleNumber("BrakeRaw");
    }

    /** Center Front Splitter Ride Height */
    getCFSRRideHeight() {
        return this.getSingleNumber("CFSRrideHeight");
    }

    getChanAvgLatency() {
        return this.getSingleNumber("ChanAvgLatency");
    }

    // TODO the rest...


    // Some bitfield operators

    getEngineWarnings() {
        const bitfield = this.getSingleNumber("EngineWarnings");
        if (bitfield === null) return null;

        // typescript enums suck
        const warnings = new Set<EngineWarning>();
        if (bitfield & EngineWarning.EngineStalled) {
            warnings.add(EngineWarning.EngineStalled);
        }

        if (bitfield & EngineWarning.FuelPressure) {
            warnings.add(EngineWarning.FuelPressure);
        }

        if (bitfield & EngineWarning.OilPressure) {
            warnings.add(EngineWarning.OilPressure);
        }

        if (bitfield & EngineWarning.PitSpeedLimiter) {
            warnings.add(EngineWarning.PitSpeedLimiter);
        }

        if (bitfield & EngineWarning.RevLimiterActive) {
            warnings.add(EngineWarning.RevLimiterActive);
        }

        if (bitfield & EngineWarning.WaterTemp) {
            warnings.add(EngineWarning.WaterTemp);
        }

        return warnings;
    }
}
