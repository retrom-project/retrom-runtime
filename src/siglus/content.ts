import type {AdapterContentOptions} from "../provider/content-inputs.js";
import {IndexedProjectContent} from "../provider/indexed-project-content.js";

export class SiglusContent extends IndexedProjectContent {
  constructor(options: AdapterContentOptions) {super(options, "SIGLUS_PROJECT_INDEX_INVALID");}
}
