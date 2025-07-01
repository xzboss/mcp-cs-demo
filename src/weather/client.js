import OpenAI from "openai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import readline from "node:readline/promises";
import dotenv from "dotenv";

dotenv.config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is not set");
}

class MCPClient {
  mcp;
  openai;
  transport;
  tools;

  constructor() {
    this.openai = new OpenAI({
      apiKey: OPENAI_API_KEY,
      baseURL: "https://api.deepseek.com/",
    });
    this.mcp = new Client({ name: "mcp-client-cli", version: "1.0.0" });
  }
  // methods will go here

  async connectToServer(serverScriptPath) {
    try {
      const isJs = serverScriptPath.endsWith(".js");
      const isPy = serverScriptPath.endsWith(".py");
      if (!isJs && !isPy) {
        throw new Error("Server script must be a .js or .py file");
      }
      const command = isPy
        ? process.platform === "win32"
          ? "python"
          : "python3"
        : process.execPath;

      this.transport = new StdioClientTransport({
        command,
        args: [serverScriptPath],
        env: {
          XINGZHI_API_KEY: process.env.XINGZHI_API_KEY || "",
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
        "Connected to server with tools:",
        this.tools.map((tool) => tool.function.name)
      );
    } catch (e) {
      console.log("Failed to connect to MCP server: ", e);
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
      const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
      let i = 0;
      return setInterval(() => {
        process.stdout.write(`\r${frames[i]} ${message}`);
        i = (i + 1) % frames.length;
      }, 80);
    };

    const clearLoading = (interval) => {
      clearInterval(interval);
      process.stdout.write('\r' + ' '.repeat(50) + '\r'); // 清除加载动画
    };

    try {
      console.log("\nMCP Client Started!");
      console.log("Type your queries or 'quit' to exit.");

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
  if (process.argv.length < 3) {
    console.log("Usage: node index.ts <path_to_server_script>");
    return;
  }
  const mcpClient = new MCPClient();
  try {
    await mcpClient.connectToServer(process.argv[2]);
    await mcpClient.chatLoop();
  } finally {
    await mcpClient.cleanup();
    process.exit(0);
  }
}

main();
