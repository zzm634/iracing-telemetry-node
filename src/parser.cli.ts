import path from "path";
import { FileDataSource } from "./buffers.js";
import { readIBT } from "./parser.js";

// just a test 

async function run() {

    const filePath = path.join(".","test-data","trucks silverado2019_newhampshire oval 2023-07-15 18-24-24.ibt");

    const dataSource = new FileDataSource(filePath);

    await readIBT(dataSource, () => false, (data) => console.log("IRData:", data));
}

run().then(() => console.log("done"));