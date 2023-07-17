// Messing around

type EnumVal<N extends string, V> = {
    name: N,
    value: V,
}

export type Enum<KEYS extends string, VALUES> = {
    [nam in KEYS]: VALUES
} & Iterable<EnumVal<KEYS,VALUES>>


const testEnum = {
    IRCHAR: 1,
    IRBOOL: 2,
    IRTEST: 3,
}

type TestE = Enum<keyof typeof testEnum, number>;

const TestEInstance = {} as TestE;
TestEInstance.IRBOOL;
for(const val of TestEInstance) {
    val.name
}

export function createEnum<K extends string, V>(values: Record<K,V>): Enum<K,V> {
    const allValues: EnumVal<string, V>[] = [];
    const e: any = {};
    for(const name in values) {
        const value = values[name] as V;
        const enumVal = {
            name,
            value
        }
        allValues.push(enumVal);
        e[name] = value;
    }
    e[Symbol.iterator] = () => allValues[Symbol.iterator]();

    return e as Enum<K, V>
}

const FooEnum = createEnum({
    foo: 1,
    bar: 2,
    baz: 3
});

