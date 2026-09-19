import type {ScheduleOptions} from "./scheduler.js";
export type {ContentReadOriginV1 as ReadOrigin} from "../../contracts/content-io/v1/content-io.js";
import type {ContentReadOriginV1 as ReadOrigin} from "../../contracts/content-io/v1/content-io.js";
export type ReadObserver = (origin: ReadOrigin, length: number) => void;
export type ReadOptions = ScheduleOptions & {copied?: ReadObserver};
/** Counts consumer copies, never the physical size of a fetched block/window. */
export class ReadAccounting {
  private memoryHitBytes = 0;
  private persistentHitBytes = 0;
  readonly copied: ReadObserver = (origin, length) => {
    if (origin === "MEMORY") {this.memoryHitBytes += length;}
    if (origin === "PERSISTENT") {this.persistentHitBytes += length;}
  };
  get counts() {return {memoryHitBytes: this.memoryHitBytes, persistentHitBytes: this.persistentHitBytes};}
}
