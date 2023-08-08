// Contains unit definitions and conversions

// For each unit, the "base" unit is at the top and the value each unit is keyed to is the value that unit should be multiplied by to get the base unit

export type Unit = Record<string, number>;

export const U_Speed = {
  "m/s": 1,
  mph: 0.44704,
  kmh: 0.277777777777777777,
  kph: 0.277777777777777777,
} satisfies Unit;

export const U_Distance = {
  m: 1,
  cm: 0.01,
  km: 1000,
  ft: 0.3048,
  mi: 1609.34,
} satisfies Unit;

export const U_Time = {
  s: 1,
  seconds: 1,
  ms: 0.001,
  milliseconds: 0.001,
  m: 60,
  minutes: 60,
  h: 60 * 60,
  hours: 60 * 60,
};

/**
 * Converts a value in one unit to a target unit using the given unit mapping table
 *
 * @param mapping the table mapping unit values to conversion rates
 * @param value the value to be converted
 * @param dest the destination unit
 * @param src the source unit
 * @returns the converted value
 */
export function convertUnit<U extends Unit>(
  mapping: U,
  value: number,
  dest: keyof U,
  src?: keyof U,
): number {
  if (src !== undefined) {
    value /= mapping[src]!;
  }
  return (value *= mapping[dest]!);
}
