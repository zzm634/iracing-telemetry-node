// Defines possible telemetry sources and provides observables and shit for people to consume

import { Observable, Subject, combineLatest, concat, map, of } from "rxjs";
import { SessionData } from "./events/SessionData";
import { TelemetrySample } from "./events/TelemetrySample";
import { PathLike } from "fs";
import {
  TelemetryMetadata,
  createTelemetryObservable,
  readIBT,
} from "./parser";
import { DataSource, FileDataSource } from "./buffers";

// Source can be:
// - live telemetry
// - disk "live" telemetry
// - telemetry files on disk

/**
 * Emitted from a telemetry source when it successfully opens a connection to whatever the source is.
 */
export class ConnectedEvent {
  constructor() {}
}

/** Emitted from a telemetry source when it loses a connection to the source */
export class DisconnectedEvent {
  constructor() {}
}

export type IREvent =
  | ConnectedEvent
  | DisconnectedEvent
  | TelemetryMetadata
  | TelemetrySample
  | SessionData;

/**
 * All iRacing data sources will be exposed using this type. They will always bookend all telemetry and session data samples with a ConnectedEvent and a DisconnectedEvent, even if they are just reading from a file.
 *
 * E.g., a file source will emit a ConnectedEvent, a SessionData, a whole bunch of TelemetrySamples, a DisconnectedEvent, and then will complete
 *
 * A live data source will emit a ConnectedEvent when a successful connection is made to iRacing, and a DisconnectedEvent when it loses the connection, but it will never "complete"
 *
 * This type is considered a "raw" observable because it does not attempt to provide any helpful caching or mappings that would combine the data from telemetry damples and session data.
 */
export type RawIRacingObservable = Observable<IREvent>;

/**
 * Creates an observable that reads from the file identified at the given path. Useful for reading complete files, as it will emit connected and disconnected events before and after the file is opened.
 *
 * Not intended for incremental or ongoing file reads
 *
 * @param fileName a path pointing to the telemetry file to open
 */
export function fromIBTFile(fileName: PathLike): RawIRacingObservable {
  const connected = of(new ConnectedEvent());
  const disconnected = of(new DisconnectedEvent());
  const telemetry = createTelemetryObservable(
    () => new FileDataSource(fileName),
  );

  const fullFile = concat(connected, telemetry, disconnected);
  return fullFile;
}

/**
 * Creates a new Observable that can be used to connect to iRacing using the given options.
 *
 * Note that the returned observable is not a "subject"; every subscription made to it will essentially open a new file handle or connection
 *
 * @param options parameters that alter the way in which data is read from iRacing
 */
export function openIRacing(options?: {
  /**
   * The minimum delay (in milliseconds) between checking for new telemetry updates. iRacing generally writes telemetry at 60hz, so the minimum effective update rate is 16 milliseconds. If undefined, telemetry will be parsed as fast as possible, up to as often as it is emitted by iRacing
   */
  updateRate?: number;
  /**
   * The telemetry source to use.
   * - "live" uses the memory-mapped file provided by iRacing to return telemetry as soon as it is available. However, live telemetry does not contain all available channels, such as live tire temperatures or GPS coordinates, as iRacing has decided this data could be used to gain an unfair advantage
   * - "disk" telemtry is based on reading the file that iRacing writes to disk. The data written to this file is internally buffered and written to on a delay so that it cannot be used during gameplay, but it may contain more information than is available live. For race engineers, this data might be useful for longer races.
   *
   * Default is "live"
   */
  source?: "live" | "disk";
}): RawIRacingObservable {
  const { updateRate, source = "live" } = options ?? {};

  throw new Error("Not yet implemented.");
}

const IR_EVENT_NAME = "Local\\IRSDKDataValidEvent";
const IR_MEMMAP_NAME = "Local\\IRSDKMemMapFileName";

/**
 * Polls the data source for new sample information by repeatedly waiting for new data
 */
async function watchForSamples(
  /**
   * A function that returns a promise which resolves when new telemetry is available.
   *
   * If the promise rejects, we will stop trying to retrieve data
   */
  waitForReady: () => Promise<void>,
  /**
   * A data source provider that can be used to read telemetry
   */
  source: () => DataSource,
  /**
   * A callback method that accepts new SessionData instances
   */
  outSessions: (session: SessionData) => void,
  /**
   * A callback method that accepts new Telemetry samples
   */
  outTelem: (sample: TelemetrySample) => void,
  /**
   * If true, then skip ahead in the given data source each time we open it, based on the number of samples read.
   *
   * Set this to true for "watched" file sources
   */
  skipSamples = false,
) {
  let samplesRead = 0;
  let sessionUpdate = -1;

  while (true) {
    try {
      await waitForReady();
    } catch (err) {
      return;
    }

    const ds = source();
    await readIBT(
      ds,
      () => false,
      (data) => {
        if (data instanceof TelemetrySample) {
          samplesRead++;
          outTelem(data);
        } else if (data instanceof SessionData) {
          sessionUpdate = Math.max(sessionUpdate, data.version);
          outSessions(data);
        }
      },
      {
        sessionInfoUpdate: sessionUpdate,
        skipToSample: skipSamples ? samplesRead : undefined,
      },
    );
  }
}

// TODO: figure out how to handle connections and disconnections

// function watchLive(): Observable<IRSample> {
//   return new Observable<IRSample>((subscriber) => {
//     let interrupted = false;

//     const sessions = new Subject<SessionData>();
//     const samples = new Subject<TelemetrySample>();

//     const outSessions = (s: SessionData) => {
//       if (!interrupted) sessions.next(s);
//     };

//     const outTelems = (t: TelemetrySample) => {
//       if (!interrupted) {
//         samples.next(t);
//       }
//     };

//     let currentWaiter = null as Interruptible<void> | null;

//     const waitForNext = () => {
//       currentWaiter = asInterruptible(waitForNextEvent(IR_EVENT_NAME));
//       return currentWaiter.value;
//     };

//     // ensure that the session update count is always going up
//     const incSessions = increasing(
//       sessions,
//       (cur, next) => next.version > cur.version,
//     );

//     // also ensure that the tick number is always going up
//     const incSamples = increasing(
//       samples,
//       (cur, next) =>
//         (next.getSessionTick() ?? -1) > (cur.getSessionTick() ?? -1),
//     );

//     const subjectSubscription = combineLatest([incSessions, incSamples])
//       .pipe(map(([s, t]) => new IRSample(s, t)))
//       .subscribe(subscriber);

//     const unsubscribe = () => {
//       // stop emitting samples
//       interrupted = true;
//       if (currentWaiter !== null) {
//         currentWaiter.interrupt();
//       }

//       // tear down this rickety nonsense
//       subjectSubscription.unsubscribe();
//     };

//     // now that everything is set up, start parsing and emitting samples
//     watchForSamples(
//       waitForNext,
//       () => new MemoryMapDataSource(IR_MEMMAP_NAME),
//       outSessions,
//       outTelems,
//       false,
//     );

//     return unsubscribe;
//   });
// }
