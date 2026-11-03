import { Detail } from "@raycast/api";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="120" viewBox="0 0 400 120">' +
  '<rect width="400" height="120" fill="#eef"/>' +
  '<path d="M10 100 L100 60 L200 80 L300 20 L390 40" fill="none" stroke="#34a853" stroke-width="3"/>' +
  "</svg>";

export default function Command() {
  const dir = join(tmpdir(), "tinycast-stocks");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "spike.svg");
  writeFileSync(file, svg);
  const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  const md = [
    "# Chart spike",
    "A) data URI:",
    `![A](${dataUri})`,
    "B) file:// URL:",
    `![B](file://${file})`,
    "C) absolute path:",
    `![C](${file})`,
    "D) text sparkline: ▁▂▃▅▇▆▄",
  ].join("\n\n");
  return <Detail markdown={md} />;
}
