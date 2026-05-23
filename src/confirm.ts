import pc from "picocolors";
import { getRL } from "./cli.js";

export async function confirm(msg: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    console.log(pc.yellow(`${msg} (非交互终端,自动拒绝)`));
    return false;
  }
  try {
    const ans = (await getRL().question(pc.yellow(`${msg} (y/N) `))).trim().toLowerCase();
    return ans === "y" || ans === "yes";
  } catch {
    return false;
  }
}
