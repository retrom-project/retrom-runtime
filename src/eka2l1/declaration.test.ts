import {describe,expect,it} from "vitest";
import {retromRuntimeProviderDefinition as definition} from "../providers/retrom-runtime/catalog.js";
describe("Symbian admission contract",()=>{
  it("requires a native package, both firmware files, threads and full caching",()=>{
    const target=definition.targets.find(target=>target.id==="symbian-eka2l1");
    expect(target).toMatchObject({requiresThreads:true,frameMode:"SAME_ORIGIN_BLANK",
      inputs:[{role:"game",kind:"ROM_BLOB",optional:false},{role:"external",kind:"EXTERNAL_FILE_SET",optional:false}],
      contentIO:{game:{mode:"EAGER",writes:"SESSION_OVERLAY"},external:{mode:"EAGER"}}});
    const adapter=definition.adapters.find(adapter=>adapter.id===target?.adapterId);
    expect(adapter).toMatchObject({abi:"eka2l1-browser-v1",capabilities:{standardGamepad:true,checkpoint:true,volume:false},
      checkpoint:{writeFormat:"eka2l1-game-save-v1-storage-v1",semantics:"GAME_SAVE"}});
  });
});
