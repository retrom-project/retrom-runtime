/** Bounded native evidence shared by adapters; recoverable progress is not a failure reason. */
export class CoreDiagnostics {
  private readonly entries: {message: string; priority: number}[] = [];

  record(value: string) {
    for (const line of value.slice(-8000).split(/\r?\n/u)) {
      const message = line.trim();
      if (!usefulCoreDiagnostic(message)) {continue;}
      const bounded = message.slice(-500);
      if (this.entries.some(entry => entry.message === bounded)) {continue;}
      this.entries.push({message: bounded, priority: /\b(?:error|fatal|failed|cannot|unable|unknown|invalid|unsupported|corrupt|encrypted|required|missing)\b|NOT FOUND/iu.test(message) ? 1 : 0});
      if (this.entries.length > 8) {
        const lowest = Math.min(...this.entries.map(entry => entry.priority));
        this.entries.splice(this.entries.findIndex(entry => entry.priority === lowest), 1);
      }
    }
  }

  messages() {
    const failed = this.entries.some(entry => entry.priority === 1);
    return this.entries.filter(entry => !failed || entry.priority === 1).map(entry => entry.message);
  }
  clear() {this.entries.length = 0;}
}

export function usefulCoreDiagnostic(message: string) {
  return !!message.trim() &&
    !/^(?:\[(?:libretro )?(?:INFO|DEBUG|WARN|WARNING)\]|invalid core option\b|Built for EmulatorJS\b|Download a copy from\b|View the licen[cs]e\b|at\s)/iu.test(message.trim()) &&
    !/This is not an error\.|\bfalling back\b/iu.test(message);
}
