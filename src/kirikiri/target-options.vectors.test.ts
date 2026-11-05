import {expect, it} from "vitest";
import vectors from "./target-options.vectors.json" with {type: "json"};
import {kirikiriEngineArguments} from "./arguments.js";
import {kirikiriOverlayArchives} from "./overlays.js";

type Vector = {field: "engineArguments" | "overlayArchives"; name: string; valid: boolean; value?: unknown};
const rules = {engineArguments: kirikiriEngineArguments, overlayArchives: kirikiriOverlayArchives};

// The server host asserts the same vectors (host/internal/rules/target_options_test.go).
it.each((vectors.vectors as Vector[]).map(vector => [`${vector.field}: ${vector.name}`, vector] as const))(
  "%s", (_, vector) => {
    const value = "value" in vector ? vector.value : undefined;
    if (!vector.valid) {
      expect(() => rules[vector.field](value)).toThrow();
      return;
    }
    expect(rules[vector.field](value)).toEqual(value === undefined ? [] : value);
  });
