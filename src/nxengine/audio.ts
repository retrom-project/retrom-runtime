import type {NXEngineCore} from "./core.js";
import {StereoPcmAudio} from "../provider/stereo-pcm-audio.js";

export class NXEngineAudio extends StereoPcmAudio {
  constructor(rate: number) {super(rate, 4096, "NXENGINE_AUDIO_INVALID");}
  push(core: NXEngineCore) {
    this.pushCore(core, core._retrom_audio_count(), () => core._retrom_audio());
  }
}
