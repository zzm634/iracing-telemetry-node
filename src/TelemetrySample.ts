import { IRTVar, 
    IRTVarChar, 
    IRTVarBool, 
    IRTVarInt, 
    IRTVarBitField, 
    IRTVarFloat, 
    IRTVarDouble, 
    M_EngineWarning, 
    IRSDKVarType, 
    IRTValue, 
    toEnumSet
} from "./irsdk.js";

/**
 * TelemetrySample is a set of telemetry variables exported from the simulator at a single point in time.
 */

export class TelemetrySample {
    constructor(
        private readonly metadata: Map<string, IRTVar>,
        private readonly data: Map<string, any[]>
    ) { }

    /**
     * Returns an object with all values dereferenced. Useful for debugging.
     *
     * If a variable is single-valued, it will be returned as a single value. Otherwise, it will be an array.
     */
    getAll(): Record<string, any> {
        const all: Record<string, any> = {};
        for (const varName of this.metadata.keys()) {
            const value = this.data.get(varName);
            if (value === null || value === undefined) {
                all[varName] = null;
            } else if (value.length === 1) {
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
    getRaw(name: string): IRTValue | null {
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

        return toEnumSet(bitfield, M_EngineWarning);
    }
}
