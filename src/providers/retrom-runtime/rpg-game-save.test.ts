import {expect, it} from "vitest";
import {retromRuntimeProviderDefinition} from "./catalog.js";
import {projectProviderManifest} from "../../provider/manifest.js";

it.each(["2000", "2003", "xp", "vx", "vx-ace", "mv", "mz"])("RPG Maker %s exposes only in-game save semantics", engine => {
  const target = projectProviderManifest(retromRuntimeProviderDefinition).targets.find(target => target.id === `rpgmaker-${engine}`)!;
  expect(target.checkpoint).toMatchObject({semantics: "GAME_SAVE", writeFormat: "rpgmaker-game-save-v1-storage-v1",
    readFormats: ["rpgmaker-game-save-v1-storage-v1"]});
});
