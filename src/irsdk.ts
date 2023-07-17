/** iRacing telemetry supports these types of variables, identified using this numeric enum */
export enum IRSDKVarType {
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

/** Basic metadata about a telemetry variable */
export type IRTVar = {
    name: string;
    description: string;
    unit: string;
    type: IRSDKVarType;
};

export type IRTVarBool = IRTVar & {
    type: IRSDKVarType.irsdk_bool;
    values: boolean[];
};

export type IRTVarChar = IRTVar & {
    type: IRSDKVarType.irsdk_char;
    values: string[];
};

export type IRTVarInt = IRTVar & {
    type: IRSDKVarType.irsdk_int;
    values: number[];
};

export type IRTVarFloat = IRTVar & {
    type: IRSDKVarType.irsdk_float;
    values: number[];
};

export type IRTVarDouble = IRTVar & {
    type: IRSDKVarType.irsdk_double;
    values: number[];
};

export type IRTVarBitField = IRTVar & {
    type: IRSDKVarType.irsdk_bitField;
    values: number[];
};


/* 
Some values are bit fields, they use bit masks for their values. 

Because TS enums are trash, I'm making my own. These M_ prefixed constants are "bitmask" objects that map names to bits and can be used to make Enum sets.

If I was cooler, I could figure out a way to make sure each of the number values was a power of two and that they were all unique. But alas. that's up the user I guess
*/

type Bitmask = Record<string, number>;

export const M_EngineWarning: Bitmask = {
    WaterTemp: 1,
    FuelPressure: 2,
    OilPressure: 4,
    EngineStalled: 8,
    PitSpeedLimiter: 16,
    RevLimiterActive: 32
} 

export const M_Flag: Bitmask = {
    Checkered: 1,
    White: 2,
    Green: 4,
    Yellow: 8,
    Red: 16,
    Blue: 32,
    Debris: 64,
    Crossed: 128,
    YellowWaving: 256,
    OneToGreen: 512,
    GreenHeld: 1024,
    TenToGo: 2048,
    FiveToGo: 4096,
    RandomWaving: 8192,
    Caution: 16384,
    CautionWaving: 32768,
    Black: 65536,
    Disqualify: 131072,
    Servicible: 262144,
    Furled: 524288,
    Repair: 1048576,
    StartHidden: 268435456,
    StartReady: 536870912,
    StartSet: 1073741824,
    StartGo: 2147483648
}

export const M_CameraState: Bitmask = {
    IsSessionScreen: 1,
    IsScenicActive: 2,
    CamToolActive: 4,
    UIHidden: 8,
    UseAutoShotSelection: 16,
    UseTemporaryEdits: 32,
    UseKeyAcceleration: 64,
    UseKey10xAcceleration: 128,
    UseMouseAimMode: 256
}

export const M_PitSvFlags: Bitmask = {
    LFTireChange: 1,
    RFTireChange: 2,
    LRTireChange: 4,
    RRTireChange: 8,
    FuelFill: 0x10,
    WindshieldTearoff: 0x20,
    FastRepair: 0x40,
}

/**
 * Checks for the presence of bits in the given bitmask value using the given "enum"
 * @param value the bitmask value to chec
 * @param enumm an object mapping enum names to bit field masks (not bit positions) that will be used to check the value
 * @returns a set containing the names of the set bits in the given bitmask
 */
export function toEnumSet<E extends Record<string, number>>(value: number, enumm: E): Set<keyof E> {

    const enumSet = new Set<keyof E>();
    for(const ename in enumm) {
        const mask = enumm[ename]!;
        if((value & mask) !== 0) {
            enumSet.add(ename);
        }
    }
    return enumSet;
}

/* Some values are enums */

/** Track location */
enum TrkLok {
    NotInWorld = -1,
    OffTrack = 0,
    InPitStall,
    ApproachingPits,
    OnTrack
}

enum TrkSurf {
    SurfaceNotInWorld = -1,
    Undefined = 0,
    Asphalt1,
    Asphalt2,
    Asphalt3,
    Asphalt4,
    Concrete1,
    Concrete2,
    RacingDirt1,
    RacingDirt2,
    Paint1,
    Paint2,
    Rumble1,
    Rumble2,
    Rumble3,
    Rumble4,
    Grass1,
    Grass2,
    Grass3,
    Grass4,
    Dirt1,
    Dirt2,
    Dirt3,
    Dirt4,
    Sand,
    Gravel1,
    Gravel2,
    Grasscrete,
    Astroturf
}

enum SessionState {
    Invalid,
    GetInCar,
    Warmup,
    ParadeLaps,
    Racing,
    Checkered,
    Cooldown
}

enum CarLeftRight {
    /** Spotter disabled */
    Off,
    /** No cars around us */
    Clear, 
    /** Car on left */
    CarLeft,
    /** Car on right */
    CarRight,
    /** 3-wide, in the middle */
    CarLeftRight,
    /** 3-wide, 2 cars on the left */
    Cars2Left,
    /** 3-wide, 2 cars on the right */
    Cars2Right,
}



/** An IRTValue is an IRTVar that has an actual value */
export type IRTValue = IRTVarBool | IRTVarChar | IRTVarInt | IRTVarFloat | IRTVarDouble | IRTVarBitField;
