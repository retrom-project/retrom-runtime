type Instance = {
  fileName?: string;
  debug?: boolean;
  Module?: {callMain?: (args: string[]) => unknown};
  startGame?: () => unknown;
};
type Disc = {idle(): Promise<void>; fail(error: Error): void};

/** EJS 4.2.3 resumes its loop immediately after callMain, which can now suspend. */
export function installNeoCDStartup(instance: Instance, disc: Disc) {
  const start = instance.startGame;
  if (!start) {throw new Error("NEOCD_STARTUP_UNAVAILABLE");}
  instance.startGame = async () => {
    const module = instance.Module, callMain = module?.callMain;
    if (!module || !callMain || !instance.fileName) {disc.fail(new Error("NEOCD_STARTUP_UNAVAILABLE")); return;}
    try {
      callMain.call(module, [...instance.debug ? ["-v"] : [], `/${instance.fileName}`]);
      await disc.idle();
      // Run the pinned frontend's ordinary UI/start sequence exactly once, without booting twice.
      module.callMain = () => undefined;
      try {start.call(instance);} finally {module.callMain = callMain;}
    } catch (error) {disc.fail(error instanceof Error ? error : new Error("NEOCD_STARTUP_FAILED"));}
  };
}
