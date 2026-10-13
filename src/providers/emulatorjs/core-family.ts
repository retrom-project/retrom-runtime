/** Register an owned core with the pinned loader's existing family behavior.
 * Arcade families keep the original ZIP and its driver basename intact. */
export function registerCoreFamily(instance: {getCores?: () => Record<string, string[]>}, core: string, family: string): () => void {
  const previous = instance.getCores;
  if (!previous || !Array.isArray(previous.call(instance)[family])) {throw new Error("PLAYER_RUNTIME_UNAVAILABLE");}
  const current = () => {
    const families = previous.call(instance);
    return {...families, [family]: [...new Set([...families[family], core])]};
  };
  instance.getCores = current;
  return () => {if (instance.getCores === current) {instance.getCores = previous;}};
}
