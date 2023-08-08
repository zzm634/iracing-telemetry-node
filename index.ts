import { TelemetryMetadata, createTelemetryObservable } from "./src/parser";
import { TelemetrySample } from "./src/events/TelemetrySample";
import { SessionData } from "./src/events/SessionData";

export { TelemetryMetadata, TelemetrySample, SessionData };

import { PathLike } from "fs";
import { Observable, filter, scan, map, connect, merge } from "rxjs";
import { IRSample } from "./src/events/IRSample";
import { ConnectedEvent, DisconnectedEvent, fromIBTFile } from "./src/sources";
import { Queue, QueueCompleteError, collect } from "./src/async";

// /**
//  * Creates an Observable that reads telemetry samples from the .IBT file located at the given path.
//  *
//  * This function is considered "raw" in that the session and telemetry data are not combined in any way, and may be challenging to parse.
//  *
//  * The returned Observable is "cold", in that it does not begin to read the file until it is subscribed to. It is not a `Subject`; every subscription to the returned Observable will open a new handle to the file.
//  *
//  * The returned Observable emits three kinds of items:
//  * - one TelemetryMetadata that contains metadata specific to the file itself
//  * - one SessionData that contains the value of the parsed session YAML string
//  * - a TelemetrySample for each value it reads from the file
//  *
//  * @param filePath a path to the target IBT file to parse
//  * @return an Observable that emits data extracted from the file
//  */
// export function readIBTFileRaw(filePath: PathLike): Observable<TelemetryMetadata | TelemetrySample | SessionData> {
//   return createTelemetryObservable(() => new FileDataSource(filePath));
// }

/**
 * Converts a "raw" source of session data, telemetry samples, and connection events into a cleaner "IRSample" source.
 *
 * Makes some assumptions about the source observable:
 * - Session data and telemetry events will be emitted in order
 * - When a "disconnect" event happens, any future samples emitted will be the start of a new source, and will require resynchronization between session and telemetry data
 * @param raw
 * @returns
 */
function toIRSamples(raw: Observable<IREvent>): Observable<IREvent> {
  type ACC = {
    session: SessionData | null;
    telemetry: TelemetrySample | null;
  };

  // split observable into three streams, one of which is the scanned one which resets when a disconnect occurs, then merge back together

  return raw.pipe(
    connect((source) => {
      const activeEvents = source.pipe(
        filter(
          (evt) =>
            evt instanceof ConnectedEvent || evt instanceof DisconnectedEvent,
        ),
      ) as Observable<ConnectedEvent | DisconnectedEvent>;

      const dcsAndData = source.pipe(
        filter(
          (evt) =>
            evt instanceof DisconnectedEvent ||
            evt instanceof SessionData ||
            evt instanceof TelemetrySample,
        ),
      ) as Observable<DisconnectedEvent | TelemetrySample | SessionData>;

      const latestData = dcsAndData.pipe(
        scan(
          (acc: ACC, evt) => {
            if (evt instanceof DisconnectedEvent) {
              return {
                session: null,
                telemetry: null,
              };
            } else if (evt instanceof SessionData) {
              return {
                ...acc,
                session: evt,
              };
            } else {
              return {
                ...acc,
                telemetry: evt,
              };
            }
          },
          {
            session: null,
            telemetry: null,
          },
        ),
        // combine session and telemtry into IRSamples
        map((latest) => {
          if (latest.session !== null && latest.telemetry !== null) {
            return new IRSample(latest.session, latest.telemetry);
          } else {
            return null;
          }
        }),
        filter((s) => s !== null),
      ) as Observable<IRSample>;

      return merge(activeEvents, latestData);
    }),
  );
}

type IREvent = ConnectedEvent | IRSample | DisconnectedEvent;

/**
 * Source encapsulates the various interfaces that may be used
 */
type Source = {
  /**
   * @returns an Observable that emits telemetry events from this source once subscribed to.
   */
  asObservable: () => Observable<IREvent>;
  /**
   * A Queue that collects events
   * @returns
   */
  asQueue: () => Queue<IREvent>;

  [Symbol.asyncIterator]: () => AsyncGenerator<IREvent>;
};

/**
 * Creates a new Source that references the given file.
 * @param path
 * @returns
 */
function file(path: PathLike): Source {
  function asObservable() {
    return toIRSamples(fromIBTFile(path));
  }

  function asQueue() {
    const obs = asObservable();
    return collect(obs);
  }

  async function* asyncItr() {
    const q = asQueue();

    while (true) {
      try {
        yield q.take();
      } catch (err) {
        if (err instanceof QueueCompleteError) {
          return;
        } else {
          throw err;
        }
      }
    }
  }

  return {
    asObservable,
    asQueue,
    [Symbol.asyncIterator]: asyncItr,
  };
}

export { file };
