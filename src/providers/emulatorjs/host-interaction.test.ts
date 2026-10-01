import {expect, it} from "vitest";
import {launchEnvelope} from "../../../tests/emulatorjs-provider-fixtures.js";
import {providerInputCapabilities} from "../../provider/input-capabilities.js";
import {emulatorJsProviderDefinition} from "./catalog.js";
import {retromRuntimeProviderDefinition} from "../retrom-runtime/catalog.js";
import {emulatorCheckpointAvailability} from "./lifecycle.js";

it.each(["atari800", "atari800-xegs", "hatarib", "theodore", "fceumm"])(
  "declares shortcut ownership for %s inside the Provider", (targetId) => {
    expect(providerInputCapabilities(emulatorJsProviderDefinition, targetId)).toEqual({
      hostShortcuts: targetId === "fceumm" ? ["PAUSE", "MENU"] : ["MENU"],
    });
  },
);

it("reports the required user action when a DOS program has not been selected", () => {
  const envelope = launchEnvelope(); envelope.runtime.targetId = "dosbox-pure";
  envelope.targetOptions.dosEntryPath = null;
  expect(emulatorCheckpointAvailability(envelope, null, "dosbox_pure", null)).toEqual({
    available: false, reason: "PROGRAM_SELECTION_REQUIRED", requiredAction: "SELECT_PROGRAM",
  });
});

it.each(["bbc-jsbeeb", "samcoupe"])("preserves computer keyboard ownership for %s", (targetId) => {
  expect(providerInputCapabilities(retromRuntimeProviderDefinition, targetId)).toEqual({hostShortcuts: ["MENU"]});
});


it("clears the program-selection action after a launch selects a program", () => {
  const envelope = launchEnvelope(); envelope.runtime.targetId = "dosbox-pure";
  envelope.targetOptions.dosEntryPath = "GAME.EXE";
  expect(emulatorCheckpointAvailability(envelope, null, "dosbox_pure", null)).toEqual({
    available: false, reason: "NOT_READY",
  });
});
