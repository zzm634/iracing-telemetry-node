// iRacing constants, structs, formats, and metadata

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
  irsdk_double,
}

export const IRSDKVarTypeWidth: Record<IRSDKVarType, number> = {
  [IRSDKVarType.irsdk_char]: 1,
  [IRSDKVarType.irsdk_bool]: 1,
  [IRSDKVarType.irsdk_int]: 4,
  [IRSDKVarType.irsdk_bitField]: 4,
  [IRSDKVarType.irsdk_float]: 4,
  [IRSDKVarType.irsdk_double]: 8,
};

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

export type Bitmask = Record<string, number>;

function isPowerOfTwo(i: number) {
  // shift right until we get the first 1
  if (i === 0) {
    return false;
  } else if ((i & 1) === 1) {
    return i === 1;
  } else {
    return isPowerOfTwo(i >>> 1);
  }
}

function checkBitmask<E extends Bitmask>(bitmask: E): E {
  // make sure each value only has a single "one" bit in it, and that they're all unique

  let masks = 0;
  for (const maskName in bitmask) {
    const mask = bitmask[maskName] as number;
    if (!isPowerOfTwo(mask)) {
      throw new Error(`bitmask field "${maskName}" is not a power of two`);
    }
    const newMasks = masks | mask;
    if (newMasks === masks) {
      throw new Error(
        `bitmask field "${maskName}" overlaps with other mask values`,
      );
    }
    masks = newMasks;
  }

  return bitmask;
}

export const M_EngineWarning = checkBitmask({
  WaterTemp: 1,
  FuelPressure: 2,
  OilPressure: 4,
  EngineStalled: 8,
  PitSpeedLimiter: 16,
  RevLimiterActive: 32,
});

export const M_Flag = checkBitmask({
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
  StartGo: 2147483648,
});

export const M_CameraState = checkBitmask({
  IsSessionScreen: 1,
  IsScenicActive: 2,
  CamToolActive: 4,
  UIHidden: 8,
  UseAutoShotSelection: 16,
  UseTemporaryEdits: 32,
  UseKeyAcceleration: 64,
  UseKey10xAcceleration: 128,
  UseMouseAimMode: 256,
});

export const M_PitSvFlags = checkBitmask({
  LFTireChange: 1,
  RFTireChange: 2,
  LRTireChange: 4,
  RRTireChange: 8,
  FuelFill: 0x10,
  WindshieldTearoff: 0x20,
  FastRepair: 0x40,
});

/**
 * Checks for the presence of bits in the given bitmask value using the given "enum"
 * @param value the bitmask value to chec
 * @param bitmask an object mapping enum names to bit field masks (not bit positions) that will be used to check the value
 * @returns a set containing the names of the set bits in the given bitmask
 */
export function toEnumSet<E extends Bitmask>(
  value: number,
  bitmask: E,
): Set<keyof E> {
  const enumSet = new Set<keyof E>();
  for (const ename in bitmask) {
    const mask = bitmask[ename]!;
    if ((value & mask) !== 0) {
      enumSet.add(ename);
    }
  }
  return enumSet;
}

/* Some values are enums */

/** Track location */
export enum E_TrkLoc {
  NotInWorld = -1,
  OffTrack = 0,
  InPitStall,
  ApproachingPits,
  OnTrack,
}

export enum E_TrkSurf {
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
  Astroturf,
}

export enum E_SessionState {
  Invalid,
  GetInCar,
  Warmup,
  ParadeLaps,
  Racing,
  Checkered,
  Cooldown,
}

export enum E_CarLeftRight {
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

export enum E_PaceMode {
  SingleFileStart,
  DoubleFileStart,
  SingleFileRestart,
  DoubleFileRestart,
  NotPacing,
}

export enum E_PitSvStatus {
  None,
  InProgress,
  Complete,

  TooFarLeft = 100,
  TooFarRight,
  TooFarForward,
  TooFarBack,
  BadAngle,
  CantFixThat,
}

export const M_PaceFlags = checkBitmask({
  EndOfLine: 1,
  FreePass: 2,
  WavedAround: 4,
});

/**
 * An IRTValue is an IRTVar that has an actual value.
 *
 * We use this union type so that you can check for the variable type first and get an actual typed value later
 *
 * @example
 * const rpm = sample.get("RPM");
 *
 * const rpms = rpm.values[0]; // <- no
 *
 * if(rpm.type === IRSDKVarType.irsdk_int) {
 *      const rpms = rpm.values[0]; // <- yes
 * }
 */
export type IRTValue =
  | IRTVarBool
  | IRTVarChar
  | IRTVarInt
  | IRTVarFloat
  | IRTVarDouble
  | IRTVarBitField;
