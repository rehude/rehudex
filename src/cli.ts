import readline from "node:readline/promises";

let sharedRl: readline.Interface | null = null;

export function getRL(): readline.Interface {
  if (!sharedRl) {
    sharedRl = readline.createInterface({ input: process.stdin, output: process.stdout });
  }
  return sharedRl;
}

export function closeRL(): void {
  sharedRl?.close();
  sharedRl = null;
}
