import rtp from "./rpg-rtp.json" with {type: "json"};

/**
 * The run time package each RGSS engine's own installer provides, by the name its Game.ini uses. The server host
 * embeds the same fact to record a declared RTP; this projection names the package a Target delivers.
 */
export const officialRtp: Readonly<{RPGXP: string; RPGVX: string; RPGVXACE: string}> = Object.freeze(rtp);
