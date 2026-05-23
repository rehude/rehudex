import readline from "node:readline/promises";
import pc from "picocolors";

export async function confirm(msg: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    console.log(pc.yellow(`${msg} (非交互终端,自动拒绝)`));
    return false;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const ans = (await rl.question(pc.yellow(`${msg} (y/N) `))).trim().toLowerCase();
    return ans === "y" || ans === "yes";
  } catch {
    return false;
  } finally {
    rl.close();
  }
}
