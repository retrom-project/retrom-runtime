import type {NativeCore} from "./core.js";
import {StereoPcmAudio} from "../provider/stereo-pcm-audio.js";

export class FantasyAudio extends StereoPcmAudio {
  constructor(rate: number) {super(rate, 4096, "FANTASY_AUDIO_INVALID");}
  push(core: NativeCore) {
    this.pushCore(core, core._retrom_audio_count(), () => core._retrom_audio());
  }
}
