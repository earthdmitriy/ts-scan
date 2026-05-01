import type { Plugin } from "@opencode-ai/plugin";
import { Schema } from "effect";

const blocked = ["read", "glob", "grep", "_grep"];

export const Reminder: Plugin = async ({
  project,
  client,
  $,
  directory,
  worktree,
  serverUrl,
}) => {
  return {
    "tool.execute.before": async (input, output) => {
      if (
        ["read"].includes(input.tool.toLowerCase()) &&
        !output.args.force &&
        output.args.filePath?.indexOf(".ts") > 0
      ) {
        throw new Error(
          "**Tool note** - you've forgot your instructions. Use MCP `ts-scan_list_exports first`. Or add 'force' to tool call arguments."
        );
      }
      if (
        ["grep", "_grep", "glob"].includes(input.tool.toLowerCase()) &&
        !output.args.force
      ) {
        throw new Error(
          "**Tool note** - you've forgot your instructions. Use MCP `ts-scan` for exploring. Or add 'force' to tool call arguments if you're looking not for typescript entities."
        );
      }
    },
    "tool.execute.after": async (input, output) => {},
    "command.execute.before": async (input, output) => {},
    "tool.definition": async (input, output) => {
      if (!blocked.includes(input.toolID.toLowerCase())) {
        return;
      }
      // Ensure we are getting the underlying field definitions
      // Depending on the version, this is often stored in .fields or .shape
      const originalFields = output.parameters?.fields || {};

      // Define the new parameter
      const forceParam = Schema.optional(
        Schema.Boolean.annotate({
          description:
            "Set to true to bypass environment protection and execute the tool directly.",
        })
      );

      // Create the new Struct by spreading the existing field definitions
      // and appending the new one.
      output.parameters = Schema.Struct({
        ...originalFields,
        force: forceParam,
      });
    },
  };
};
