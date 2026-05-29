import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput, useApp } from "ink";
import type OpenAI from "openai";
import type { UiEvent } from "../types.js";
import { getInkBus } from "./event-bus.js";
import { buildCompleter } from "../../completer.js";
import {
  type MessageBlock,
  MarkdownView,
  newBlockId,
  messagesToBlocks,
  MessageBlockView,
} from "./blocks.js";

interface PendingInput {
  prompt: string;
  resolve: (value: string) => void;
}
interface PendingConfirm {
  msg: string;
  resolve: (value: boolean) => void;
}

export function App(): React.ReactElement {
  const { exit } = useApp();
  const bus = getInkBus();

  const [blocks, setBlocks] = useState<MessageBlock[]>([]);
  const [streaming, setStreaming] = useState<string>("");
  const [reasoning, setReasoning] = useState<string>("");
  const [statusLine, setStatusLine] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);

  const [inputBuffer, setInputBuffer] = useState<string>("");
  const [continuationLines, setContinuationLines] = useState<string[]>([]);
  const [pendingInput, setPendingInput] = useState<PendingInput | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [completions, setCompletions] = useState<string[]>([]);
  const [completionToken, setCompletionToken] = useState<string>("");
  const [selectedCompletion, setSelectedCompletion] = useState<number>(0);

  const streamingRef = useRef<string>("");
  const reasoningRef = useRef<string>("");
  const completer = useMemo(() => buildCompleter(), []);

  const refreshCompletions = (line: string) => {
    const [hits, token] = completer(line);
    setCompletionToken(token);
    setSelectedCompletion(0);
    setCompletions(hits.slice(0, 8));
  };

  const clearCompletions = () => {
    setCompletions([]);
    setCompletionToken("");
    setSelectedCompletion(0);
  };

  const setInputAndCompletions = (line: string) => {
    setInputBuffer(line);
    refreshCompletions(line);
  };

  const acceptCompletion = () => {
    if (completions.length === 0) return false;
    const hit = completions[selectedCompletion] ?? completions[0];
    const prefix = completionToken
      ? inputBuffer.slice(0, inputBuffer.length - completionToken.length)
      : inputBuffer;
    const shouldAddSpace =
      !hit.endsWith("/") && (hit.startsWith("/") || hit.startsWith("@") || /^[/\w-]+$/.test(hit));
    const next = prefix + hit + (shouldAddSpace ? " " : "");
    setInputBuffer(next);
    clearCompletions();
    return true;
  };

  useEffect(() => {
    const onUi = (event: UiEvent) => {
      switch (event.type) {
        case "status":
          setStatusLine(event.data);
          break;
        case "info":
          setBlocks((b) => [...b, { id: newBlockId(), role: "info", text: event.data }]);
          break;
        case "warning":
          setBlocks((b) => [...b, { id: newBlockId(), role: "warning", text: event.data }]);
          break;
        case "error":
          setBlocks((b) => [...b, { id: newBlockId(), role: "error", text: event.data }]);
          break;
        case "userMessage":
          setBlocks((b) => [...b, { id: newBlockId(), role: "user", text: event.data }]);
          break;
        case "assistantStart":
          streamingRef.current = "";
          setStreaming("");
          setBusy(true);
          break;
        case "assistantDelta":
          streamingRef.current += event.data;
          setStreaming(streamingRef.current);
          break;
        case "assistantDone": {
          const text = streamingRef.current;
          streamingRef.current = "";
          setStreaming("");
          setBusy(false);
          if (text) setBlocks((b) => [...b, { id: newBlockId(), role: "assistant", text }]);
          break;
        }
        case "reasoningStart":
          reasoningRef.current = "";
          setReasoning("");
          setBusy(true);
          break;
        case "reasoningDelta":
          reasoningRef.current += event.data;
          setReasoning(reasoningRef.current);
          break;
        case "reasoningDone":
          reasoningRef.current = "";
          setReasoning("");
          break;
        case "toolCall":
          setBlocks((b) => [
            ...b,
            {
              id: newBlockId(),
              role: "tool",
              toolName: event.data.name,
              text: `⚙ ${event.data.name}(${event.data.arguments})`,
            },
          ]);
          break;
        case "shellStart":
          setBusy(true);
          setBlocks((b) => [
            ...b,
            { id: newBlockId(), role: "shell", text: `⚙ ${event.data.shell} $ ${event.data.cmd}` },
          ]);
          break;
        case "shellOutput": {
          const parts: string[] = [];
          if (event.data.stdout) parts.push(event.data.stdout.replace(/\n+$/, ""));
          if (event.data.stderr) parts.push(event.data.stderr.replace(/\n+$/, ""));
          if (event.data.error) parts.push(`命令异常: ${event.data.error}`);
          if (parts.length)
            setBlocks((b) => [...b, { id: newBlockId(), role: "shell", text: parts.join("\n") }]);
          break;
        }
        case "shellDone":
          setBusy(false);
          break;
      }
    };
    const onHistory = (messages: OpenAI.ChatCompletionMessageParam[]) => {
      setBlocks(messagesToBlocks(messages));
    };
    const onAskInput = (payload: PendingInput) => {
      setPendingInput(payload);
      setInputBuffer("");
      setContinuationLines([]);
      clearCompletions();
    };
    const onAskConfirm = (payload: PendingConfirm) => {
      setPendingConfirm(payload);
    };

    bus.on("ui", onUi);
    bus.on("history", onHistory);
    bus.on("askInput", onAskInput);
    bus.on("askConfirm", onAskConfirm);
    return () => {
      bus.off("ui", onUi);
      bus.off("history", onHistory);
      bus.off("askInput", onAskInput);
      bus.off("askConfirm", onAskConfirm);
    };
  }, [bus]);

  // 输入处理
  useInput((input, key) => {
    if (key.ctrl && input === "y") {
      bus.emit("shortcut", "toggleYolo");
      return;
    }

    if (key.ctrl && input === "c") {
      if (pendingConfirm) {
        const p = pendingConfirm;
        setPendingConfirm(null);
        p.resolve(false);
        return;
      }
      if (pendingInput) {
        const p = pendingInput;
        setPendingInput(null);
        setInputBuffer("");
        setContinuationLines([]);
        clearCompletions();
        p.resolve("exit");
        return;
      }
      exit();
      return;
    }

    // 优先级最高:确认提示
    if (pendingConfirm) {
      if (input === "y" || input === "Y") {
        const p = pendingConfirm;
        setPendingConfirm(null);
        p.resolve(true);
      } else if (input === "n" || input === "N" || key.return || key.escape) {
        const p = pendingConfirm;
        setPendingConfirm(null);
        p.resolve(false);
      }
      return;
    }

    if (!pendingInput) return;

    if (key.tab) {
      if (!acceptCompletion()) refreshCompletions(inputBuffer);
      return;
    }
    if (key.upArrow && completions.length > 0) {
      setSelectedCompletion((n) => (n - 1 + completions.length) % completions.length);
      return;
    }
    if (key.downArrow && completions.length > 0) {
      setSelectedCompletion((n) => (n + 1) % completions.length);
      return;
    }
    if (key.escape) {
      clearCompletions();
      return;
    }
    if (key.return) {
      // 行尾 \ 续写
      if (inputBuffer.endsWith("\\")) {
        setContinuationLines((arr) => [...arr, inputBuffer.slice(0, -1)]);
        setInputBuffer("");
        clearCompletions();
        return;
      }
      const lines = [...continuationLines, inputBuffer];
      const full = lines.join("\n");
      const p = pendingInput;
      setPendingInput(null);
      setInputBuffer("");
      setContinuationLines([]);
      clearCompletions();
      p.resolve(full);
      return;
    }
    if (key.backspace || key.delete) {
      if (inputBuffer.length > 0) {
        setInputAndCompletions(inputBuffer.slice(0, -1));
      } else if (continuationLines.length > 0) {
        const last = continuationLines[continuationLines.length - 1];
        setContinuationLines((arr) => arr.slice(0, -1));
        setInputAndCompletions(last);
      }
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setInputAndCompletions(inputBuffer + input);
    }
  });

  return (
    <Box flexDirection="column">
      {/* 状态栏 */}
      <Box borderStyle="single" borderColor={busy ? "yellow" : "cyan"} paddingX={1}>
        <Text color={busy ? "yellow" : "cyan"} bold>
          reهدudex
        </Text>
        <Text color="gray">  {busy ? "busy" : "idle"}  </Text>
        <Text color="cyan" dimColor>
          {statusLine || "session: pending"}
        </Text>
      </Box>

      {/* 消息块 */}
      {blocks.map((b) => (
        <MessageBlockView key={b.id} b={b} />
      ))}

      {/* 思考中(reasoning) */}
      {reasoning ? (
        <Box marginTop={1}>
          <Text color="gray">[思考] {reasoning}</Text>
        </Box>
      ) : null}

      {/* 流式回复 */}
      {streaming ? (
        <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="cyan" paddingX={1}>
          <Text color="cyan">[回答]</Text>
          <MarkdownView text={streaming} />
        </Box>
      ) : null}

      {/* 确认提示 */}
      {pendingConfirm ? (
        <Box marginTop={1} borderStyle="round" borderColor="yellow" paddingX={1}>
          <Text color="yellow">{pendingConfirm.msg} (y/N) </Text>
        </Box>
      ) : null}

      {/* 输入框 */}
      {pendingInput && !pendingConfirm ? (
        <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="green" paddingX={1}>
          {continuationLines.map((line, i) => (
            <Text key={i} color="gray">  {line}\</Text>
          ))}
          <Box>
            <Text color="green">{busy ? "..." : pendingInput.prompt}</Text>
            <Text>{inputBuffer}</Text>
            <Text color="gray">{"▏"}</Text>
          </Box>
          {completions.length > 0 ? (
            <Box flexDirection="column" marginTop={1}>
              <Text color="gray">Tab 接受，上下选择，Esc 关闭</Text>
              {completions.map((item, index) => (
                <Text key={`${item}-${index}`} color={index === selectedCompletion ? "green" : "gray"}>
                  {index === selectedCompletion ? "› " : "  "}
                  {item}
                </Text>
              ))}
            </Box>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}
