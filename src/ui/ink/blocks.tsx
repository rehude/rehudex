import React from "react";
import { Box, Text } from "ink";
import type OpenAI from "openai";

export interface MessageBlock {
  id: string;
  role: "user" | "assistant" | "tool" | "info" | "warning" | "error" | "shell";
  text: string;
  toolName?: string;
}

let blockCounter = 0;
export const newBlockId = (): string => `b${++blockCounter}`;

function InlineMarkdown({ text }: { text: string }): React.ReactElement {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter((part) => part.length > 0);
  return (
    <Text>
      {parts.map((part, index) => {
        if (part.startsWith("`") && part.endsWith("`")) {
          return (
            <Text key={index} color="yellow">
              {part.slice(1, -1)}
            </Text>
          );
        }
        if (part.startsWith("**") && part.endsWith("**")) {
          return (
            <Text key={index} bold>
              {part.slice(2, -2)}
            </Text>
          );
        }
        return <Text key={index}>{part}</Text>;
      })}
    </Text>
  );
}

export function MarkdownView({ text }: { text: string }): React.ReactElement {
  const lines = text.split(/\r?\n/);
  const nodes: React.ReactElement[] = [];
  let inCode = false;
  let codeLines: string[] = [];

  const flushCode = () => {
    if (codeLines.length === 0) return;
    nodes.push(
      <Box key={`code-${nodes.length}`} flexDirection="column" marginY={1} paddingX={1} borderStyle="single" borderColor="gray">
        {codeLines.map((line, index) => (
          <Text key={index} color="gray">
            {line || " "}
          </Text>
        ))}
      </Box>,
    );
    codeLines = [];
  };

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      nodes.push(
        <Text key={`h-${nodes.length}`} color="cyan" bold>
          {heading[2]}
        </Text>,
      );
      continue;
    }

    const bullet = line.match(/^(\s*)[-*]\s+(.+)$/);
    if (bullet) {
      nodes.push(
        <Text key={`li-${nodes.length}`}>
          <Text color="gray">  - </Text>
          <InlineMarkdown text={bullet[2]} />
        </Text>,
      );
      continue;
    }

    const ordered = line.match(/^(\s*)\d+\.\s+(.+)$/);
    if (ordered) {
      nodes.push(
        <Text key={`ol-${nodes.length}`}>
          <Text color="gray">  • </Text>
          <InlineMarkdown text={ordered[2]} />
        </Text>,
      );
      continue;
    }

    if (line.trim() === "") {
      nodes.push(<Text key={`blank-${nodes.length}`}> </Text>);
      continue;
    }

    nodes.push(<InlineMarkdown key={`p-${nodes.length}`} text={line} />);
  }

  if (inCode) flushCode();
  return <Box flexDirection="column">{nodes}</Box>;
}

export function messagesToBlocks(
  messages: OpenAI.ChatCompletionMessageParam[],
): MessageBlock[] {
  const out: MessageBlock[] = [];
  const callNames = new Map<string, string>();
  for (const m of messages) {
    if (m.role === "assistant" && (m as any).tool_calls) {
      for (const c of (m as any).tool_calls) {
        if (c?.type === "function" && c?.id)
          callNames.set(c.id, c.function?.name ?? "?");
      }
    }
  }
  for (const m of messages) {
    if (m.role === "system") continue;
    const text = typeof m.content === "string" ? m.content : "";
    if (m.role === "user") {
      if (text) out.push({ id: newBlockId(), role: "user", text });
    } else if (m.role === "assistant") {
      if (text) out.push({ id: newBlockId(), role: "assistant", text });
      const calls = (m as any).tool_calls as
        | OpenAI.ChatCompletionMessageToolCall[]
        | undefined;
      if (calls) {
        for (const c of calls) {
          if (c.type === "function") {
            out.push({
              id: newBlockId(),
              role: "tool",
              toolName: c.function.name,
              text: `⚙ ${c.function.name}(${c.function.arguments})`,
            });
          }
        }
      }
    } else if (m.role === "tool") {
      const id = (m as any).tool_call_id as string | undefined;
      const name = id ? callNames.get(id) ?? "tool" : "tool";
      out.push({ id: newBlockId(), role: "tool", toolName: name, text });
    }
  }
  return out;
}

export function MessageBlockView({ b }: { b: MessageBlock }): React.ReactElement {
  if (b.role === "user") {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color="green">{"> "}{b.text}</Text>
      </Box>
    );
  }
  if (b.role === "assistant") {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color="cyan">[回答]</Text>
        <MarkdownView text={b.text} />
      </Box>
    );
  }
  if (b.role === "tool") {
    return (
      <Box marginTop={1}>
        <Text color="yellow">{b.text}</Text>
      </Box>
    );
  }
  if (b.role === "info") {
    return (
      <Box>
        <Text color="cyan">{b.text}</Text>
      </Box>
    );
  }
  if (b.role === "warning") {
    return (
      <Box>
        <Text color="yellow">{b.text}</Text>
      </Box>
    );
  }
  if (b.role === "error") {
    return (
      <Box>
        <Text color="red">{b.text}</Text>
      </Box>
    );
  }
  // shell
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="yellow">{b.text}</Text>
    </Box>
  );
}
