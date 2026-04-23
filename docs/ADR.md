# Architectire Decisions Records

## Initial Observation
LLMs often misunderstood imported enities and trying to use non existing methods.

### Solution
Tool, initially named "get-imported-types" built upon angular-mermaider.
With ts-morph it extrated all imported entities, their types and JSDoc comments. This information is used by LLM to understand what exactly is imported and how to use it.

## Second observation
Somehow LLMs don't care about TS errors. That's because agents dont'have a way to check if the code it generated is correct. Language services are not available to them. ACP(Agent Context Propotocal) is not widely availeble for now too. Only way to check compile errors for LLM - is running build (or tsc for specified file). On huge projects it's not an option. 

### Solution
So I added another tool "check-type-errors" that returns all type errors in a file. This way LLM can check if the code it generated is correct and fix it if it's not. Luckyly, ts-morph provides a way to get all type errors without running build, so it's very fast.

## But how LLM can know what to import if it doesn't understand project structure?
Smarter LLMs doing exploring with multiple greps and file reads. But it's not reliable and very slow.
Dumber LLMs just guess import paths and hope for the best. It's even worse.

### Solution
I added two more tools: "list-exports" and "resolve-symbol". First one returns all exported entities from a file with their types and JSDoc. Second one returns the correct import path for a given symbol. With these tools LLM can understand project structure and dependencies without reading files or grepping. It's much faster and more reliable.

## Initial implementation worked as npx cli command
LLMs often threat npx as 'not safe' and refuse to use it. Also, it's not very convenient to call npx commands from LLMs. 

### Solution
So I implemented MCP server that exposes these tools as API. Now LLMs can call these tools directly without any workarounds.

## LLMs often ignore MCP tools and fallback to grepping or reading files.
Sad, but true. They are just not trained to use tools and prefer to do things the way they used to.

### Solution
I've added sample MCP info intended to be copy-paseted into AGENTS.md.
As well as two basic skills - dependency-planner and type-safe-coder - that enforce using these tools and provide guidelines on how to use them. With clear rules and mandatory workflows, LLMs are more likely to follow the correct process and use the tools instead of grepping or reading files.

## After resolving symbol and getting its location LLM still need to run at least --exports to understand what exactly is exported and how to use it. 
Or reading the file directly, but it's not recommended because of reasons mentioned above.

### Solution
--resolve returns not only the correct import path, but also the signature of the symbol and its JSDoc. This way LLM can use the symbol without running another tool or reading the file. It's even faster and more reliable.

# TBD
Singatures returned by --exports often contain types imported from other files. It's short, but might require additional calls to --resolve to understand what exactly is this type and where it's from. Maybe it's worth to return full signature with all types resolved? It's a trade-off between performance and convenience. For now I decided to return only short signatures, but it's something to consider for future improvements.