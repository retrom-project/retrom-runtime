import type {Px68kCore} from "./core.js";
import {StereoPcmAudio} from "../provider/stereo-pcm-audio.js";

export class Px68kAudio extends StereoPcmAudio {
  constructor(rate: number) {super(rate, 4096, "PX68K_AUDIO_INVALID");}
  push(core: Px68kCore) {
    this.pushCore(core, core._retrom_audio_count(), () => core._retrom_audio());
  }
}
