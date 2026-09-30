import {materializeFileBytes, type AdapterContentSession} from "../provider/content-inputs.js";
export type ContentFile={url:string;sha256:string;sizeBytes:number};
export type FirmwareFile=ContentFile&{path:string};
export type SymbianInputs={game:ContentFile;firmware:readonly FirmwareFile[]};
export async function prepareInputs(config:SymbianInputs,session:AdapterContentSession,signal?:AbortSignal){
  const rom=config.firmware.filter(file=>file.path.toLowerCase()==="nokia5320.rom");
  const rpkg=config.firmware.filter(file=>file.path.toLowerCase()==="nokia5320.rpkg");
  if(config.firmware.length!==2||rom.length!==1||rpkg.length!==1)throw new Error("EKA2L1_FIRMWARE_INVALID");
  const sis=await materializeFileBytes(session,config.game,session.inputPolicy("game"),"GAME",signal);
  const romBytes=await materializeFileBytes(session,rom[0],session.inputPolicy("external"),"FIRMWARE",signal);
  const rpkgBytes=await materializeFileBytes(session,rpkg[0],session.inputPolicy("external"),"FIRMWARE",signal);
  return {sis,rom:romBytes,rpkg:rpkgBytes};
}
