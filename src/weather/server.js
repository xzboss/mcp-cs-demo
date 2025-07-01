// 导入必要的模块和库
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fetch from "node-fetch";

// 定义常量：心知天气API的基础URL和配置
const SENIVERSE_API_BASE = "https://api.seniverse.com/v3";
const API_KEY = process.env.XINGZHI_API_KEY;
const USER_AGENT = "weather-app/1.0";

// 调试模式开关
const DEBUG_MODE = true;

// 检查API密钥是否存在
if (!API_KEY) {
  console.error("❌ 错误: 未设置 XINGZHI_API_KEY 环境变量");
  console.error("请设置环境变量: export XINGZHI_API_KEY='your_api_key_here'");
  console.error("或者创建 .env 文件并添加: XINGZHI_API_KEY=your_api_key_here");
  process.exit(1);
}

// 调试日志函数
function debugLog(message, data = null) {
  if (DEBUG_MODE) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;
    console.error(logMessage);
    if (data) {
      console.error(JSON.stringify(data, null, 2));
    }
    console.error("---");
  }
}

// 定义Zod验证模式：API请求参数
const WeatherApiParams = z.object({
  key: z.string().describe("你的 API 密钥"),
  location: z.string().describe("所查询的位置"),
  language: z
    .enum(["zh-Hans", "zh-Hant", "en", "ja"])
    .default("zh-Hans")
    .describe("语言"),
  unit: z.enum(["c", "f"]).default("c").describe("单位"),
  start: z.number().int().min(0).default(0).describe("起始时间"),
  days: z.number().int().min(1).max(7).optional().describe("天数"),
});

// 创建MCP服务器实例
// MCP (Model Context Protocol) 是一个用于AI模型与外部工具通信的协议
const server = new McpServer({
  name: "weather", // 服务器名称
  version: "1.0.0", // 版本号
  capabilities: {
    // 服务器能力配置
    resources: {}, // 资源能力（当前为空）
    tools: {}, // 工具能力（当前为空）
  },
});

// 辅助函数：构建并验证API请求URL
// 使用Zod验证参数并构建正确的API请求URL
function buildWeatherApiUrl(params) {
  debugLog("🔧 开始构建API请求URL", { inputParams: params });

  try {
    // 验证参数
    const validatedParams = WeatherApiParams.parse(params);
    debugLog("✅ 参数验证成功", { validatedParams });

    // 构建查询字符串
    const queryParams = new URLSearchParams();

    // 添加所有验证过的参数
    Object.entries(validatedParams).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        queryParams.append(key, value.toString());
      }
    });

    // 构建完整的URL
    const url = `${SENIVERSE_API_BASE}/weather/daily.json?${queryParams.toString()}`;
    debugLog("🌐 构建的API URL", { url });

    return { success: true, url };
  } catch (error) {
    // 如果参数验证失败，返回错误信息
    debugLog("❌ 参数验证失败", { error: error.message, details: error });
    return {
      success: false,
      error: `参数验证失败: ${error.message}`,
    };
  }
}

// 辅助函数：向心知天气API发送请求
// 这个函数封装了所有对心知天气API的HTTP请求逻辑
async function makeSeniverseRequest(url) {
  debugLog("🚀 开始发送API请求", { url });

  // 设置请求头
  const headers = {
    "User-Agent": USER_AGENT, // 用户代理，告诉服务器我们的应用信息
    Accept: "application/json", // 接受JSON格式的响应
  };

  debugLog("📋 请求头", { headers });

  try {
    // 发送GET请求到指定的URL
    const response = await fetch(url, { headers });

    debugLog("📡 API响应状态", {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
    });

    // 检查响应状态，如果不是200-299范围，则抛出错误
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // 将响应解析为JSON格式并返回
    const data = await response.json();
    debugLog("📦 API响应数据", {
      dataSize: JSON.stringify(data).length,
      hasResults: !!data.results,
      resultsCount: data.results?.length || 0,
    });

    return data;
  } catch (error) {
    // 如果请求过程中出现任何错误，记录错误信息并返回null
    debugLog("❌ API请求失败", { error: error.message, stack: error.stack });
    console.error("Error making Seniverse request:", error);
    return null;
  }
}

// 格式化心知天气API的每日天气预报数据
// 将原始的心知天气数据转换为易读的文本格式
function formatDailyForecast(dailyData) {
  debugLog("📝 格式化每日预报数据", { dailyData });

  const formatted = [
    `日期: ${dailyData.date}`,
    `白天: ${dailyData.text_day} (${dailyData.high}°C)`,
    `夜间: ${dailyData.text_night} (${dailyData.low}°C)`,
    `降水: ${dailyData.rainfall}mm`,
    `风向: ${dailyData.wind_direction} (${dailyData.wind_speed}km/h)`,
    `湿度: ${dailyData.humidity}%`,
    "---",
  ].join("\n");

  debugLog("✅ 格式化完成", { formattedLength: formatted.length });
  return formatted;
}

// 注册工具：获取指定城市的天气预报
// 这个工具允许用户查询指定城市的天气预报信息
server.tool(
  "get-weather",
  "Get weather forecast for a city",
  {
    // 定义工具参数：城市名称
    city: z.string().describe("City name (e.g. beijing, shanghai, guangzhou)"),
    days: z
      .number()
      .min(1)
      .max(7)
      .default(3)
      .describe("Number of days for forecast (1-7)"),
    language: z
      .enum(["zh-Hans", "zh-Hant", "en", "ja"])
      .default("zh-Hans")
      .describe("Language for weather description"),
    unit: z
      .enum(["c", "f"])
      .default("c")
      .describe("Temperature unit (c for Celsius, f for Fahrenheit)"),
  },
  async ({ city, days, language, unit }) => {
    debugLog("🎯 收到工具调用请求", {
      toolName: "get-weather",
      parameters: { city, days, language, unit },
    });

    // 构建API请求参数
    const apiParams = {
      key: API_KEY,
      location: city,
      language: language,
      unit: unit,
      start: 0,
      days: days,
    };

    debugLog("🔧 构建API参数", { apiParams });

    // 构建并验证API请求URL
    const urlResult = buildWeatherApiUrl(apiParams);

    if (!urlResult.success) {
      debugLog("❌ URL构建失败", { error: urlResult.error });
      return {
        content: [
          {
            type: "text",
            text: urlResult.error,
          },
        ],
      };
    }

    // 发送请求获取天气数据
    const weatherData = await makeSeniverseRequest(urlResult.url);

    // 如果请求失败，返回错误信息
    if (!weatherData) {
      debugLog("❌ 天气数据获取失败");
      return {
        content: [
          {
            type: "text",
            text: `获取 ${city} 的天气数据失败，请检查城市名称是否正确或网络连接是否正常。`,
          },
        ],
      };
    }

    // 从响应中提取天气数据
    const results = weatherData.results || [];
    debugLog("📊 解析API响应", {
      hasResults: !!weatherData.results,
      resultsCount: results.length,
    });

    // 如果没有返回结果，返回错误信息
    if (results.length === 0) {
      debugLog("❌ 未找到天气结果");
      return {
        content: [
          {
            type: "text",
            text: `未找到 ${city} 的天气信息，请检查城市名称是否正确。`,
          },
        ],
      };
    }

    const result = results[0];
    const location = result.location;
    const dailyForecasts = result.daily || [];

    debugLog("📍 位置信息", { location });
    debugLog("📅 预报数据", {
      dailyCount: dailyForecasts.length,
      dailyData: dailyForecasts,
    });

    // 如果没有预报数据，返回错误信息
    if (dailyForecasts.length === 0) {
      debugLog("❌ 未找到预报数据");
      return {
        content: [
          {
            type: "text",
            text: `未找到 ${city} 的预报数据。`,
          },
        ],
      };
    }

    // 格式化所有预报数据
    const formattedForecasts = dailyForecasts.map(formatDailyForecast);

    // 构建完整的天气信息文本
    const weatherText = [
      `📍 ${location.name} (${location.path})`,
      `🕐 最后更新: ${result.last_update}`,
      `📅 ${days}天天气预报:`,
      "",
      formattedForecasts.join("\n"),
    ].join("\n");

    debugLog("📤 准备返回结果", {
      resultLength: weatherText.length,
      resultPreview: weatherText.substring(0, 200) + "...",
    });

    // 返回格式化的天气信息
    return {
      content: [
        {
          type: "text",
          text: weatherText,
        },
      ],
    };
  }
);

// 主函数：启动服务器
async function main() {
  debugLog("🚀 启动MCP天气服务器");

  // 创建标准输入输出传输层
  // 这意味着服务器将通过标准输入输出与客户端通信
  const transport = new StdioServerTransport();

  // 连接服务器到传输层
  await server.connect(transport);

  // 在控制台输出服务器运行状态（使用console.error确保信息显示）
  console.error("Weather MCP Server running on stdio");
  debugLog("✅ MCP服务器已启动并准备接收请求");
}

// 启动主函数，并处理任何可能发生的错误
main().catch((error) => {
  // 如果主函数执行过程中出现致命错误，记录错误信息并退出程序
  debugLog("💥 服务器启动失败", { error: error.message, stack: error.stack });
  console.error("Fatal error in main():", error);
  process.exit(1); // 以错误代码1退出程序
});
