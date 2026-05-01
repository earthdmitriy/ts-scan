# Sample prompts to check if LLMs aware of the ts-scan

* Give me JSdoc and signature of XXX

Very precise and concise, only the signature and JSdoc - if agent is not calling the ts-scan it will grep the codebase.


* Tell me about XXX


* What is XXX?

More generic prompts, XXX can be threated as generic word, agents are less likely to call the ts-scan.


* Analyze XXX
Agent should use `resolve_symbol` to find it.


# Notes
OpencodeZen - BigPickle - ok

OpenRouter - Nemotrol (all of them) - fail (despite of intructions they prefer raw file operations)

OpenRouter - Minmax M2.5 - ok

Local - Qwen3.6-27b - ok

Local - Gemma4 (all of them) - fail (general troubles with tool calling)