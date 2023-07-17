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

export type IRTelemetryData = {
    type: "telemetry",
    raw: Record<string, IRTVar | undefined>,
}

export type IRData = IRTelemetryData | IRSessionData;

/**
 * Reads data from the given data source (something in .ibt format, memory-mapped or otherwise) and exports data sections as they are read
 * 
 * @param from 
 */
export function createTelemetryObservable(from: () => DataSource): Observable<IRData> {

    return new Observable((subscriber) => {

        let interrupt = false;

        const unsubscribe = () => {
            interrupt = true;
        }

        const isInterrupted = () => {
            return interrupt;
        }

        const out = (data: IRData | null) => {
            if (data === null) {
                subscriber.complete();
            } else {
                subscriber.next(data);
            }
        }

        const ds = from();

        readIBT(ds, isInterrupted, out)
            .catch((err) => subscriber.error(err))
            .finally(() => { subscriber.complete(); ds.close() });

        return unsubscribe;
    });
}

enum IRSDKVarType {
    irsdk_char = 0,
    irsdk_bool,
    irsdk_int,
    irsdk_bitField,
    irsdk_float,
    irsdk_double
}

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
 * @param source the data source to read data from
 * @param isInterrupted a callback method that can check to see if we've been interrupted yet and should stop sending data
 * @param out a consumer function that accepts data
 */
export async function readIBT(_source: DataSource, isInterrupted: () => boolean, out: (data: IRData) => void, continuous = false) {

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
        sessionInfoUpdate: await input.nextInt(),
        sessionInfoLen: await input.nextInt(),
        sessionInfoOffset: await input.nextInt(),
        numVars: await input.nextInt(),
        varHeadersOffset: await input.nextInt(),
        numBuf: await input.nextInt(),
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
    // each variable header is the same size and contains information about the variables themselves
    for (let i = 0; i < header.numVars; ++i) {
        varHeaders.push({
            type: (await input.nextInt()) as IRSDKVarType,
            offset: await input.nextInt(),
            count: await input.nextInt(),
            countAsTime: await input.nextInt() > 0,
            name: await input.nextString(32),
            description: await input.nextString(64),
            unit: await input.nextString(32),
        })
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

        const sample: IRTelemetryData = {
            type: "telemetry",
            raw: {}
        }

        for (const variable of varHeaders) {
            let value: IRTVar | null = null;

            switch (variable.type) {
                case IRSDKVarType.irsdk_char:
                    value = {
                        type: variable.type,
                        description: variable.description,
                        name: variable.name,
                        values: await readVariable(line, variable) as string[]
                    };
                    break;
                case IRSDKVarType.irsdk_bool:
                    value = {
                        type: variable.type,
                        description: variable.description,
                        name: variable.name,
                        values: await readVariable(line, variable) as boolean[]
                    };
                    break;
                case IRSDKVarType.irsdk_int:
                    value = {
                        type: variable.type,
                        description: variable.description,
                        name: variable.name,
                        values: await readVariable(line, variable) as number[],
                    };
                    break;
                case IRSDKVarType.irsdk_bitField:
                    //const bitField = await line.nextBitField();

                    // TODO special bit field types

                    value = {
                        type: variable.type,
                        description: variable.description,
                        name: variable.name,
                        values: await readVariable(line, variable) as number[],
                    };
                    break;
                case IRSDKVarType.irsdk_float:

                    value = {
                        type: variable.type,
                        description: variable.description,
                        name: variable.name,
                        values: await readVariable(line, variable) as number[],
                    }
                    break;

                case IRSDKVarType.irsdk_double:
                    value = {
                        type: variable.type,
                        description: variable.description,
                        name: variable.name,
                        values: await readVariable(line, variable) as number[],
                    }
                    break;
            }

            sample.raw[variable.name] = value;
        }

        out(sample);
    }
}

async function readVariable(input: Bufferer, variable: IRSDK_Variable): Promise<any[]> {
    await input.skipTo(variable.offset);
    const values: any[] = [];
    for (let i = 0; i < variable.count; ++i) {
        values.push(await readSingleValue(input, variable.type));
    }
    return values;
}

async function readSingleValue(input: Bufferer, type: IRSDKVarType): Promise<any> {
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
