// Various async utilities

import assert from "assert";
import {
  BehaviorSubject,
  Observable,
  combineLatest,
  concat,
  concatAll,
  connect,
  delay,
  distinctUntilChanged,
  filter,
  first,
  from,
  map,
  of,
  scan,
  withLatestFrom,
} from "rxjs";

/**
 * An Interruptible is a promise paired with an "interrupt" method that can be used to cause the promise to reject early.
 */
export type Interruptible<T> = {
  value: Promise<T>;
  interrupt: () => void;
};

/**
 * Creates an "interruptible" promise that never resolves and can only be interrupted
 *
 * I don't think this is going to be a daemon problem, but who knows!
 */
export function createInterruptible(): Interruptible<void> {
  const signal = {
    interrupted: false,
    reject: null as null | (() => void),
  };

  const p = new Promise<void>((resolve, reject) => {
    if (signal.interrupted) {
      reject();
    } else {
      signal.reject = reject;
    }
  });

  return {
    value: p,
    interrupt: () => {
      signal.interrupted = true;
      if (signal.reject) {
        signal.reject();
      }
    },
  };
}

/**
 * Returns a promise that sleeps for the given number of milliseconds, but can also be interrupted to return early.
 *
 * @param delay the number of milliseconds to sleep for
 * @returns an interruptible promise that resolves after the given number of milliseconds
 */
export function sleep(delay: number): Interruptible<void> {
  const sleepTime = Math.max(0, delay);
  const signal = {
    // if the promise is interrupted before it starts this flag will be set to true and the promise will reject immediately
    interrupted: false,

    // if the promise starts first, it will set this method reference to its "reject" handler
    reject: null as null | (() => void),
  };

  const p = new Promise<void>((resolve, reject) => {
    if (signal.interrupted) {
      reject();
    } else {
      const t = setTimeout(resolve, sleepTime);
      signal.reject = () => {
        clearTimeout(t);
        reject();
      };
    }
  });

  const interrupt = () => {
    signal.interrupted = true;
    if (signal.reject) {
      signal.reject();
    }
  };

  return {
    value: p,
    interrupt,
  };
}

/**
 * Wraps the given promise with an Interruptible.
 *
 * Note that this doesn't actually interrupt the promise in any way, it just lets you use a promise that can be told to reject early.
 *
 * @param promise the promise to interrupt
 */
export function asInterruptible<E>(promise: Promise<E>): Interruptible<E> {
  const interruptible = createInterruptible();

  const value = Promise.race([interruptible.value, promise])
    // if this resolved at all, it was because of the source promise, as the interruptible one never resolves.
    .then((val) => val as E);

  return {
    value,
    interrupt: interruptible.interrupt,
  };
}

/**
 * Creates a new Promise that can manualy be completed by calling the `resolve` or `reject` methods directly.
 */
export function createCompletablePromise<E>() {
  let resolvedValue = null as null | { value: E };
  let rejectedValue = null as null | { error: unknown };

  let Presolve = null as null | ((v: E) => void);
  let Preject = null as null | ((e: unknown) => void);

  const promise = new Promise<E>((resolve, reject) => {
    if (resolvedValue !== null) {
      resolve(resolvedValue.value);
    } else if (rejectedValue !== null) {
      reject(rejectedValue.error);
    } else {
      Presolve = resolve;
      Preject = reject;
    }
  });

  return {
    /**
     * The promise to be waited on
     */
    promise,
    /**
     * Resolves the completable Promise using the given value.
     *
     * If the promise is already completed (resolved or rejected), this will have no effect.
     *
     * @param value the value to resolve the promise with
     */
    resolve: (value: E) => {
      if (resolvedValue === null && rejectedValue === null) {
        resolvedValue = { value };
        if (Presolve !== null) {
          Presolve(value);
        }
      }
    },
    /**
     * Rejects the completable Promise using the given error.
     *
     * If the promise is already completed (resolved or rejected), this will have no effect.
     *
     * @param the error to reject the promise with
     */
    reject: (error: unknown) => {
      if (resolvedValue === null && rejectedValue === null) {
        rejectedValue = { error };
        if (Preject !== null) {
          Preject(error);
        }
      }
    },
  };
}

export type CompletablePromise<E> = ReturnType<
  typeof createCompletablePromise<E>
>;

export class QueueCompleteError extends Error {}

export type Queue<E> = {
  /**
   * Retrieves the next value from this queue. If a value is available, it will be returned immediately, otherwise a promise will be returned that resolves when an item is added to the queue.
   * @returns the next available value in the queue
   * @throws the error passed to `close()` if the queue has been closed
   */
  take: () => Promise<E>;
  /**
   * Returns as many items in the queue that can be returned synchronously without waiting
   */
  drain: () => E[];
  /**
   * Signals to the producer supplying this queue that it is no longer going to be used
   * @returns
   */
  close: () => void;
};

/**
 * BlockingQueue maintains a buffer of items that tasks can consume.
 *
 * There is no limit to the size of the queue or the number of tasks that can be waiting for items to consume.
 */
export class BlockingQueue<E> implements Queue<E> {
  // Only one of these two arrays should ever have items in it. Either we are adding items too fast and the "values" array will fill up, or we are consuming values too fast and the "waiters" array will fill up.
  // If we ever have both values and waiters at the same time, something horrible has happened.

  /** The values in this queue that have yet to be consumed. This is only not-readonly so that it can be `drain`-ed and replaced with an empty array. */
  private values = [] as E[];
  /** The tasks that are waiting for new values to be added to this queue. */
  private waiters = [] as CompletablePromise<E>[];

  private complete = false;
  endSignal: unknown;

  constructor() {}

  /**
   * Adds a value to the end of this queue. If there are any tasks waiting for items, they will be invoked immediately with the new value.
   *
   * @param value the value to be added to the queue
   * @throws QueueCompleteError if the queue has been closed
   */
  offer(value: E) {
    if (this.complete) {
      throw new QueueCompleteError();
    }

    // if there are waiters, take the first one and pass the value to it
    if (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      waiter.resolve(value);
    } else {
      // add it to the values queue
      this.values.push(value);
    }
  }

  /**
   * Retrieves the next value from this queue. If a value is available, it will be returned immediately, otherwise a promise will be returned that resolves when an item is added to the queue.
   * @returns the next available value in the queue
   * @throws the error passed to `close()` if the queue has been closed
   */
  take(): Promise<E> {
    // if there are values, take one immediately
    if (this.values.length > 0) {
      return Promise.resolve(this.values.shift()!);
    } else {
      // if there are no items left and the queue is complete, there won't be any more items
      if (this.complete) {
        return Promise.reject(this.endSignal);
      }

      // add yourself as a waiter to this queue
      const promise = createCompletablePromise<E>();
      this.waiters.push(promise);
      return promise.promise;
    }
  }

  /** Returns an array of all values in the queue that can be taken without waiting */
  drain(): E[] {
    const values = this.values;
    this.values = [] as E[];
    return values;
  }

  /**
   * Wakes up any tasks waiting for an item from this queue by rejecting their promises.
   *
   * After closing a queue, items may no longer be added to it
   */
  close(error: unknown = new QueueCompleteError()) {
    const waiters = this.waiters;
    this.waiters = [];
    this.complete = true;
    this.endSignal = error;
    waiters.forEach((waiter) => waiter.reject(error));
  }
}

function mapAsyncBuffered<A, B>(
  source: Observable<A>,
  transform: (_: A) => Promise<B>,
): Observable<B> {
  return source.pipe(
    map(transform),
    map((p) => from(p)),
    concatAll(),
  );
}

function mapAsyncDrop<A, B>(
  source: Observable<A>,
  transform: (_: A) => Promise<B>,
): Observable<B> {
  return new Observable((subscriber) => {
    // create a "control" subject to prevent the source from emitting results while a promise is executing
    const working = new BehaviorSubject(false);

    // use a new transformer that notifies the behaviorsubject while it is working
    const monitoringTransformer = (input: A) => {
      // set the flag indicating that a transformation is happening
      working.next(true);
      // run the transformation
      return (
        transform(input)
          // when it's done, set the "working" flag back to false to indicate that the transformer is idle
          .finally(() => working.next(false))
      );
    };

    const filteredSource = source.pipe(
      // combine the results emitted from the source with the "working" status of the most recent promise
      withLatestFrom(working),
      // if there was an async processing operation underway, "working" would be true, so only let through the items that were emitted while the operation was not "working"
      filter((item) => !item[1]),
      // extract the item itself (discard the working status)
      map((item) => item[0]),
      // run the monitoring transformer to turn this into a promise
      map(monitoringTransformer),
      // turn the promise into an observable
      map(from),
      // concat all the observables together into a single pipeline
      concatAll(),
    );

    return filteredSource.subscribe(subscriber);
  });
}

/**
 * Maps the given asyncronous transform across the items emitted by the given source observable, returning a new observable that contains the resolved items.
 *
 * @param source the source observable to read items from
 * @param transform the transformation operation to apply
 * @param buffer if true, then results will be buffered so that results produced by long running transformations still appear in the correct order on the output observable. If false, then items emitted from the source while a transformation is ongoing will be skipped in the output
 * @returns a new observable that emits the result of applying the given transformation to the items emitted by the source.
 */
export function mapAsync<A, B>(
  source: Observable<A>,
  transform: (_: A) => Promise<B>,
  buffer = true,
): Observable<B> {
  return buffer
    ? mapAsyncBuffered(source, transform)
    : mapAsyncDrop(source, transform);
}

export type Lazy<E> = () => E;

/** Returns a new supplier function that caches the first value returned from the given supplier function */
export function lazy<E>(supplier: () => E): Lazy<E> {
  let value = null as null | { v: E };

  return () => {
    if (value === null) {
      value = { v: supplier() };
    }
    return value.v;
  };
}

/**
 * Creates an observables that emits items from the given source only if they are increasing in value as determined by the given comparator function
 *
 * @param source the source observable to read from
 * @param comparator a comparator function that returns true if the `next` item is "greater" than the `current` item.
 * @return an observable that emits filtered items
 */
export function increasing<E>(
  source: Observable<E>,
  comparator: (current: E, next: E) => boolean,
): Observable<E> {
  type Wrapper<E> = { value: E } | null;

  return source.pipe(
    scan((acc, next) => {
      if (acc === null) {
        return { value: next };
      } else {
        const current = acc.value;
        if (comparator(current, next)) {
          return { value: next };
        } else {
          return null;
        }
      }
    }, null as Wrapper<E>),
    filter((v) => v !== null),
    map((w) => w!.value),
  );
}

/**
 * Monitors the given observable for activity, emitting a "true" the first time the source emits a value, and a "false" if it doesn't emit a value for more than the given number of milliseconds.
 *
 * Hint: use "connect" to attach this to an active observable without generating a new subscription
 *
 * @param source
 * @param interval the maximum amount of time between emissions (in milliseconds) before the source is considered inactive
 */
export function isActive(
  source: Observable<unknown>,
  interval: number,
): Observable<boolean> {
  const emissions = source.pipe(scan((count) => count + 1, 0));

  const checkEmissions = emissions.pipe(
    connect((es) => {
      // counts the number of emissions from the source
      // emits the same count on a delay
      const timeoutEmissions = es.pipe(delay(interval));

      // if we keep track of the latest emissions from both of these sources, if the timeout observable ever emits the same value as the most recent value emitted from the original, then the original must not have emitted a more recent value, and we can say the source is no longer active

      // However, we also need to map the first emission to a value before the timeout thing occurs, because we need "combineLatest" to work
      const firstTimeoutValue = es.pipe(
        first(),
        map(() => -1),
      );
      const prefixedTimeoutEmissions = from([
        firstTimeoutValue,
        timeoutEmissions,
      ]).pipe(concatAll());

      return combineLatest([es, prefixedTimeoutEmissions]);
    }),
  );

  // if the source emission is greater than the timeout emission, emit a "true" to indicate that it is active, otherwise, emit a false to indicate that it has timed out
  // also filter out duplicate "true" emissions from active emissions.
  const actives = checkEmissions.pipe(map(([s, d]) => s > d));

  // always end with "false"
  const endWithInactive = of(false);

  return of(actives, endWithInactive).pipe(
    concatAll(),
    // filter out duplicate "true" emissions and a possibly duplicate "false" at the end
    distinctUntilChanged(),
  );
}

export function collect<E>(o: Observable<E>) {
  const queue = new BlockingQueue<E>();

  const subscription = o.subscribe({
    next(value) {
      try {
        queue.offer(value);
      } catch (err) {
        // only error to be thrown is if the queue is closed, ignore it.
        // TODO figure out how to release the subscription properly
      }
    },
    complete() {
      queue.close();
    },
    error(err) {
      queue.close(err);
    },
  });

  return {
    take: () => queue.take(),
    drain: () => queue.drain(),
    close: () => {
      subscription.unsubscribe();
      queue.close();
    },
  };
}

type Collection<E> = ReturnType<typeof collect<E>>;

type CombinedObservableValues<T> = {
  [K in keyof T]: T extends Observable<infer E> ? E : never;
};

// lets do the easy version of synchronize first
/**
 * Returns an Observable that emits "synchronized" values emitted from the given source observables.
 *
 * The source observables must emit values that consistently increase in "version", otherwise, this won't work.
 *
 * Marballs:
 * a:    -----1-------2-------5-------6-|
 * b:    ----------1-----------2-3-4---5-----6-------7--|
 * sync: ----------[1,1]-------[2,2]---[5,5]-[6,6]|
 *
 * @param sources
 * @param getVersion a function that calculates the current "version" of the returned items
 * @returns
 */
export function synchronize<E, T extends Observable<E>[]>(
  sources: T,
  getVersion: (_: E) => number,
): Observable<CombinedObservableValues<T>> {
  return new Observable<CombinedObservableValues<T>>((subscriber) => {
    // collect everything up into queues
    const queues = [] as Collection<E>[];
    for (const source of sources) {
      queues.push(collect(source));
    }

    const interrupt = () => {
      for (const queue of queues) {
        queue.close();
      }
    };

    synchronizeImpl<E>(queues, getVersion, (_) =>
      subscriber.next(_ as CombinedObservableValues<T>),
    )
      .then(() => subscriber.complete())
      .catch((e) => subscriber.error(e));

    return interrupt;
  });
}

async function synchronizeImpl<E>(
  sources: Collection<E>[],
  getVersion: (_: E) => number,
  out: (_: E[]) => void,
) {
  try {
    while (true) {
      // get a value from each queue
      const latestValues = await Promise.all(
        sources.map(async (source) => {
          const latestValue = await source.take();
          const version = getVersion(latestValue);
          return {
            source,
            latestValue,
            version,
          };
        }),
      );

      // find the value with the highest "version"
      const maxVersion = Math.max(
        ...latestValues.map((value) => value.version),
      );

      // take values from any source that isn't synchronized with the latest source until they all match
      const synchronizedValues = await Promise.all(
        latestValues.map((value) => {
          if (value.version === maxVersion) {
            // if the item is already at the target version, don't do any waiting
            return Promise.resolve(value.latestValue);
          } else {
            return takeUntilVersion(value.source, getVersion, maxVersion);
          }
        }),
      );

      // all values should now be synchronized, or we will have run out of items
      const versions = synchronizedValues.map(getVersion);
      assert(
        Math.min(...versions) === Math.max(...versions),
        "Synchronize didn't work",
      );

      out(synchronizedValues);
    }
  } catch (err) {
    if (err instanceof QueueCompleteError) {
      // if we got a queue complete error while waiting for an item from one of the queues, then we cannot synchronize any more items and we can complete the observable normally
      return;
    } else {
      throw err;
    }
  }
}

async function takeUntilVersion<E>(
  source: Collection<E>,
  getVersion: (_: E) => number,
  version: number,
): Promise<E> {
  while (true) {
    const next = await source.take();

    const v = getVersion(next);
    if (v === version) {
      return next;
    }
  }
}

/* The hard option, where everything is a tuple and you can provide either an item with a version, or an observable with a getter that calcualtes the verison */

type Versioned = {
  getVersion: () => number;
};

type Versionable<E> = {
  source: Observable<E>;
  getVersion: (_: E) => number;
};

type Synchronizable = Observable<Versioned> | Versionable<any>;

type SynchronizedValue<V> = V extends Observable<infer E>
  ? E extends Versioned
    ? E
    : never
  : V extends Versionable<infer E>
  ? E
  : never;

type Synchronizables = [...Synchronizable[]];

type SynchronizedValues<T extends Synchronizables> = {
  [K in keyof T]: SynchronizedValue<T[K]>;
};

export const operators = {
  /**
   * An operator that maps one value to another using an asynchronous function. The mapped items are guaranteed to be emitted in the same order as the source items.
   *
   * @param transform an asynchronous function that transforms the input items from the source type into the destination type
   * @param buffer if false, then any items emitted by the source while a previous item is being transformed will be dropped. Default: true
   */
  mapAsync:
    <A, B>(transform: (_: A) => Promise<B>, buffer = true) =>
    (o: Observable<A>) =>
      mapAsync(o, transform, buffer),
  /**
   * Filters out any items from the input observable that are not greater than the most recently emitted value, as determined by the given comparator function
   *
   * example using > as comparator
   * input:   -1-2-4-3-5-5-5-2-7-8-1-|
   * out >:   -1-2---3-5-------7-8---|
   */
  increasing:
    <E>(comparator: (current: E, next: E) => boolean) =>
    (o: Observable<E>) =>
      increasing(o, comparator),
  /**
   * Creates an Observable that emits "true" when the source first starts emitting items, and emits "false" if it hasn't emitted an item for more than the given interval amount. After becoming "inactive" again, it will emit "true" if the source starts emitting more items.
   * @param interval
   * @returns
   */
  isActive: (interval: number) => (o: Observable<unknown>) =>
    isActive(o, interval),
};
