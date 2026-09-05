import { readFileSync } from "node:fs";
import { activityPayloads, snapshotActivity } from "../src/activity.js";

const [eventName, eventPath] = process.argv.slice(2);
if (!eventName || !eventPath) process.exitCode = 2;
else {
  const payload = JSON.parse(readFileSync(eventPath, "utf8"));
  const activities = eventName === "seed" ? snapshotActivity(payload) : activityPayloads(eventName, payload);
  for (const activity of activities) process.stdout.write(`${JSON.stringify(activity)}\n`);
}
