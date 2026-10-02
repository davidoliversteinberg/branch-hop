/** Branch identity dots, from the Axiom palette. The same branch gets the same colour everywhere. */
const HUES = ["#197A94", "#7C3AED", "#C026D3", "#DC6903", "#388367", "#A95A77", "#0891B2", "#3AB533"];
const MAIN = "#717863";

export function branchColor(key: string): string {
  if (key === "main") return MAIN;
  let x = 0;
  for (const c of key) x = (x * 31 + c.charCodeAt(0)) >>> 0;
  return HUES[x % HUES.length];
}
