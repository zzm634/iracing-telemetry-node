import path from "path";
import { FileDataSource } from "./buffers";
import { TelemetryMetadata, readIBT } from "./parser";
import { SessionData } from "./events/SessionData";
import { readdir, appendFile, unlink } from "fs/promises";
import { createWriteStream } from "fs";
import { BlockingQueue, QueueCompleteError } from "./async";
import { TelemetrySample } from "./events/TelemetrySample";
import { sample } from "rxjs";

// attempts to automatically generate type information from telemetry files and stuff

async function run() {
  const start = performance.now();

  const filePath = path.join(".", "test-data", "ibt");

  const outputPath = path.join(".", "test-data", "quicktype");
  const sessionOutputPath = path.join(outputPath, "sessions.json");
  const telemetryOutputPath = path.join(outputPath, "telemetry.json");

  // delete output files so we can overwrite them
  //await Promise.all([unlink(sessionOutputPath).catch(), unlink(telemetryOutputPath).catch()]);

  await appendFile(sessionOutputPath, "[");
  await appendFile(telemetryOutputPath, "[");

  const testFiles = await readdir(filePath);

  for (const testFile of testFiles) {
    const dataSource = new FileDataSource(path.join(filePath, testFile));

    const sampleQueue = new BlockingQueue<SessionData | TelemetryMetadata>();
    // start reading and dumping data into this queue
    const ibtReader = readIBT(
      dataSource,
      () => false,
      (data) => {
        if (data instanceof SessionData || data instanceof TelemetryMetadata) {
          sampleQueue.offer(data);
        }
      },
    ).then(() => sampleQueue.close());

    while (true) {
      let data;
      try {
        data = await sampleQueue.take();
      } catch (err) {
        if (err instanceof QueueCompleteError) {
          break;
        } else {
          throw err;
        }
      }

      if (data instanceof SessionData) {
        await appendFile(sessionOutputPath, JSON.stringify(data.getRaw()));
      } else {
        await appendFile(telemetryOutputPath, JSON.stringify(data.getVars()));
      }
    }
  }

  await appendFile(sessionOutputPath, "]");
  await appendFile(telemetryOutputPath, "]");
}

run().then(() => console.log("done"));
