// Each item is one native argument, not a shell command line. Preserve order:
// the engine's first exact option-name match has priority over later entries.
export function kirikiriEngineArguments(value: unknown): string[] {
  if (value === undefined) {return [];}
  if (!Array.isArray(value) || value.length > 64 || !value.every(validArgument)) {
    throw new Error("KIRIKIRI_ENGINE_ARGUMENTS_INVALID");
  }
  return value.slice() as string[];
}

function validArgument(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 1024 ||
    !/^-[^\s=]+(?:=.*)?$/u.test(value) ||
    Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {return false;}
  const name = value.split("=", 1)[0]!.toLowerCase();
  // Entry and persistent storage remain owned by the project's public options
  // and GAME_SAVE contract, independently of script-specific engine options.
  return name !== "-datapath" && name !== "-startup";
}
