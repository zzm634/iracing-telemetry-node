// Various async utilities

/**
 * An Interruptible is a promise paired with an "interrupt" method that can be used to cause the promise to reject early.
 */
export type Interruptible<T> = {
    value: Promise<T>,
    interrupt: () => void,
}

/**
 * Creates an "interruptible" promise that never resolves and can only be interrupted
 * 
 * I don't think this is going to be a daemon problem, but who knows!
 */
export function createInterruptible(): Interruptible<void> {
    const signal = {
        interrupted: false,
        reject: null as null | (() => void),
    }

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
        }
    }
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
    }

    const p = new Promise<void>((resolve, reject) => {
        if (signal.interrupted) {
            reject();
        } else {
            const t = setTimeout(resolve, delay);
            signal.reject = () => {
                clearTimeout(t);
                reject();
            }
        }
    });

    const interrupt = () => {
        signal.interrupted = true;
        if (signal.reject) {
            signal.reject()
        }
    }

    return {
        value: p,
        interrupt
    }
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
        .then((val) => (val as E));

    return {
        value,
        interrupt: interruptible.interrupt
    }
}