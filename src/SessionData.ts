import yaml from "js-yaml";

export class SessionData {
  public readonly raw: any;
  constructor(
    sessionYaml: string,
    public readonly version: number,
  ) {
    this.raw = yaml.load(sessionYaml, {
      json: true, // allow values to overlap eachother, rather than throwing an error. why is this not the default.
    });
  }
}
