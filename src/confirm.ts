import { getCurrentUi } from "./ui/current.js";

export async function confirm(msg: string): Promise<boolean> {
  return getCurrentUi().confirm(msg);
}
