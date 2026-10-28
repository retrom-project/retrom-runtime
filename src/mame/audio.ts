import type {MameCore} from "./core.js";
import {StereoPcmAudio} from "../provider/stereo-pcm-audio.js";

export class MameAudio extends StereoPcmAudio {
  constructor(rate: number) {super(rate, 8192, "MAME_AUDIO_INVALID");}
  push(core: MameCore) {
    this.pushCore(core, core._retrom_mame_audio_count(), () => core._retrom_mame_audio());
  }
}
