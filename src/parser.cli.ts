import path from "path";
import { FileDataSource } from "./buffers.js";
import { readIBT } from "./parser.js";
import { TelemetrySample } from "./TelemetrySample.js";

// just a test

async function run() {
  const start = performance.now();

  const filePath = path.join(
    ".",
    "test-data",
    "trucks silverado2019_newhampshire oval 2023-07-15 18-24-24.ibt",
  );

  const dataSource = new FileDataSource(filePath);

  let samples = 0;

  await readIBT(
    dataSource,
    () => false,
    (data) => {
      if (data instanceof TelemetrySample) {
        samples++;
      }

      if (samples % 128 === 0) {
        console.log(samples);
      }
    },
  );

  const end = performance.now();

  console.log({ samples, duration: end - start });
}

run().then(() => console.log("done"));
