import type {RuntimeEventV1, RuntimeStartupInteractionV1} from "./module-api.js";

/** Owns a single startup question independently of the pending adapter mount. */
export class StartupInteraction {
  private pending: {interaction: RuntimeStartupInteractionV1; resolve: (id: string) => void; reject: (error: Error) => void} | null = null;
  constructor(private readonly emit: (event: RuntimeEventV1) => void) {}

  request = (interaction: RuntimeStartupInteractionV1): Promise<string> => {
    if (this.pending || !validInteraction(interaction)) {throw new Error("PLAYER_STARTUP_INTERACTION_INVALID");}
    return new Promise((resolve, reject) => {
      this.pending = {interaction, resolve, reject};
      this.emit({type: "STARTUP_INTERACTION", interaction});
    });
  };

  respond(id: string, choiceId: string) {
    const pending = this.pending;
    if (!pending || pending.interaction.id !== id || !pending.interaction.choices.some(choice => choice.id === choiceId)) {
      throw new Error("PLAYER_STARTUP_INTERACTION_INVALID");
    }
    this.pending = null;
    this.emit({type: "STARTUP_INTERACTION", interaction: null});
    pending.resolve(choiceId);
  }

  cancel() {
    const pending = this.pending;
    this.pending = null;
    if (!pending) {return;}
    this.emit({type: "STARTUP_INTERACTION", interaction: null});
    pending.reject(new DOMException("Aborted", "AbortError"));
  }
}

function validInteraction(value: RuntimeStartupInteractionV1) {
  return typeof value?.id === "string" && value.id.length > 0 && value.id.length <= 100 &&
    typeof value.title === "string" && value.title.length > 0 && value.title.length <= 500 &&
    Array.isArray(value.choices) && value.choices.length > 0 && value.choices.length <= 9999 &&
    new Set(value.choices.map(choice => choice.id)).size === value.choices.length &&
    value.choices.every(choice => typeof choice.id === "string" && choice.id.length > 0 && choice.id.length <= 100 &&
      typeof choice.label === "string" && choice.label.length > 0 && choice.label.length <= 1000);
}
