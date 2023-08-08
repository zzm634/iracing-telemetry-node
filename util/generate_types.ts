import { readdir, writeFile } from "fs/promises";
import path from "path/posix";
import {
  quicktype,
  InputData,
  jsonInputForTargetLanguage,
} from "quicktype-core";
import { fromIBTFile } from "../src/sources";
import { Observable, filter, firstValueFrom } from "rxjs";
import { SessionData, TelemetryMetadata } from "..";
import { fstat } from "fs";

// Reads sample IBT files and generates types for session data
async function generate() {
  const sessionDataSamples = [] as string[];

  const telemVars;

  const filePath = path.join(".", "test-data", "ibt");

  for (const sampleFileName of await readdir(filePath)) {
    const sampleFile = path.join(filePath, sampleFileName);

    const fileObs = fromIBTFile(sampleFile);

    const sessionObs = fileObs.pipe(
      filter((evt) => evt instanceof SessionData),
    ) as Observable<SessionData>;

    const sessionData = await firstValueFrom(sessionObs);

    sessionDataSamples.push(JSON.stringify(sessionData.getRaw()));

    const metaObs = fileObs.pipe(
      filter((evt) => evt instanceof TelemetryMetadata),
    ) as Observable<TelemetryMetadata>;

    const telemMeta = await firstValueFrom(metaObs);

    telemMeta.getVars();
  }

  const jsonInput = jsonInputForTargetLanguage("typescript");
  await jsonInput.addSource({
    name: "SessionData_Generated",
    samples: sessionDataSamples,
  });

  const inputData = new InputData();
  inputData.addInput(jsonInput);

  const result = await quicktype({
    inputData,
    lang: "typescript",
    alphabetizeProperties: true,
    rendererOptions: {
      "just-types": true,
      "prefer-unions": true,
      "prefer-types": true,
    },
  });

  const outputPath = path.join(".", "src", "generated", "session.ts");

  await writeFile(outputPath, result.lines.join("\n"));
}

generate()
  .then(() => console.log("done"))
  .catch((err) => console.error("failed", err));
