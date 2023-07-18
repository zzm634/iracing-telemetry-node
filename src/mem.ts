// memory-mapped files and other windows events

import { Observable } from "rxjs";
import { Interruptible } from "./async";
import ref from "ref-napi";
import ffi from "ffi-napi";

/**
 * Opens the memory-mapped file indentified by the given name, copies its entire contents to a buffer and closes the file.
 *
 * @param fileName the name of the memory mapped file to read
 * @returns a buffer containing a copy of the data stored in the memory mapped file
 */
export function readMemoryMappedFile(fileName: string): Promise<Buffer> {
  // TODO
  return Promise.reject(new Error("Not yet implemented"));
}

type Handle = unknown;

/** Opens a handle to the event identified by the given name */
function openEvent(topic: string): Promise<Handle> {
  // TODO
  return Promise.reject(new Error("Not yet implemented"));
}

/** Closes given event handle and releases resources associated with it */
function closeHandle(handle: Handle): Promise<void> {
  // TODO
  return Promise.reject(new Error("Not yet implemented"));
}

/**
 * Returns a promise that resolves when the next event from the given topic is triggered.
 *
 * If a timeout value is provided, the promise will resolve with the value "false" if it resolved because the timeout was exceeded. If the promise resolved because the event was triggered, it will resolve with "true".
 *
 * If provided, the timeout must be greater than zero.
 *
 * @param handle a reference to the opened event to listen to
 * @param timeoutMs the maximum number of milliseconds to wait for the next event. If provided, it must be greater than zero
 */
function waitForNextEventHandle(
  handle: Handle,
  timeoutMs?: number,
): Promise<boolean> {
  if (timeoutMs !== undefined && timeoutMs <= 0) {
    throw new Error("timeout must be undefined or greater than 0.");
  }

  // TODO
  return Promise.reject(new Error("Not yet implemented"));
}

/**
 * Creates an observable that, when subscribed to, opens the event identified by the given topic name and calls `next()` every time the topic event is triggered.
 *
 * If the code consuming this observable is too slow, it may be possible to miss triggered events.
 */
export function createEventObservable(topic: string): Observable<void> {
  return new Observable<void>((subscriber) => {
    let interrupted = false;
    const isInterrupted = () => interrupted;
    const interrupt = () => {
      interrupted = true;
    };

    const out = () => {
      subscriber.next();
    };

    emitEvents(topic, out, isInterrupted)
      .then(() => subscriber.complete())
      .catch((err) => subscriber.error(err));

    return interrupt;
  });
}

/**
 * Opens the topic and emits events until it is interrupted.
 *
 * @param topicName the name of the topic to subscribe to
 * @param out a callback function that will be invoked every time the topic produces an event
 * @param err a callback method that accepts errors that occur if there is a problem opening or waiting for the topic
 * @param isInterrupted a callback method that can be checket to see if this event emitter should stop listening for events
 */
async function emitEvents(
  topicName: string,
  out: () => void,
  isInterrupted: () => boolean,
) {
  let eventHandle = null as null | Handle;

  eventHandle = await openEvent(topicName);

  try {
    while (!isInterrupted()) {
      await waitForNextEventHandle(eventHandle);
      out();
    }
  } finally {
    await closeHandle(eventHandle);
  }
}

/**
 * Waits for a single event identified by the given topic name to be triggered.
 */
export async function waitForNextEvent(topic: string): Promise<void> {
  const handle = await openEvent(topic);
  await waitForNextEventHandle(handle);
  await closeHandle(handle);
}

//import koffi, { KoffiFunc, as } from "koffi";

/* windows stuff */
// const libKernel32 = koffi.load("kernel32.dll");

// const HANDLE = koffi.opaque("HANDLE");
// const DWORD = koffi.alias("DWORD", "uint32");
// const BOOL = koffi.alias("BOOL", "bool");
// const LPCWSTR = koffi.alias("LPCWSTR", "str16");
// const PVOID = koffi.pointer("uint8");
// const WORD = koffi.alias("WORD","uint16");
// const LPCVOID = koffi.opaque("LPCVOID");
// const LPVOID = koffi.pointer("uint8");

// const SIZE_T = koffi.alias("SIZE_T", "uint64");
// const MEMORY_BASIC_INFORMATION = koffi.struct("MEMORY_BASIC_INFORMATION", {
//     BaseAddress: PVOID,
//     AllocationBase: PVOID,
//     AllocationProtect: DWORD,
//     PartitionId: WORD,
//     RegionSize: SIZE_T,
//     State: DWORD,
//     Protect: DWORD,
//     Type: DWORD
// });
// const PMEMORY_BASIC_INFORMATION = koffi.pointer(MEMORY_BASIC_INFORMATION);

// type Handle = unknown;
// type Pointer = unknown;

// const kernel32 = {
//     OpenEventW: libKernel32.func("OpenEventW", HANDLE, [DWORD, BOOL, LPCWSTR]) as
//         KoffiFunc<(desiredAccess: number, inheritHandle: boolean, name: string) => Handle>,
//     WaitForSingleObject: libKernel32.func("WaitForSingleObject", DWORD, [HANDLE, DWORD]) as
//         KoffiFunc<(handle: Handle, milliseconds: number) => number>,
//     CloseHandle: libKernel32.func("CloseHandle", BOOL, [HANDLE]) as
//         KoffiFunc<(handle: Handle) => boolean>,
//     OpenFileMappingW: libKernel32.func("OpenFileMappingW", HANDLE, [DWORD, BOOL, LPCWSTR]) as
//         KoffiFunc<(desiredAccess: number, inheritHandle: boolean, name: string) => Handle>,
//     VirtualQuery: libKernel32.func("VirtualQuery", SIZE_T, [LPCVOID, koffi.out(PMEMORY_BASIC_INFORMATION), SIZE_T]) as
//         KoffiFunc<(pointer: Pointer, memoryBasicInformation: Buffer, bufferSize: number) => number>,
//     MapViewOfFile: libKernel32.func("MapViewOfFile", LPVOID, [HANDLE, DWORD, DWORD, DWORD, SIZE_T]) as
//         KoffiFunc<(handle: Handle, desiredAccess: number, fileOffsetHigh: number, fileOfffsetLow: number, numberOfBytesToMap: number) => Pointer>
// }

// const M_AccessFlags = {
//     DELETE: 0x00010000,
//     READ_CONTROL: 0x0020000,
//     SYNCHRONIZE: 0x00100000,
//     WRITE_DAC: 0x00040000,
//     WRITE_OWNER: 0x00080000,
//     EVENT_ALL_ACCESS: 0x1F0003,
//     EVENT_MODIFY_STATE: 0x2,
// }

// enum EVENT_WAIT_CODE {
//     WAIT_ABANDONED = 0x80,
//     WAIT_OBJECT_0 = 0,
//     WAIT_TIMEOUT = 0x102,
//     WAIT_FAILED = 0xFFFFFFFF,
// }

// function openEventHandle(
//     name: string,
//      desiredAccess: (keyof typeof M_AccessFlags)[] = ["SYNCHRONIZE"],
//      inheritHandle = true): Promise<Handle> {

//     let dwDesiredAccess = 0;
//     for(const accessFlag of desiredAccess) {
//         dwDesiredAccess |= M_AccessFlags[accessFlag];
//     }

//     return new Promise((res,rej) => {
//         kernel32.OpenEventW.async(dwDesiredAccess, inheritHandle, name, (err, result) => {
//             if(err) {
//                 rej(err);
//             } else {
//                 res(result);
//             }
//         });
//     });
// }

// function waitForSingleObject(handle: Handle, timeoutMs: number): Promise<EVENT_WAIT_CODE> {
//     return new Promise((res,rej) => {
//         kernel32.WaitForSingleObject.async(handle, timeoutMs, (err, result) => {
//             if(err) {
//                 rej(err);
//             } else {
//                 res(result as EVENT_WAIT_CODE);
//             }
//         });
//     });
// }

// function closeHandle(handle: Handle): Promise<boolean> {
//     return new Promise((res, rej) => {
//         kernel32.CloseHandle.async(handle, (err, result) => {
//             if(err) {
//                 rej(err);
//             } else {
//                 res(result);
//             }
//         });
//     });
// }

// function getMappedFileSize(view: Pointer): Promise<number> {
//     return new Promise((res, rej) => {
//         const memInfoBuffer = Buffer.allocUnsafe(koffi.sizeof(MEMORY_BASIC_INFORMATION));

//         kernel32.VirtualQuery.async(view, memInfoBuffer, memInfoBuffer.byteLength, (err, result) => {
//             if(err) {
//                 rej(err);
//             } else {
//                 const memInfo = koffi.decode(memInfoBuffer, MEMORY_BASIC_INFORMATION, memInfoBuffer.byteLength);

//                 res(memInfo.RegionSize as number);
//             }
//         });
//     });
// }

// function openFileMapping(string: name): Promise<Buffer>

const HANDLE = ref.types.void;
const DWORD = ref.types.uint32;
const BOOL = ref.types.bool;
const LPCWSTR = ref.refType;

// lets try this again
const libKernel32 = ffi.Library("kernel32.dll", {
  OpenEventW: [HANDLE, [DWORD, BOOL]],
});
