import {providerVersion} from "../../provider/version.js";
import {emulatorContentPolicies} from "../../provider/content-policies.js";
import {storageAdapters} from "../../provider/checkpoint-storage.js";
import {
  defineAdapter, defineProvider, defineTarget, type TargetInputDeclaration, type TargetOptionsSchema,
} from "../../provider/declarations.js";

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
  volume: true,
};

const adapters = [
  defineAdapter({
    abi: "emulatorjs-state-v1", capabilities,
    checkpoint: {readFormats: ["gam4980-state-v1", "gam4980-state-v1-storage-v1", "gam4980-state-v2"], writeFormat: "gam4980-state-v2"},
    id: "emulatorjs-gam4980", kind: "EMULATORJS_4_2_3",
  }),
  defineAdapter({
    abi: "emulatorjs-flycast-state-v1", capabilities,
    checkpoint: {readFormats: ["flycast-state-gzip-v1", "flycast-state-v1"], writeFormat: "flycast-state-v1"},
    id: "emulatorjs-flycast", kind: "EMULATORJS_FLYCAST",
  }),
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
  defineAdapter({
    abi: "emulatorjs-state-gzip-v1", capabilities,
    checkpoint: {readFormats: ["emulatorjs-state-v1", "emulatorjs-state-gzip-v1"], writeFormat: "emulatorjs-state-v1"},
    id: "emulatorjs-psp", kind: "EMULATORJS_PSP",
  }),
  defineAdapter({
    abi: "emulatorjs-state-v1", capabilities,
    checkpoint: {readFormats: ["bsnes-state-v1"], writeFormat: "bsnes-state-v1"},
    id: "emulatorjs-bsnes", kind: "EMULATORJS_4_3_0_PRE",
  }),
  defineAdapter({
    abi: "emulatorjs-lutro-native-v1", capabilities,
    checkpoint: {readFormats: ["lutro-native-v1"], writeFormat: "lutro-native-v1", semantics: "GAME_SAVE"},
    id: "emulatorjs-lutro", kind: "EMULATORJS_4_2_3",
  }),
  defineAdapter({
    abi: "emulatorjs-state-v1", capabilities: {...capabilities, checkpoint: false},
    checkpoint: null, id: "emulatorjs-daphne", kind: "EMULATORJS_4_2_3", saveSemantics: "NO_SAVE",
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
  targetId?: string;
  release: RuntimeRelease;
  coreBundleVersion: string;
  artifactFlavor: "WASM" | "THREAD_WASM" | "OVERRIDE";
  asset: string;
  sizeBytes: number;
  sha256: string;
  artifactSetSha256: string;
  requiresThreads: boolean;
  canvasResizePolicy: "NONE" | "ON_GAME_START_TO_CSS_PIXELS";
  outputSizeLimit: {width: number; height: number} | null;
  defaultOptions: Readonly<Record<string, string>>;
  inputMode: InputMode;
  startupActions: readonly StartupAction[];
  contentKinds: readonly ("SINGLE_FILE" | "DOS_BUNDLE" | "MULTI_DISC" | "DAPHNE_PROJECT")[];
};

// Replaced with an empty object by formal builds. PFB supplies only verified,
// already-declared candidates; this cannot add targets or change public contracts.
declare const __RETROM_PFB_CORE_INPUTS__: Readonly<Record<string, {
  sha256: string; sizeBytes: number; artifactSetSha256: string;
}>>;

const atari800 = core("atari800", "4.2.3", "atari800-wasm.data", 996285, "6bb6df1de70f4b71e3b382a0a238522b6d0fe7bb860c7e8e8292f055ed46fda5", "716cfb25c012e2ce682608f532b543a423514f7e029027b291fb6b48df189c47", {artifactFlavor: "OVERRIDE", coreBundleVersion: "retrom-core-g4e7fbc73765c-r1", defaultOptions: {keyboardInput: "enabled", atari800_system: "800XL (64K)", atari800_os_xl: "AltirraOS"}});
const genesisPlusGX = core("genesis_plus_gx", "4.2.3", "genesis_plus_gx-wasm.data", 1278689, "3caf013fe2d778f2f112d07d1aa8c98178e47a76148ff87bee1de0eca06099bc", "baf9aa4753a6960df773317a59be71ed38288753cfc627dcd1ab4d8ca076a14f", {artifactFlavor: "OVERRIDE", coreBundleVersion: "retrom-core-g63f0c6870601-r2"});
const flycast = core("flycast", "4.2.3", "flycast-wasm.data", 3546423, "4e2d15a35d7a28e094465ff69fe040ee428bac04f9dd955e329430ce7ebecc2f", "586230f5d991b542b7c7c14477a5fb08fb532daf6da2f69739b6ad4b4a1531cb", {artifactFlavor: "OVERRIDE", coreBundleVersion: "1.0", defaultOptions: {reicast_hle_bios: "disabled", reicast_boot_to_bios: "disabled", reicast_internal_resolution: "640x480", reicast_threaded_rendering: "disabled", reicast_alpha_sorting: "per-strip (fast, least accurate)"}});

const cores: readonly CoreSource[] = [
  atari800,
  {...atari800, targetId: "atari800-xegs", defaultOptions: {...atari800.defaultOptions, atari800_system: "XEGS"}},
  core("ardens", "4.2.3", "ardens-wasm.data", 965293, "1b883e1a62ae706dfaef7ab3156bf9c025ed65d65f9502fecb1a1e1c225899e7", "aa223f998ab2f0e5b978aa6c980a948e8f37a9e4c06ee87a4d24e01c9e2d4737", {artifactFlavor: "OVERRIDE", coreBundleVersion: "retrom-core-g661a7dd4febc-r1"}),
  core("freechaf", "4.2.3", "freechaf-wasm.data", 849285, "473218ad1fe7ad1f11cc75233c63a559159f5f2963c40ceddd5934ce77d71342", "17d5d8826d41396878a3a92787078d3463a9436f97d990063997ebddc64e9a5a", {artifactFlavor: "OVERRIDE", coreBundleVersion: "retrom-core-g76c7a84f1f7e-r1"}),
  core("hatarib", "4.2.3", "hatarib-wasm.data", 2530718, "0ceb17f4b4748585e0456fbde3ad23fc91ea5d4bad87e1e8876c5790b72c1e0d", "e07426660c57958568b18addc75034e38bd28cae739148bc7efbcbaf574022ad", {artifactFlavor: "OVERRIDE", coreBundleVersion: "retrom-core-gcceb40a9c054-r1", defaultOptions: {keyboardInput: "enabled"}}),
  core("sameduck", "4.2.3", "sameduck-wasm.data", 859071, "a4e3bc0064e2947119317ce074e4c7b4585e418312e1756705861794e3fc4542", "6c4497a706a8f0d04cdcfbb1d786cded4e9d1d66e21a5664c715f8468fa1771f", {artifactFlavor: "OVERRIDE", coreBundleVersion: "retrom-core-g5619abdb01ce-r1"}),
  core("potator", "4.2.3", "potator-wasm.data", 847829, "30e9c3b6eabe768ae2df0c272463de183bf000f668d1cb3e8c4d207dd3eaa485", "94e8b577640ebb7e86f28682c0f564ce38639b852de68fd35ff2dc8798d4be2e", {artifactFlavor: "OVERRIDE", coreBundleVersion: "retrom-core-g227c5f6f3ce7-r1"}),
  core("supermodel", "4.3.0-pre", "supermodel-wasm.data", 1365789, "16e2f956d579a1eaefc9766d1106d9bc1b9b0ad21bea267d76b07d764a307577", "292a206abdb1a6bf12c5c1f15363aa4412af3c8741ce5934a47cd3a793da4758", {artifactFlavor: "OVERRIDE", coreBundleVersion: "retrom-core-g84bc106b45b2-r1", defaultOptions: {supermodel_emulation_threading: "single", supermodel_resolution: "half", webgl2Enabled: "enabled"}}),
  core("theodore", "4.2.3", "theodore-wasm.data", 1374537, "82139675dfed5dc13116f3babf3938f814da2e10fcf1bdf32f410289b4e3a474", "facce19b44b59fc3882f2dc50173bfc3ff4eeb997d709b74b7c006b3110809ad", {artifactFlavor: "OVERRIDE", coreBundleVersion: "retrom-core-g4d469ce0f71e-r1", defaultOptions: {keyboardInput: "enabled"}}),
  core("gam4980", "4.2.3", "gam4980-wasm.data", 852549, "4b05e77e91c28a87fbf3c71880df2d06fa3dd39dacc587147c29ecaec0a9f791", "f2d8aeca9848f86afdec7cd86d06eebeae4194dd30ac725bd1a1a905bce7957c", {artifactFlavor: "OVERRIDE", coreBundleVersion: "retrom-core-geeaa531b55e7-r1", defaultOptions: {gam4980_lcd_color: "grey", gam4980_lcd_ghosting: "0"}}),
  core("neocd", "4.2.3", "neocd-wasm.data", 1080566, "3702540c38faab7d3eadae748791364d61e043b16d937b5bbae05c9c0134ec0c", "ae9dddaebf459deb11ab689c69b4f964efbf560e73a51788d9095cf24f8fec7c", {artifactFlavor: "OVERRIDE", coreBundleVersion: "retrom-core-g3118c6901787-r1", defaultOptions: {neocd_region: "Japan", neocd_cdspeedhack: "On", neocd_loadskip: "On"}}),
  core("uzem", "4.2.3", "uzem-wasm.data", 852642, "c9f0e7d66f00fdb51c82b81c1d20269689b87e7f68d82267c31e2c03a54b221c", "6cba9cc2c184cb56033f76af19c911e79d5355aa6a0afa1b25b949ff962af123", {artifactFlavor: "OVERRIDE", coreBundleVersion: "retrom-core-gd991ee94547c-r1"}),
  core("o2em", "4.2.3", "o2em-wasm.data", 905816, "051bc1b257966ef15bc255df3ea70aadec8a25a4ddb0b846a3f399db1859479d", "502ca7b9f5ed3fdedf01d98b3b5d8bce85eee79f47b01c46dc8d1f40fb06c42b", {artifactFlavor: "OVERRIDE", coreBundleVersion: "retrom-core-g679d6fec0496-r2", defaultOptions: {keyboardInput: "enabled", o2em_bios: "o2rom.bin"}}),
  core("81", "4.2.3", "81-wasm.data", 888668, "b78716a9566f7b31ad82f3d3250ba882af284294df4ec84b80012906aa1da417", "01c76aa09d95022d001e16f80e8ff32c0a62088da9445c6b321be06872943cf2", {artifactFlavor: "OVERRIDE", coreBundleVersion: "retrom-core-g86decf3ee61e-r1", defaultOptions: {keyboardInput: "enabled", "81_joypad_b": "new line"}}),
  flycast,
  {...flycast, targetId: "flycast-atomiswave"},
  {...flycast, targetId: "flycast-naomi"},
  {...flycast, targetId: "flycast-naomi2"},

  core("a5200", "4.2.3", "a5200-wasm.data", 881560, "c82476478d6b70b9da80cccc27ca06a5fd85acf7cdd5643f230cc4d6777990ef", "c402648f858a8a566b39c8d0949470eeeda5f0346b8dfc6228dad312a0af295d"),
  core("azahar", "4.3.0-pre", "azahar-thread-wasm.data", 3985011, "d90696e6ea68c4fc00ef147411ad399962777f07b6c7e73d5537da0eaffc2e3b", "77bf9b92bdc0f55b5d2dc5c2394971fe40b80b10b79fc40501db07d199bed94c", {inputMode: "POINTER", defaultOptions: {webgl2Enabled: "enabled"}}),
  core("beetle_vb", "4.2.3", "beetle_vb-wasm.data", 858313, "3db727a78b6a6551a4024c273069eb39c8e8f33aa78ef16a073ed7460f6ce692", "71604fbf1001fc5d053b08ce5f8396a1da456f176a0b3106eff08f7cac3e5986", {startupActions: [press(2000, 0), press(4000, 3), press(15000, 3), press(25000, 3)]}),
  core("bsnes", "4.3.0-pre", "bsnes-wasm.data", 1226327, "c0384975cf12d2227ccf31a03966ebf677c63fef44fc0852ef574efa2673fec1", "91994d91c9d828d8179936ada920d64b7a28cfb274ef75d560a60b46305fe610", {artifactFlavor: "OVERRIDE", coreBundleVersion: "retrom-core-g4b344745e387-r1"}),
  core("cap32", "4.2.3", "cap32-wasm.data", 1029996, "534321cbb8f3f62fd2d2c8cc01b34ae50f6315869755218f8f6fa6581aa5083b", "2b1bc24a3fef304aca5a1e2a240b3ecde947fe4f72a3af75624953ccfc4e8faf", {artifactFlavor: "OVERRIDE", coreBundleVersion: "retrom-core-g310cc579b79b-r4", defaultOptions: {keyboardInput: "enabled"}}),
  core("crocods", "4.2.3", "crocods-wasm.data", 976148, "8c70df810436f225c5a2b40f31555636d6e12eacd41968f28b7dc708a9c6db10", "51e5f77fbcd99f13c49efae470290e4d1215ad10bc992e4a3332da72568119c9", {artifactFlavor: "OVERRIDE", coreBundleVersion: "retrom-core-gbe00fb904da0-r1", defaultOptions: {keyboardInput: "enabled"}}),
  core("desmume", "4.2.3", "desmume-wasm.data", 1172604, "a9fddaa4bd742e558dfe5095fa4eaf074493b591a7bc18c5f7c65d64b9fa7572", "970284459eedf8f7345d2b02d564dc7d32e7029aa8009011a8474df94244d57c", {inputMode: "POINTER"}),
  core("desmume2015", "4.2.3", "desmume2015-wasm.data", 1043573, "6f45da7f37007c0a69b7d91490b43e8294d4d642d1cc4ac999b341416f1ce13f", "5fc49392b5b73cd59446bf2ff6e01f4a2a9a7c07761cdb724ac1712bcc69ac0f", {inputMode: "POINTER"}),
  core("dosbox_pure", "4.3.0-pre", "dosbox_pure-thread-wasm.data", 1827779, "89b0e89b03ced9ba07c5fe27bc789fd0f42bd5378b399f93befa2edc3571a70a", "da9d4f66147c00ad9a9f75b6c0e4dc26fa779c425739c7835067574a9612d72e", {contentKinds: ["DOS_BUNDLE"]}),
  core("fbalpha2012_cps1", "4.2.3", "fbalpha2012_cps1-wasm.data", 1031240, "15b47667eb3c3746649c79e997b9f8c463f83bed9f61f51322cbe4db3d6e078e", "8e95c25731ad4868449f5bb6f8b238c8fa6ea2352e117817b124764354465da9"),
  core("fbalpha2012_cps2", "4.2.3", "fbalpha2012_cps2-wasm.data", 992866, "432c2dd513603b04ccbf4e81f282f012763d2435311805443e2bd0cc9021d8d1", "73ac6fc4b1a2030701471b630e658118486e99c6c7349663dadcde4abeab6e5d"),
  core("fbneo", "4.2.3", "fbneo-wasm.data", 8273551, "315a25e0bcd61d58ee0d9e8b1dbf3740b9e0ca4b7d0726f848ce1068de73437c", "cbd006664ec1c76f6bdad7747d487ee137ae70d15390ec479e11f8e17f01bc84"),
  core("fceumm", "4.2.3", "fceumm-wasm.data", 1054015, "8c449fd5c36646fb0769423ed6ffa9efbdfc21fbfdc9bac7952b559d34d5b493", "d1a20a10b27908b6f199ed8d10f7ccf4376065b8a733492aee53b4d4a2c2f26d"),
  core("freeintv", "4.3.0-pre", "freeintv-wasm.data", 1139022, "e5f84b6a322e5b01b077e6e60895f52555af6ddc5838bfc775f946a0d44a8d6e", "9a5045b039305fbc0ed13a679cb6534980f2b2b4e1cb321ba9d109c5cc0c9062"),
  core("fuse", "4.2.3", "fuse-wasm.data", 1218229, "791fe40dfba9ac236c5c14d629d555133c5fe3c36d1dbdc2a48ced487da51373", "0f2dee6ecd4bd57fe793239ec42bd6efa4b4b8696aae4f62a2a469cad2a22f32", {defaultOptions: {keyboardInput: "enabled"}}),
  core("gambatte", "4.2.3", "gambatte-wasm.data", 967156, "ad67c7bf57f8f8b62606048e6ea498afac5b5abc76ad8de5f9dfc2a6719374bb", "c1d7561f109647715f8795c8fa977318dc78bfc847cd8879bb029d62c55fa605"),
  core("gearboy", "4.2.3", "gearboy-wasm.data", 939318, "ca08e4936a9f8b62f198f8df30fed48c5e68f06db9dd91115a2c44863054661e", "389000f4810c30180889fa6d39eb5d21b3520594c01935523f363e9fd6211248", {artifactFlavor: "OVERRIDE", defaultOptions: {gearboy_sgb: "Enabled", gearboy_sgb_border: "Enabled"}}),
  core("lutro", "4.2.3", "lutro-wasm.data", 997735, "78a74af63f9ef4a576ccff17f7e6c8c2f62a2cbf833a2ccb0d6d298653bca5bd", "405bdeb3f1b7dc57f20b32f25c3fdd1a038bd20b55f9d3b0065979c1d8cba63d", {artifactFlavor: "OVERRIDE"}),
  core("daphne", "4.2.3", "daphne-thread-wasm.data", 1220068, "61076f0b75162b5fc5794a0fcc2f8869babc4b518ee8899c1f68b55ae6550470", "78b8ac587bdbb0f2b374b68c00a05555bbdbd003979dcf3ddd268054d074f610", {artifactFlavor: "THREAD_WASM", contentKinds: ["DAPHNE_PROJECT"]}),
  core("gearcoleco", "4.2.3", "gearcoleco-wasm.data", 891907, "164e213e4d5f2c14a0f2b55da973ed5a54ef7601cb352e64c9a73ace1a7ba606", "1c377b55d252fc7133bb99b845c1bc1931a3f9989fd1410659c50bd3b2a78a4d"),
  genesisPlusGX,
  {...genesisPlusGX, targetId: "genesis_plus_gx_cd", defaultOptions: {...genesisPlusGX.defaultOptions, genesis_plus_gx_cd_precache: "disabled"}},
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
  core("ppsspp", "4.3.0-pre", "ppsspp-thread-wasm.data", 4548468, "b75f51aa9c66bfb20c3b056b0dc5f9246516648786d0f0e73d636f224ff9080f", "d3c58abe2b9a375044ea03ceca1cfd4bb035507e8c7eff5c52401a21c3bc130d", {outputSizeLimit: {width: 960, height: 544}, startupActions: [press(2000, 0), press(5000, 0)]}),
  core("prboom", "4.2.3", "prboom-wasm.data", 1091036, "830686c3b5176de25de45846f8cad9153803478718e6a487dda938437ecd0c0e", "5468d3146d11438aed17c6e7b93357912cf7638a6352edd9386ef4c2c4b8b38c"),
  core("prosystem", "4.2.3", "prosystem-wasm.data", 852864, "d3483e1c155c8d26e6b7b299c8ecc58c5abcfa0c5af5f03b75a55d219e71c3c8", "5ab7fa94d4cc9da68fff24911d76a32d3fba8ffbecd3fec740a1992670df809e"),
  core("puae", "4.2.3", "puae-thread-wasm.data", 4177580, "d06a26d1954db82c9ba9b8e16de9aed4190ef051db2d401982b728167929e006", "19ae54ea4a0ec3ec44e1e29984b8abf41f1d8e876d8ae96642c81f17bf5383f9", {coreBundleVersion: "retrom-core-g2245d3443cc1-r3", inputMode: "POINTER"}),
  core("quasi88", "4.2.3", "quasi88-wasm.data", 1041569, "c23c7f390bc5a8071a13e3c9e860c1ab96f34792bd531ca79ee12cff6a67c57d", "e3f7752189bac0b364e2fc4daf6a3a69176ccddf87c0177a30b7bc99d1621e8a", {artifactFlavor: "OVERRIDE", coreBundleVersion: "retrom-core-g459bbc6e90ca-r1", defaultOptions: {keyboardInput: "enabled", q88_basic_mode: "N88 V2"}}),
  core("same_cdi", "4.2.3", "same_cdi-wasm.data", 3492455, "4a0d2829af998d4066a12294a0ecfd1d23371bdea95906a48ef726298826a03c", "c4450a15fe43d5253ab2593a3f51d249332b92e5921ba0875cc40a9d33fda663", {artifactFlavor: "OVERRIDE", coreBundleVersion: "retrom-core-gcfb05d803f54-r1"}),
  core("smsplus", "4.2.3", "smsplus-wasm.data", 855876, "0f197c5e0000f17b2d072122a72b3f8fc1693514c4014fcd9694eec78584aa08", "a09612f1d088bffe8d9c107caf196b023710ed4aaeaa24f05caee7eec8591ff0"),
  core("snes9x", "4.2.3", "snes9x-wasm.data", 1093765, "eaa0bcfce67673809886e50387a80a616b719502175db64c090d04c9d75958ee", "f2ecf64d84dc3845ccd9828daf48436667f6aa79e6a5d6c41f0965f0151f1f34"),
  core("stella2014", "4.2.3", "stella2014-wasm.data", 1051659, "6c96c6b1746f3f05ca599066abe131a36c77ca61fc20a9e2a7560540457c487d", "f5244febaf876003e9acf97e09b8785f1f51563c3f96527232652c1d9ec40e68"),
  core("vecx", "4.2.3", "vecx-wasm.data", 856199, "bd66a59cafb8ad3f742d85f177550966f79926030aa7bd660f4ffe3a0c02c6db", "16ea415148668169b2f67f3a929cee70e26e05ca92b1d87f2a8012aeb2312ccb", {artifactFlavor: "OVERRIDE", coreBundleVersion: "retrom-core-g8f671cc9d737-r1"}),
  core("vice_x128", "4.2.3", "vice_x128-wasm.data", 1595414, "dbac85e530b006c2d17e200c445de582c7ea272bacf333e4b4f8c1e391ed8506", "e8ef53ec0bc53244319e87a8f6b75396f077a982dd4438743a52e82f0c136126", {inputMode: "POINTER"}),
  core("vice_x64", "4.2.3", "vice_x64-wasm.data", 1528680, "ccc5a868163b67e21f6f4c4cc994a6290cf44ab079eaf28e3a992defa2bd66f0", "643787490d9f261abe7a329d6d2daac8b2cdf469f037adcdac0fa8262fb37d50", {inputMode: "POINTER"}),
  core("vice_x64sc", "4.2.3", "vice_x64sc-wasm.data", 1523457, "77f58884c81b58721cbc4754ffc5574838219258e9390630c352a494a3f335ab", "4b788799ef1225e48610b99bdf746425ba6e2bda27fa105fd1238dfbb9fb47cb", {inputMode: "POINTER"}),
  core("vice_xpet", "4.2.3", "vice_xpet-wasm.data", 1372018, "abc999e5603d327d0ee8329bab6209edb6aa02bfd8296d5913ec54f8ee1d052d", "dfa2fa5e3e6b6183bcda9bbfb1c1469f41ac88b7d08c9a0c885e3f878bef35dd", {artifactFlavor: "OVERRIDE", coreBundleVersion: "retrom-core-g1b4309f4d56d-r2", defaultOptions: {keyboardInput: "enabled", vice_pet_model: "4032", vice_userport_joytype: "PET"}}),
  core("vice_xplus4", "4.2.3", "vice_xplus4-wasm.data", 1416694, "5725e2b32b7c7bf7fd49cf7fc117eae20ca96a67676a8642147b2ebf130750fb", "230a0b53aa7889dc4746bcb2c8f2b1a28b51c50c9a911d623b52d0426310c3bb", {artifactFlavor: "OVERRIDE", coreBundleVersion: "retrom-core-g1b4309f4d56d-r2", defaultOptions: {keyboardInput: "enabled", vice_joyport: "1"}}),
  core("vice_xvic", "4.2.3", "vice_xvic-wasm.data", 1400563, "8d77779568ff9ac2fe46f11ad6f37e39cc6be44dae337e0fb8cda4f29f283a49", "dc63426f1804edb9ca95a8417c68ec792c0ef52ec860ff1c0e99717415aeb8d9", {artifactFlavor: "OVERRIDE"}),
  core("virtualjaguar", "4.2.3", "virtualjaguar-wasm.data", 1199923, "16b62c38e6921fb5b410ab507ba6bc77edcaccbba532ae4711b9521a4256ba6d", "b9443f7fc635a091b9460773bb0261bd5c4a9b5cb5ed3162286553e173e6c742", {artifactFlavor: "OVERRIDE"}),
  core("yabause", "4.2.3", "yabause-wasm.data", 991166, "ab253ac263bd98e3124e2ca45ff581e97673426ed06ecec0025333060cd8127c", "1fc177e7be4923208b92755bcfae66ac35ba6e395c3b7ea48df581806ebdf6a6", {contentKinds: ["SINGLE_FILE", "MULTI_DISC"]}),
] as const;

const targets = cores.map((entry) => {
  return defineTarget({
  adapterId: entry.id === "gam4980" ? "emulatorjs-gam4980" : entry.id === "bsnes" ? "emulatorjs-bsnes" : entry.id === "flycast" ? "emulatorjs-flycast" : entry.id === "ppsspp" ? "emulatorjs-psp" : entry.id === "lutro" ? "emulatorjs-lutro" : entry.id === "daphne" ? "emulatorjs-daphne" : `emulatorjs-${entry.release}`,
  assetPaths: [
    ...commonAssets(entry.release),
    entry.asset,
    ...(entry.id === "daphne" ? [`assets/${entry.release}/data/cores/daphne-resources.zip`] : []),
    ...(entry.id === "ppsspp" ? [`assets/${entry.release}/data/cores/ppsspp-assets.zip`, `assets/${entry.release}/data/compression/extractzip.js`] : []),
    `assets/${entry.release}/data/cores/reports/${entry.id}.json`,
  ].sort(compareUtf8),
  checkpointMaxBytes: entry.id === "lutro" ? 16 * 1024 * 1024 : 256 * 1024 * 1024,
  discSwitch: entry.id === "yabause",
  displayName: displayName(entry.targetId ?? entry.id),
  frameMode: "SAME_ORIGIN_BLANK",
  id: providerTargetId(entry.targetId ?? entry.id),
  implementation: {
    artifactFlavor: entry.artifactFlavor,
    artifactSetSha256: entry.artifactSetSha256,
    canvasResizePolicy: entry.canvasResizePolicy,
    outputSizeLimit: entry.outputSizeLimit,
    contentKinds: entry.contentKinds,
    coreAssetPath: entry.asset,
    coreBundleVersion: entry.coreBundleVersion,
    coreSha256: entry.sha256,
    coreSizeBytes: entry.sizeBytes,
    defaultOptions: entry.defaultOptions,
    inputMode: entry.inputMode,
    release: entry.release,
    runtimeCore: entry.id,
    startupActions: entry.startupActions,
  },
  inputs: entry.id === "daphne" ? inputs.map(input => input.role === "game" ? {...input, kind: "FILE_TREE" as const} : input) :
    ["neocd", "genesis_plus_gx_cd", "flycast"].includes(entry.targetId ?? entry.id) || entry.id === "flycast"
      ? inputs.map(input => input.role === "game" ? {...input, kind: "SEEKABLE_BLOB" as const} : input) : inputs,
  contentIO: emulatorContentPolicies(entry.targetId ?? entry.id),
  inputFilter: true,
  nativeSettings: entry.id !== "daphne",
  targetOptionsSchema: emulatorJsOptionsSchema,
  requiresThreads: entry.requiresThreads,
  videoModes: entry.id === "daphne" ? ["original", "pixel"] :
    ["adaptive-sharpen", "original", "pixel", "sharp-bilinear", "smooth"],
  });
});

export const emulatorJsProviderDefinition = defineProvider({
  adapters: storageAdapters(adapters),
  providerApiVersion: 1,
  providerId: "emulatorjs",
  providerVersion,
  targets,
});

export type EmulatorImplementation = (typeof targets)[number]["implementation"];

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
  const candidate = typeof __RETROM_PFB_CORE_INPUTS__ === "undefined" ? undefined : __RETROM_PFB_CORE_INPUTS__[id];
  return {
    artifactFlavor: thread ? "THREAD_WASM" : "WASM",
    artifactSetSha256,
    asset: `assets/${release}/data/cores/${filename}`,
    canvasResizePolicy: "NONE",
    outputSizeLimit: null,
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
    ...(candidate ? {sha256: candidate.sha256, sizeBytes: candidate.sizeBytes,
      artifactSetSha256: candidate.artifactSetSha256, coreBundleVersion: `pfb-${candidate.artifactSetSha256}`} : {}),
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
  if (value === "flycast-atomiswave") {return "Flycast Atomiswave";}
  if (value === "flycast-naomi") {return "Flycast NAOMI";}
  if (value === "flycast-naomi2") {return "Flycast NAOMI 2";}
  if (value === "bsnes") {return value;}
  if (value === "o2em") {return "O2EM";}
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
