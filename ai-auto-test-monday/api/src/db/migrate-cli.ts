import { migrate, checkDb } from "./pool.js";

await migrate();
console.log("[db] migrations applied");
