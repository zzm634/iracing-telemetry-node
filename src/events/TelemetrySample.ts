import { Lazy } from "../async";
import {
  IRTVar,
  IRTVarChar,
  IRTVarBool,
  IRTVarInt,
  IRTVarBitField,
  IRTVarFloat,
  IRTVarDouble,
  M_EngineWarning,
  IRSDKVarType,
  IRTValue,
  Bitmask,
  M_Flag,
  E_TrkLoc,
  E_TrkSurf,
  M_PitSvFlags,
  E_PaceMode,
} from "../irsdk";

export type SampleData = Map<string, string[] | number[] | boolean[]>;

/**
 * TelemetrySample is a set of telemetry variables exported from the simulator at a single point in time.
 *
 *
 */
export class TelemetrySample {
  getSessionTick() {
    return this.getSingleNumber("SessionTick");
  }
  private data: Lazy<Map<string, string[] | number[] | boolean[]>>;

  constructor(
    private readonly metadata: Map<string, IRTVar>,
    data: SampleData | Lazy<SampleData>,
  ) {
    if (data instanceof Map) {
      this.data = () => data;
    } else {
      this.data = data;
    }
  }

  /**
   * Returns an object with all values dereferenced. Useful for debugging.
   *
   * If a variable is single-valued, it will be returned as a single value. Otherwise, it will be an array.
   */
  getAllValues() {
    const all: Record<
      string,
      null | string | number | boolean | string[] | number[] | boolean[]
    > = {};
    for (const varName of this.metadata.keys()) {
      const value = this.data().get(varName);
      if (value === null || value === undefined) {
        all[varName] = null;
      } else if (value.length === 1) {
        all[varName] = value[0]!;
      } else {
        all[varName] = value;
      }
    }

    return all;
  }

  getAll(): IRTValue[] {
    return [...this.metadata.keys()]
      .map((val) => this.getRaw(val))
      .filter(Boolean) as IRTValue[];
  }

  /**
   * Returns the "raw" information about a variable, including its name, description, type, unit, and values.
   *
   * Or null if the value does not exist in this sample.
   */
  getRaw(name: string): IRTValue | null {
    const varMeta = this.metadata.get(name);
    if (varMeta !== undefined) {
      const value = this.data().get(name);
      if (value !== null) {
        switch (varMeta.type) {
          case IRSDKVarType.irsdk_char:
            return {
              name: varMeta.name,
              description: varMeta.description,
              type: IRSDKVarType.irsdk_char,
              values: value as string[],
              unit: varMeta.unit,
            } satisfies IRTVarChar;
          case IRSDKVarType.irsdk_bool:
            return {
              name: varMeta.name,
              description: varMeta.description,
              type: IRSDKVarType.irsdk_bool,
              values: value as boolean[],
              unit: varMeta.unit,
            } satisfies IRTVarBool;
          case IRSDKVarType.irsdk_int:
            return {
              name: varMeta.name,
              description: varMeta.description,
              type: IRSDKVarType.irsdk_int,
              values: value as number[],
              unit: varMeta.unit,
            } satisfies IRTVarInt;
          case IRSDKVarType.irsdk_bitField:
            return {
              name: varMeta.name,
              description: varMeta.description,
              type: IRSDKVarType.irsdk_bitField,
              values: value as number[],
              unit: varMeta.unit,
            } satisfies IRTVarBitField;
          case IRSDKVarType.irsdk_float:
            return {
              name: varMeta.name,
              description: varMeta.description,
              type: IRSDKVarType.irsdk_float,
              values: value as number[],
              unit: varMeta.unit,
            } satisfies IRTVarFloat;
          case IRSDKVarType.irsdk_double:
            return {
              name: varMeta.name,
              description: varMeta.description,
              type: IRSDKVarType.irsdk_double,
              values: value as number[],
              unit: varMeta.unit,
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

  private getBitmaskField<BM extends Bitmask>(
    name: string,
    bitmask: BM,
  ): Set<keyof BM> | null {
    const value = this.getSingleNumber(name);
    if (value === null) return null;
    const valueSet = new Set<keyof BM>();
    for (const bmName in bitmask) {
      const mask = bitmask[bmName]!;
      if ((mask & value) !== 0) {
        valueSet.add(bmName);
      }
    }
    return valueSet;
  }

  /* helper methods for known variables */

  /* generated code */

  /**
   * Session flags
   *
   * Unit: irsdk_Flags
   */
  getSessionFlags() {
    return this.getBitmaskField("SessionFlags", M_Flag);
  }

  /**
   * Players car track surface type
   *
   * Unit: irsdk_TrkLoc
   */
  getPlayerTrackSurface() {
    return this.getSingleNumber("PlayerTrackSurface") as null | E_TrkLoc;
  }

  /**
   * Players car track surface material type
   *
   * Unit: irsdk_TrkSurf
   */
  getPlayerTrackSurfaceMaterial() {
    return this.getSingleNumber(
      "PlayerTrackSurfaceMaterial",
    ) as null | E_TrkSurf;
  }

  /**
   * Players car pit service status bits
   *
   * Unit: irsdk_PitSvStatus
   */
  getPlayerCarPitSvStatus() {
    return this.getBitmaskField("PlayerCarPitSvStatus", M_PitSvFlags);
  }

  /**
   * Are we pacing or not
   *
   * Unit: irsdk_PaceMode
   */
  getPaceMode() {
    return this.getSingleNumber("PaceMode") as null | E_PaceMode;
  }

  /* end generated code */

  // TODO the rest...
  // Some bitfield operators
  getEngineWarnings() {
    return this.getBitmaskField("EngineWarnings", M_EngineWarning);
  }
}
