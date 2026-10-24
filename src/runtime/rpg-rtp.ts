import type {RPGEngine} from "./types.js";

/** The run time package each RGSS engine's own installer provides, by the name its Game.ini uses. */
export const officialRtp = Object.freeze({RPGXP: "Standard", RPGVX: "RPGVX", RPGVXACE: "RPGVXAce"} as const);
export type RgssEngine = keyof typeof officialRtp;
export type OfficialRtp = (typeof officialRtp)[RgssEngine];

export function rgssEngine(engine: RPGEngine): engine is RgssEngine {return engine in officialRtp;}

/**
 * The engine's official RTP when the [Game] section declares it in RTP or RTP1–RTP3, as mkxp-z reads them.
 * Other package names cannot be provided and are not recorded.
 */
export function declaredRtp(engine: RPGEngine, ini: string): OfficialRtp | undefined {
  if (!rgssEngine(engine)) {return undefined;}
  const official = officialRtp[engine];
  let section = "";
  for (const line of ini.split(/\r?\n/u)) {
    const header = /^\s*\[([^\]]*)\]\s*$/u.exec(line);
    if (header) {section = header[1].trim().toLowerCase(); continue;}
    const entry = /^\s*(rtp[123]?)\s*=\s*(.*?)\s*$/iu.exec(line);
    if (section === "game" && entry && entry[2].toLowerCase() === official.toLowerCase()) {return official;}
  }
  return undefined;
}
