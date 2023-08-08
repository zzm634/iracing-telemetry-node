export type Merge<A, B> = A extends Record<any, any>
  ? B extends Record<any, any>
    ? {
        [k in keyof A | keyof B]: k extends keyof A
          ? k extends keyof B
            ? Merge<A[k], B[k]>
            : A[k]
          : k extends keyof B
          ? B[k]
          : never;
      }
    : A
  : A extends never
  ? B
  : A;
