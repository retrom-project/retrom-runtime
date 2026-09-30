import {describe, expect, it, vi} from "vitest";
import {gamepadKeys, keyboardKey, updateKeys} from "./input.js";
const config = {rotation:270, confirmKey:"ENTER" as const};
const pad=(buttons:number[],axes=[0,0])=>({connected:true,mapping:"standard" as const,axes,
  buttons:Array.from({length:16},(_,index)=>({pressed:buttons.includes(index),value:buttons.includes(index)?1:0}))});
describe("Symbian keypad",()=>{
  it("rotates directions to match the displayed phone orientation",()=>{
    expect([...gamepadKeys([pad([15])],config)]).toEqual([17]);
    expect(keyboardKey("ArrowRight",config)).toBe(17);
    expect(keyboardKey("ArrowLeft",config)).toBe(16);
    expect(keyboardKey("ArrowUp",config)).toBe(15);
    expect(keyboardKey("ArrowDown",config)).toBe(14);
    expect([...gamepadKeys([pad([],[-1,0])],config)]).toEqual([16]);
  });
  it("maps each action button to exactly one guest key",()=>{
    for(const [button,key] of [[0,3],[1,4],[2,5],[3,167],[8,164],[9,3]])
      expect([...gamepadKeys([pad([button])],config)]).toEqual([key]);
    expect([...gamepadKeys([pad([0])],{...config,confirmKey:"CENTER"})]).toEqual([167]);
    expect([...gamepadKeys([pad([0])],{...config,confirmKey:"NUM5"})]).toEqual([53]);
    expect(keyboardKey("Space",config)).toBe(5);
    expect(keyboardKey("Digit7",config)).toBe(55);
  });
  it("ignores disconnected/nonstandard pads and releases held keys",()=>{
    expect(gamepadKeys([{...pad([0]),connected:false},{...pad([0]),mapping:""}],config).size).toBe(0);
    const send=vi.fn();updateKeys(new Set([3,17]),new Set([3,16]),send);
    expect(send.mock.calls).toEqual([[17,false],[16,true]]);
    send.mockClear();updateKeys(new Set([3,16]),new Set(),send);
    expect(send.mock.calls).toEqual([[3,false],[16,false]]);
  });
});
