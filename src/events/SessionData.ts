import yaml from "js-yaml";
import { lazy } from "../async";
import { SessionDataGenerated } from "../generated/session";
import { Merge } from "../utils";

/**
 * `SessionDataGenerated` contains fields generated using quicktype. Use this type to define manual overrides for fields that are known to be optional, or of specific enum types.
 *
 * Note that this doesn't actually convert anything, it just lets us replace `number` or `string` with enums.  If we want to actually parse fields, we need to add getters to `SessionData`
 */
type KnownSessionFields = {};

type SessionDataRaw = Merge<KnownSessionFields, SessionDataGenerated>;

/**
 * SessionData contains information parsed from the SessionInfo YAML string.
 *
 * Session data fields can vary greatly between tracks, race types, and cars. Type information for sessions will be added incrementally as more test data becomes available.
 */
export class SessionData {
  public readonly getRaw;
  constructor(
    sessionYaml: string,
    public readonly version: number,
  ) {
    this.getRaw = lazy(
      () =>
        yaml.load(sessionYaml, {
          json: true, // allow values to overlap eachother, rather than throwing an error. why is this not the default.
        }) as SessionDataRaw,
    );
  }
}
