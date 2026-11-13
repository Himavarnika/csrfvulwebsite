const { spawn } = require("child_process");

for (const file of ["server.js", "attacker.js"]) {
  const child = spawn(process.execPath, [file], { stdio: "inherit" });
  child.on("exit", (code) => {
    if (code) process.exitCode = code;
  });
}
