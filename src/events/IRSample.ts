// a convenient way to access and represent an iRacing instance in time

import { TelemetrySample } from "./TelemetrySample";
import { SessionData } from "./SessionData";

/**
 * IRSample represents an instant in time within the iRacing simulator. It is a combination of session and telemetry data that provides convenient methods for accessing values from both sources (such as car and driver information)
 *
 * It is very much under construction.
 */
export class IRSample {
  constructor(
    public readonly session: SessionData,
    public readonly telemetry: TelemetrySample,
  ) {}
}
