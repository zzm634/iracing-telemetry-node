// Various async utilities

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

/**
 * BlockingQueue maintains a buffer of items that tasks can consume.
 *
 * There is no limit to the size of the queue or the number of tasks that can be waiting for items to consume.
 */
export class BlockingQueue<E> {
  // Only one of these two arrays should ever have items in it. Either we are adding items too fast and the "values" array will fill up, or we are consuming values too fast and the "waiters" array will fill up.
  // If we ever have both values and waiters at the same time, something horrible has happened.

  /** The values in this queue that have yet to be consumed. This is only not-readonly so that it can be `drain`-ed and replaced with an empty array. */
  private values = [] as E[];
  /** The tasks that are waiting for new values to be added to this queue. */
  private waiters = [] as CompletablePromise<E>[];

  constructor() {}

  /** Adds a value to the end of this queue. If there are any tasks waiting for items, they will be invoked immediately with the new value. */
  offer(value: E) {
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
   * @returns a Promise that resolves when a value is available in the queue
   */
  take(): Promise<E> {
    // if there are values, take one immediately
    if (this.values.length > 0) {
      return Promise.resolve(this.values.shift()!);
    } else {
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
   * Note that this does not actually close the queue; items can still be added to it and tasks can still wait for items in the future.
   */
  close() {
    const waiters = this.waiters;
    this.waiters = [];
    waiters.forEach((waiter) => waiter.reject(new Error("Queue is closing")));
  }
}
