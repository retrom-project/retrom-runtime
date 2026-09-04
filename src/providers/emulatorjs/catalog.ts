import {
  defineAdapter, defineProvider, defineTarget, type TargetInputDeclaration, type TargetOptionsSchema,
} from "../../provider/declarations.js";
import {emulatorJsNetplayProfiles} from "./netplay-profile.js";

const emulatorJsOptionsSchema = {
  additionalProperties: false,
  properties: {
    dosEntryPath: {format: "safe-path", maxLength: 240, type: ["string", "null"]},
    initialDiscIndex: {minimum: 0, type: ["integer", "null"]},
  },
  required: ["dosEntryPath", "initialDiscIndex"],
  type: "object",
} as const satisfies TargetOptionsSchema;

const capabilities = {
  checkpoint: true,
  frameCounter: true,
  pause: true,
  screenshot: true,
  standardGamepad: true,
  validationProbes: [] as const,
  volume: true,
};

const adapters = [
  defineAdapter({
    abi: "emulatorjs-state-v1", capabilities,
    checkpoint: {readFormats: ["emulatorjs-state-v1"], writeFormat: "emulatorjs-state-v1"},
    id: "emulatorjs-4.2.3", kind: "EMULATORJS_4_2_3",
  }),
  defineAdapter({
    abi: "emulatorjs-state-v1", capabilities,
    checkpoint: {readFormats: ["emulatorjs-state-v1"], writeFormat: "emulatorjs-state-v1"},
    id: "emulatorjs-4.3.0-pre", kind: "EMULATORJS_4_3_0_PRE",
  }),
] as const;

const inputs = [
  {cardinality: "ONE", kind: "ROM_BLOB", optional: false, role: "game"},
  {cardinality: "ONE", kind: "BIOS_BUNDLE", optional: true, role: "bios"},
  {cardinality: "ONE", kind: "PARENT_ARCHIVE", optional: true, role: "parent"},
  {cardinality: "ONE", kind: "MULTI_DISC", optional: true, role: "discs"},
  {cardinality: "ONE", kind: "EXTERNAL_FILE_SET", optional: true, role: "external"},
] as const satisfies readonly TargetInputDeclaration[];

type RuntimeRelease = "4.2.3" | "4.3.0-pre";
type InputMode = "STANDARD" | "POINTER";
type StartupAction = {
  event: "GAME_START";
  kind: "PRESS_CONTROL";
  delayMs: number;
  player: number;
  control: number;
  durationMs: number;
};

type CoreSource = {
  id: string;
  release: RuntimeRelease;
  coreBundleVersion: string;
  artifactFlavor: "WASM" | "THREAD_WASM" | "OVERRIDE";
  asset: string;
  sizeBytes: number;
  sha256: string;
  artifactSetSha256: string;
  requiresThreads: boolean;
  canvasResizePolicy: "NONE" | "ON_GAME_START_TO_CSS_PIXELS";
  defaultOptions: Readonly<Record<string, string>>;
  inputMode: InputMode;
  startupActions: readonly StartupAction[];
  contentKinds: readonly ("SINGLE_FILE" | "DOS_BUNDLE" | "MULTI_DISC")[];
};

const cores: readonly CoreSource[] = [
  core("a5200", "4.2.3", "a5200-wasm.data", 881560, "c82476478d6b70b9da80cccc27ca06a5fd85acf7cdd5643f230cc4d6777990ef", "c402648f858a8a566b39c8d0949470eeeda5f0346b8dfc6228dad312a0af295d"),
  core("azahar", "4.3.0-pre", "azahar-thread-wasm.data", 3985011, "d90696e6ea68c4fc00ef147411ad399962777f07b6c7e73d5537da0eaffc2e3b", "77bf9b92bdc0f55b5d2dc5c2394971fe40b80b10b79fc40501db07d199bed94c", {inputMode: "POINTER", defaultOptions: {webgl2Enabled: "enabled"}}),
  core("beetle_vb", "4.2.3", "beetle_vb-wasm.data", 858313, "3db727a78b6a6551a4024c273069eb39c8e8f33aa78ef16a073ed7460f6ce692", "71604fbf1001fc5d053b08ce5f8396a1da456f176a0b3106eff08f7cac3e5986", {startupActions: [press(2000, 0), press(4000, 3), press(15000, 3), press(25000, 3)]}),
  core("desmume", "4.2.3", "desmume-wasm.data", 1172604, "a9fddaa4bd742e558dfe5095fa4eaf074493b591a7bc18c5f7c65d64b9fa7572", "970284459eedf8f7345d2b02d564dc7d32e7029aa8009011a8474df94244d57c", {inputMode: "POINTER"}),
  core("desmume2015", "4.2.3", "desmume2015-wasm.data", 1043573, "6f45da7f37007c0a69b7d91490b43e8294d4d642d1cc4ac999b341416f1ce13f", "5fc49392b5b73cd59446bf2ff6e01f4a2a9a7c07761cdb724ac1712bcc69ac0f", {inputMode: "POINTER"}),
  core("dosbox_pure", "4.3.0-pre", "dosbox_pure-thread-wasm.data", 1827779, "89b0e89b03ced9ba07c5fe27bc789fd0f42bd5378b399f93befa2edc3571a70a", "da9d4f66147c00ad9a9f75b6c0e4dc26fa779c425739c7835067574a9612d72e", {contentKinds: ["DOS_BUNDLE"]}),
  core("fbalpha2012_cps1", "4.2.3", "fbalpha2012_cps1-wasm.data", 1031240, "15b47667eb3c3746649c79e997b9f8c463f83bed9f61f51322cbe4db3d6e078e", "8e95c25731ad4868449f5bb6f8b238c8fa6ea2352e117817b124764354465da9"),
  core("fbalpha2012_cps2", "4.2.3", "fbalpha2012_cps2-wasm.data", 992866, "432c2dd513603b04ccbf4e81f282f012763d2435311805443e2bd0cc9021d8d1", "73ac6fc4b1a2030701471b630e658118486e99c6c7349663dadcde4abeab6e5d"),
  core("fbneo", "4.2.3", "fbneo-wasm.data", 8273551, "315a25e0bcd61d58ee0d9e8b1dbf3740b9e0ca4b7d0726f848ce1068de73437c", "cbd006664ec1c76f6bdad7747d487ee137ae70d15390ec479e11f8e17f01bc84"),
  core("fceumm", "4.2.3", "fceumm-wasm.data", 1054015, "8c449fd5c36646fb0769423ed6ffa9efbdfc21fbfdc9bac7952b559d34d5b493", "d1a20a10b27908b6f199ed8d10f7ccf4376065b8a733492aee53b4d4a2c2f26d"),
  core("gambatte", "4.2.3", "gambatte-wasm.data", 967156, "ad67c7bf57f8f8b62606048e6ea498afac5b5abc76ad8de5f9dfc2a6719374bb", "c1d7561f109647715f8795c8fa977318dc78bfc847cd8879bb029d62c55fa605"),
  core("genesis_plus_gx", "4.2.3", "genesis_plus_gx-wasm.data", 1203661, "190297a6f86757405090f1a2266f67dfe1a570a528c583434ed3641a5664f768", "a102b02756ca10a97e87bddc85228ca466ab75ba4b1fa6f6938e59e8343c4b4b"),
  core("genesis_plus_gx_wide", "4.3.0-pre", "genesis_plus_gx_wide-wasm.data", 1007775, "653b59f5b4c3147c6786313ecd60c6657b1bc0d465814919d363728afa93b2e0", "76fc52778209b88d6e7c22aa921d735c9bb8dbf53fea08e74ec08ce3c26b6d60"),
  core("handy", "4.2.3", "handy-wasm.data", 862304, "ab49f61338fcc3b79a945b02005815066c4d9aadb8de6ab59c408dc158aaeeff", "7fdd80119886994285f34905a38b7159d6c807539d0533bbd786ec442023a810"),
  core("mame2003", "4.2.3", "mame2003-wasm.data", 4993110, "1d8283ce042f71607b9b55656cd4068f703c52faa7a3d0940855c9dd21d542df", "92a7d5f005aa6667fb712e1bedd1cd5864780e4854f6a5dd620ffb955ed87e3e", {artifactFlavor: "OVERRIDE", canvasResizePolicy: "ON_GAME_START_TO_CSS_PIXELS", coreBundleVersion: "4.2.1"}),
  core("mame2003_plus", "4.2.3", "mame2003_plus-wasm.data", 5391355, "cb6d9c80a88b65d1579d16d02128a678f8d1cd3f51de1479e647cea27b13247b", "233ae3603dd1889ca00273373e8b83503b8ae59951453e91f3f2bfee362848ea"),
  core("mednafen_ngp", "4.2.3", "mednafen_ngp-wasm.data", 871904, "cdfe377bd380e418507dccda50d8664eecb06ebe1d2e5fbf5f397be859d1c83d", "9705cd898514bb807cfad0db67473e6f1e2db98152da802dad024a3d7243f0c5"),
  core("mednafen_pce", "4.2.3", "mednafen_pce-wasm.data", 994844, "29cebda0c7a93bbcb5e67e97fe28a1886bd030715d5a25224e7d9175d1d985c3", "e53f98ae4711886d3a6baf7072804145d4dbba265b598e726a7835c7d0fafdd0"),
  core("mednafen_pcfx", "4.2.3", "mednafen_pcfx-wasm.data", 953008, "7a49a92992d463afc1f414dc5f3eff99613ae9340fbf137a10b6df0ac890f29e", "3f4cc068607aab63cb9391842bdd1403c658503a7ee0de9624840178e89c6da6"),
  core("mednafen_psx_hw", "4.2.3", "mednafen_psx_hw-thread-wasm.data", 1273844, "6e8c9ca50daba3d4c1e1e36f9b9328b8ff52232caf4613cfc6808d755dfcf304", "97a56622113bcf94ba635097eb487d9d4720b9113cf9dc8e0314f07944413a03", {defaultOptions: {beetle_psx_hw_renderer: "software"}}),
  core("mednafen_wswan", "4.2.3", "mednafen_wswan-wasm.data", 879301, "234397276e4a8ff01485e0135ea8e89e78e60fc156120e41bd0a4dd3b4c71626", "9464c4678de89cf1f9a22e8b6d46fc1b9c39b942e8cac7a637562b49799c12ea"),
  core("melonds", "4.2.3", "melonds-wasm.data", 1194723, "f3ad9e42bb3ccd5c9bece23445b56e2d10d2cae8cc33a2c0591529d0a83cdfeb", "a49a496144b36878d44947a042a229a31b91aa59bda98c8b5e9e3f38cbe2a9c2", {inputMode: "POINTER"}),
  core("mgba", "4.2.3", "mgba-wasm.data", 1055616, "01fcaf6d4296ef1db6676e0c69400c4474e24572d0b2b99cc097e4ae885e02d7", "e21839353146c163d01400509dd77ef0fa03b6d8a77ffe93f0a6a424a971dac5"),
  core("mupen64plus_next", "4.2.3", "mupen64plus_next-wasm.data", 1451795, "2da1cbce9fda395e3ae83ca5787353baa159142d45ef3ea90f108b92524f76cc", "1471de394753ecff65b8945f8656c3187c8c2ba1119ac432e4b2a65e20167a07"),
  core("nestopia", "4.2.3", "nestopia-wasm.data", 1219547, "051de1b67a5b582b8a1bac6b99471d4f9f883ce3b3603d00330c1a066e546375", "513140634c8fe76611e0231be5a782805ce3217be17da39941bbac64b075a229"),
  core("opera", "4.2.3", "opera-wasm.data", 854147, "3e737f4f739814c12c017a5f26cb1e43bdfe3ac6f2d3bf6e8972633df49e33d4", "7e08a187b7a7309f754fd2a2be20aa97fa4bdf22d930d0b92686d00593e209f6", {defaultOptions: {opera_nvram_storage: "per game"}}),
  core("parallel_n64", "4.2.3", "parallel_n64-wasm.data", 1028134, "873755608d41a604f3eee11b631f1cbe7e4d8c4d10c92859c27941299c8ef6a6", "570e28f134062f8681992b5160b8c503f23e492e2a10d852cca86da3c926f07a"),
  core("pcsx_rearmed", "4.2.3", "pcsx_rearmed-wasm.data", 1039627, "fe5515f6c29f093f0e8c01824b213804f1f76eb9cb4c97c72fe2cc17606bfbc2", "14cafda8e2a977fe406ffe7f6b66eebe1b35981cafafefbfa7436f68e79a8520"),
  core("picodrive", "4.2.3", "picodrive-wasm.data", 1034483, "bb5d50b8b88111b583977d2f7a16d01a822b3deda9205048d99ecaad2c56d861", "043ab4ae01f3018243aaf1dce6d5eb1ce098c146154be8f8a50914a4e42edfb0"),
  core("ppsspp", "4.2.3", "ppsspp-thread-wasm.data", 4581537, "cb46c33a3a8444b707f7a03fe00414d916ab55a41e85fbf0c59611aa643252da", "c7144f68b64b5ba826562049dccaae0586a48403a6bdc65dade0bfa06c0f8523", {startupActions: [press(2000, 0), press(5000, 0)]}),
  core("prosystem", "4.2.3", "prosystem-wasm.data", 852864, "d3483e1c155c8d26e6b7b299c8ecc58c5abcfa0c5af5f03b75a55d219e71c3c8", "5ab7fa94d4cc9da68fff24911d76a32d3fba8ffbecd3fec740a1992670df809e"),
  core("smsplus", "4.2.3", "smsplus-wasm.data", 855876, "0f197c5e0000f17b2d072122a72b3f8fc1693514c4014fcd9694eec78584aa08", "a09612f1d088bffe8d9c107caf196b023710ed4aaeaa24f05caee7eec8591ff0"),
  core("snes9x", "4.2.3", "snes9x-wasm.data", 1093765, "eaa0bcfce67673809886e50387a80a616b719502175db64c090d04c9d75958ee", "f2ecf64d84dc3845ccd9828daf48436667f6aa79e6a5d6c41f0965f0151f1f34"),
  core("stella2014", "4.2.3", "stella2014-wasm.data", 1051659, "6c96c6b1746f3f05ca599066abe131a36c77ca61fc20a9e2a7560540457c487d", "f5244febaf876003e9acf97e09b8785f1f51563c3f96527232652c1d9ec40e68"),
  core("yabause", "4.2.3", "yabause-wasm.data", 991166, "ab253ac263bd98e3124e2ca45ff581e97673426ed06ecec0025333060cd8127c", "1fc177e7be4923208b92755bcfae66ac35ba6e395c3b7ea48df581806ebdf6a6", {contentKinds: ["SINGLE_FILE", "MULTI_DISC"]}),
] as const;

const targets = cores.map((entry) => {
  const netplayProfile = emulatorJsNetplayProfiles[entry.id] ?? null;
  return defineTarget({
  adapterId: entry.release === "4.3.0-pre" ? "emulatorjs-4.3.0-pre" : "emulatorjs-4.2.3",
  assetPaths: [
    ...commonAssets(entry.release),
    entry.asset,
    `assets/${entry.release}/data/cores/reports/${entry.id}.json`,
  ].sort(compareUtf8),
  checkpointMaxBytes: 256 * 1024 * 1024,
  discSwitch: entry.id === "yabause",
  displayName: displayName(entry.id),
  frameMode: "SAME_ORIGIN_BLANK",
  id: providerTargetId(entry.id),
  implementation: {
    artifactFlavor: entry.artifactFlavor,
    artifactSetSha256: entry.artifactSetSha256,
    canvasResizePolicy: entry.canvasResizePolicy,
    contentKinds: entry.contentKinds,
    coreAssetPath: entry.asset,
    coreBundleVersion: entry.coreBundleVersion,
    coreSha256: entry.sha256,
    coreSizeBytes: entry.sizeBytes,
    defaultOptions: entry.defaultOptions,
    inputMode: entry.inputMode,
    netplayProfile,
    release: entry.release,
    runtimeCore: entry.id,
    startupActions: entry.startupActions,
  },
  inputs,
  inputFilter: true,
  nativeSettings: true,
  netplayPort: netplayProfile !== null,
  targetOptionsSchema: emulatorJsOptionsSchema,
  requiresThreads: entry.requiresThreads,
  videoModes: ["adaptive-sharpen", "original", "pixel", "sharp-bilinear", "smooth"],
  });
});

export const emulatorJsProviderDefinition = defineProvider({
  adapters,
  providerApiVersion: 1,
  providerId: "emulatorjs",
  providerVersion: "2.1.0",
  targets,
});

function core(
  id: string,
  release: RuntimeRelease,
  filename: string,
  sizeBytes: number,
  sha256: string,
  artifactSetSha256: string,
  overrides: Partial<Omit<CoreSource, "id" | "release" | "asset" | "sizeBytes" | "sha256" | "artifactSetSha256">> = {},
): CoreSource {
  const thread = filename.includes("-thread-wasm.data");
  return {
    artifactFlavor: thread ? "THREAD_WASM" : "WASM",
    artifactSetSha256,
    asset: `assets/${release}/data/cores/${filename}`,
    canvasResizePolicy: "NONE",
    contentKinds: ["SINGLE_FILE"],
    coreBundleVersion: release,
    id,
    inputMode: "STANDARD",
    release,
    requiresThreads: thread,
    sha256,
    sizeBytes,
    startupActions: [],
    ...overrides,
    defaultOptions: {webgl2Enabled: "enabled", ...overrides.defaultOptions},
  };
}

function press(delayMs: number, control: number): StartupAction {
  return {control, delayMs, durationMs: 120, event: "GAME_START", kind: "PRESS_CONTROL", player: 0};
}

function commonAssets(release: RuntimeRelease) {
  const paths = release === "4.2.3" ? [
    "data/loader.js", "data/emulator.min.js", "data/emulator.min.css", "data/emulator.css",
    "data/src/emulator.js", "data/src/nipplejs.js", "data/src/shaders.js", "data/src/storage.js",
    "data/src/gamepad.js", "data/src/GameManager.js", "data/src/socket.io.min.js", "data/src/compression.js",
    "data/compression/extract7z.js", "data/compression/extractzip.js", "data/localization/en-US.json",
    "data/localization/zh-CN.json", "data/localization/retroarch.json", "data/cores/cores.json",
    "data/cores/ppsspp-assets.zip",
  ] : [
    "data/loader.js", "data/emulator.min.js", "data/emulator.min.css", "data/emulator.css",
    "data/src/cache.js", "data/src/compression.js", "data/src/consts.js", "data/src/emulator.js",
    "data/src/GameManager.js", "data/src/gamepad.js", "data/src/license.js", "data/src/netplay.js",
    "data/src/setup.js", "data/src/shaders.js", "data/src/storage.js", "data/src/utils.js",
    "data/src/vendor/nipplejs.js", "data/src/vendor/socket.io.min.js", "data/compression/extract7z.js",
    "data/localization/en.json", "data/localization/zh.json", "data/localization/retroarch.json",
  ];
  return paths.map((path) => `assets/${release}/${path}`);
}

function displayName(value: string) {
  return value.split("_").map((part) => part.length <= 3 ? part.toUpperCase() :
    `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

function providerTargetId(runtimeCore: string) {return runtimeCore.replaceAll("_", "-");}

function compareUtf8(left: string, right: string) {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const sharedLength = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const difference = leftBytes[index] - rightBytes[index];
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}
