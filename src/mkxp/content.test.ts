import {expect,it,vi} from "vitest";
import {MkxpContent} from "./content.js";
import {abi,contractSha256} from "../content-io/identity.js";
it("[BR-05] UNIT/mkxp registers capability metadata without opening files and denies late zero reads after close",async()=>{
 const reader={abi,id:crypto.randomUUID(),sizeBytes:5368709243,readInto:vi.fn(async(_offset:number,bytes:Uint8Array)=>{bytes.fill(7);return bytes.length;}),tryReadInto:vi.fn(),close:vi.fn(async()=>{}),stream:vi.fn()};
 const session={open:vi.fn(async()=>reader),materialize:vi.fn(),closeFile:vi.fn()};
 const content=new MkxpContent({contentSession:session,assetIndex:{}},vi.fn());
 const source={url:`${location.origin}/game`,sha256:"a".repeat(64),sizeBytes:reader.sizeBytes};
 const entry=content.register(source,"/game/日本語.mkxpz","GAME");
 expect(content.manifest()).toBe(`RETROM_CONTENT_IO_V1\n${entry.id}\t5368709243\t/game/日本語.mkxpz\n`);
 expect(session.open).not.toHaveBeenCalled();expect(content.bridge).toMatchObject({abi,contractSha256});
 const bytes=new Uint8Array(8);expect(await content.bridge.readIntoById(entry.id,4294967331,bytes)).toBe(8);
 expect(reader.readInto).toHaveBeenCalledWith(4294967331,bytes,expect.any(AbortSignal));
 await content.close();expect(reader.close).toHaveBeenCalledOnce();
 await expect(content.bridge.readIntoById(entry.id,0,new Uint8Array(0))).rejects.toThrow("CONTENT_IO_ABORTED");
});
