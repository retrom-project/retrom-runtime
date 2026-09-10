const configurationPath = "/data/saves/SAME_CDI/same_cdi/cfg/cdimono1.cfg";

// EmulatorJS 4.2.3's CD-i mapping, with one native target per button.
// A new save mount has no machine configuration until the first core exit.
const initialConfiguration = `<mameconfig version="10"><system name="cdimono1">
  <video><target index="0" view="Main Screen Standard (4:3)"/></video><input>
  <port tag=":slave_hle:MOUSEBTN" type="P1_BUTTON1" mask="1" defvalue="0"><newseq type="standard">JOYCODE_1_BUTTON4</newseq></port>
  <port tag=":slave_hle:MOUSEBTN" type="P1_BUTTON2" mask="2" defvalue="0"><newseq type="standard">JOYCODE_1_BUTTON2</newseq></port>
  <port tag=":slave_hle:MOUSEBTN" type="P1_BUTTON3" mask="4" defvalue="0"><newseq type="standard">JOYCODE_1_BUTTON1</newseq></port>
  <port tag=":slave_hle:MOUSEX" type="P1_MOUSE_X" mask="65535" defvalue="0">
    <newseq type="standard">NONE</newseq><newseq type="increment">JOYCODE_1_HAT1RIGHT</newseq><newseq type="decrement">JOYCODE_1_HAT1LEFT</newseq>
  </port>
  <port tag=":slave_hle:MOUSEY" type="P1_MOUSE_Y" mask="65535" defvalue="0">
    <newseq type="standard">NONE</newseq><newseq type="increment">JOYCODE_1_HAT1DOWN</newseq><newseq type="decrement">JOYCODE_1_HAT1UP</newseq>
  </port>
</input></system></mameconfig>`;

export type SameCdiConfigurationIO = {
  FS?: {
    analyzePath: (path: string) => {exists: boolean};
    readFile: (path: string, options: {encoding: "utf8"}) => unknown;
  };
  writeFile?: (path: string, content: string) => void;
};

export function configureSameCdiInput(manager: SameCdiConfigurationIO) {
  if (!manager.FS || !manager.writeFile) {throw unavailable();}
  const source = manager.FS.analyzePath(configurationPath).exists
    ? manager.FS.readFile(configurationPath, {encoding: "utf8"}) : initialConfiguration;
  if (typeof source !== "string") {throw unavailable();}
  const document = new DOMParser().parseFromString(source, "text/xml");
  if (document.querySelector("parsererror") || document.documentElement.tagName !== "mameconfig" ||
    document.documentElement.getAttribute("version") !== "10") {throw unavailable();}
  for (const axis of ["X", "Y"]) {
    const ports = document.querySelectorAll(`system[name="cdimono1"] > input > port[tag=":slave_hle:MOUSE${axis}"][type="P1_MOUSE_${axis}"][mask="65535"][defvalue="0"]`);
    if (ports.length !== 1) {throw unavailable();}
    // Digital directions drive CD-i's relative pointer. The native increment 2
    // disappears when software discards three low bits; -2 still rounds to -1.
    // Keep native button/axis sequences and physical mouse sensitivity intact.
    ports[0].setAttribute("keydelta", "20");
  }
  manager.writeFile(configurationPath, new XMLSerializer().serializeToString(document));
}

function unavailable() {return new Error("PLAYER_RUNTIME_CONFIG_UNAVAILABLE");}
