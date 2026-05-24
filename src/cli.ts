import readline from "node:readline/promises";

let sharedRl: readline.Interface | null = null;

type SyncCompleter = (line: string) => [string[], string];

export function getRL(completer?: SyncCompleter): readline.Interface {
  if (!sharedRl) {
    sharedRl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      completer,
    });
  }
  return sharedRl;
}

export function closeRL(): void {
  sharedRl?.close();
  sharedRl = null;
}
