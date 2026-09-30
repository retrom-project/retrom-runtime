import {eagerPolicy} from "../../provider/content-policies.js";
import {defineAdapter,defineTarget} from "../../provider/declarations.js";
export const eka2l1Adapter=defineAdapter({id:"eka2l1-web",kind:"EKA2L1_WEB",abi:"eka2l1-browser-v1",
  capabilities:{checkpoint:true,pause:true,screenshot:true,standardGamepad:true,frameCounter:true,volume:false},
  checkpoint:{writeFormat:"eka2l1-game-save-v1",readFormats:["eka2l1-game-save-v1"],semantics:"GAME_SAVE"},
});
export const eka2l1Target=defineTarget({id:"symbian-eka2l1",displayName:"Symbian S60v3 (EKA2L1)",adapterId:eka2l1Adapter.id,
  checkpointMaxBytes:64*1024*1024,frameMode:"SAME_ORIGIN_BLANK",requiresThreads:true,
  contentIO:{game:eagerPolicy(128*1024*1024,{writes:"SESSION_OVERLAY"}),external:eagerPolicy(512*1024*1024)},
  inputs:[{role:"game",kind:"ROM_BLOB",cardinality:"ONE",optional:false},
    {role:"external",kind:"EXTERNAL_FILE_SET",cardinality:"ONE",optional:false}],
  targetOptionsSchema:{type:"object",additionalProperties:false,properties:{
    uid:{type:"integer",minimum:0,maximum:4294967295},rotation:{type:"string",enum:["0","180","270","90"]},
    confirmKey:{type:"string",enum:["CENTER","ENTER","NUM5"]}},required:["confirmKey","rotation","uid"]},
  implementation:{},inputFilter:true,discSwitch:false,nativeSettings:false,videoModes:["original","pixel","smooth"],
  assetPaths:["assets/eka2l1/eka2l1-runtime.zip"],
});
