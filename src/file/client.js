#!/usr/bin/env node

import OpenAI from "openai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import readline from "node:readline/promises";
import dotenv from "dotenv";
import path from "path";

dotenv.config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is not set");
}

class FileSystemMCPClient {
  mcp;
  openai;
  transport;
  tools;

  constructor() {
    this.openai = new OpenAI({
      apiKey: OPENAI_API_KEY,
      baseURL: "https://api.deepseek.com/",
    });
    this.mcp = new Client({ name: "filesystem-mcp-client", version: "1.0.0" });
  }

  async connectToFileSystemServer(allowedDirectories = []) {
    try {
      // 文件系统服务器路径
      const serverScriptPath = path.join(process.cwd(), "src", "fileSystem.js");

      // 准备服务器参数
      const args = [serverScriptPath];

      // 如果没有提供目录，使用当前工作目录
      if (allowedDirectories.length === 0) {
        const defaultDir = process.env.MCP_FILESYSTEM_DIR || process.cwd();
        args.push(defaultDir);
        console.log(`FileSystem server will use directory: ${defaultDir}`);
      } else {
        // 添加用户指定的目录
        args.push(...allowedDirectories);
        console.log(
          `FileSystem server will use directories: ${allowedDirectories.join(
            ", "
          )}`
        );
      }

      this.transport = new StdioClientTransport({
        command: process.execPath,
        args,
        env: {
          ...process.env,
        },
      });

      await this.mcp.connect(this.transport);

      const toolsResult = await this.mcp.listTools();
      this.tools = toolsResult.tools.map((tool) => {
        return {
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          },
        };
      });

      console.log(
        "Connected to FileSystem server with tools:",
        this.tools.map((tool) => tool.function.name)
      );
    } catch (e) {
      console.log("Failed to connect to FileSystem MCP server: ", e);
      throw e;
    }
  }

  async processQuery(query) {
    console.log("Processing query:", query);
    console.log(
      "Available tools:",
      this.tools.map((t) => t.function.name)
    );

    const messages = [
      {
        role: "user",
        content: query,
      },
    ];

    try {
      const response = await this.openai.chat.completions.create({
        model: "deepseek-chat",
        max_tokens: 1000,
        messages,
        tools: this.tools,
      });

      console.log(
        "AI Response:",
        JSON.stringify(response.choices[0].message, null, 2)
      );

      const finalText = [];

      for (const choice of response.choices) {
        const message = choice.message;
        if (message.content) {
          finalText.push(message.content);
        }

        if (message.tool_calls) {
          console.log("Tool calls detected:", message.tool_calls.length);
          for (const toolCall of message.tool_calls) {
            const toolName = toolCall.function.name;
            const toolArgs = JSON.parse(toolCall.function.arguments);

            console.log(`Calling tool: ${toolName} with args:`, toolArgs);

            const result = await this.mcp.callTool({
              name: toolName,
              arguments: toolArgs,
            });

            console.log("Tool result:", result);

            finalText.push(
              `[Calling tool ${toolName} with args ${JSON.stringify(toolArgs)}]`
            );

            messages.push({
              role: "user",
              content: result.content,
            });

            const response = await this.openai.chat.completions.create({
              model: "deepseek-chat",
              max_tokens: 1000,
              messages,
            });

            if (response.choices[0].message.content) {
              finalText.push(response.choices[0].message.content);
            }
          }
        }
      }

      const result = finalText.join("\n");
      console.log("Final result:", result);
      return result;
    } catch (error) {
      console.error("Error in processQuery:", error);
      return `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  async chatLoop() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // 加载动画函数
    const showLoading = (message) => {
      const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
      let i = 0;
      return setInterval(() => {
        process.stdout.write(`\r${frames[i]} ${message}`);
        i = (i + 1) % frames.length;
      }, 80);
    };

    const clearLoading = (interval) => {
      clearInterval(interval);
      process.stdout.write("\r" + " ".repeat(50) + "\r"); // 清除加载动画
    };

    try {
      console.log("\nFileSystem MCP Client Started!");
      console.log("Type your file operations or 'quit' to exit.");
      console.log("Examples:");
      console.log("  - '显示当前目录的内容'");
      console.log("  - '读取 README.md 文件'");
      console.log("  - '创建一个测试文件并写入内容'");
      console.log("  - '搜索包含 test 的文件'");

      while (true) {
        const message = await rl.question("\nQuery: ");
        if (message.toLowerCase() === "quit") {
          break;
        }

        // 显示加载动画
        const loadingInterval = showLoading("Processing your query...");

        try {
          const response = await this.processQuery(message);
          clearLoading(loadingInterval);
          console.log("\n" + response);
        } catch (error) {
          clearLoading(loadingInterval);
          console.log("\nError:", error.message);
        }
      }
    } finally {
      rl.close();
    }
  }

  async cleanup() {
    await this.mcp.close();
  }
}

async function main() {
  // 获取命令行参数作为允许的目录
  const allowedDirectories = process.argv.slice(2);

  const filesystemClient = new FileSystemMCPClient();
  try {
    await filesystemClient.connectToFileSystemServer(allowedDirectories);
    await filesystemClient.chatLoop();
  } finally {
    await filesystemClient.cleanup();
    process.exit(0);
  }
}

main();
