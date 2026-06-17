import { existsSync } from "node:fs";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// ---------------------------------------------------------------------------
// Column reference data — all known Ringba insights columns
// ---------------------------------------------------------------------------

interface ColumnDef {
  column: string;
  displayName: string;
  category: "metric" | "dimension" | "tag";
  description: string;
}

const AVAILABLE_COLUMNS: ColumnDef[] = [
  // --- Value columns (metrics) ---
  {
    column: "callCount",
    displayName: "Calls",
    category: "metric",
    description: "Total number of calls",
  },
  {
    column: "liveCallCount",
    displayName: "Live Calls",
    category: "metric",
    description: "Number of live calls",
  },
  {
    column: "completedCalls",
    displayName: "Completed Calls",
    category: "metric",
    description: "Number of completed calls",
  },
  {
    column: "endedCalls",
    displayName: "Ended Calls",
    category: "metric",
    description: "Number of ended calls",
  },
  {
    column: "connectedCallCount",
    displayName: "Connected Calls",
    category: "metric",
    description: "Number of connected calls",
  },
  {
    column: "nonConnectedCallCount",
    displayName: "Non-Connected Calls",
    category: "metric",
    description: "Number of non-connected calls",
  },
  {
    column: "duplicateCalls",
    displayName: "Duplicate Calls",
    category: "metric",
    description: "Number of duplicate calls",
  },
  {
    column: "blockedCalls",
    displayName: "Blocked Calls",
    category: "metric",
    description: "Number of blocked calls",
  },
  {
    column: "incompleteCalls",
    displayName: "Incomplete Calls",
    category: "metric",
    description: "Number of incomplete calls",
  },
  {
    column: "payoutCount",
    displayName: "Payout Count",
    category: "metric",
    description: "Number of payouts",
  },
  {
    column: "convertedCalls",
    displayName: "Converted Calls",
    category: "metric",
    description: "Number of converted calls",
  },
  {
    column: "conversionAmount",
    displayName: "Conversion Amount",
    category: "metric",
    description: "Total conversion amount in dollars",
  },
  {
    column: "payoutAmount",
    displayName: "Payout Amount",
    category: "metric",
    description: "Total payout amount in dollars",
  },
  {
    column: "profitGross",
    displayName: "Gross Profit",
    category: "metric",
    description: "Gross profit in dollars",
  },
  {
    column: "profitMarginGross",
    displayName: "Gross Profit Margin",
    category: "metric",
    description: "Gross profit margin as a percentage",
  },
  {
    column: "earningsPerCallGross",
    displayName: "Gross Earnings Per Call",
    category: "metric",
    description: "Gross earnings per call in dollars",
  },
  {
    column: "totalCost",
    displayName: "Total Cost",
    category: "metric",
    description: "Total cost in dollars",
  },
  {
    column: "callLengthInSeconds",
    displayName: "Call Length (seconds)",
    category: "metric",
    description: "Total call length in seconds",
  },
  {
    column: "avgHandleTime",
    displayName: "Average Handle Time",
    category: "metric",
    description: "Average handle time",
  },
  {
    column: "convertedPercent",
    displayName: "Conversion Rate",
    category: "metric",
    description: "Percentage of calls that converted",
  },

  // --- Group-by / dimension columns ---
  {
    column: "targetName",
    displayName: "Target",
    category: "dimension",
    description: "Target (agent) name",
  },
  {
    column: "publisherName",
    displayName: "Publisher",
    category: "dimension",
    description: "Publisher name",
  },
  {
    column: "campaignName",
    displayName: "Campaign",
    category: "dimension",
    description: "Campaign name",
  },
  {
    column: "buyerName",
    displayName: "Buyer",
    category: "dimension",
    description: "Buyer name",
  },
  {
    column: "inboundNumber",
    displayName: "Inbound Number",
    category: "dimension",
    description: "Inbound phone number",
  },
  {
    column: "callerId",
    displayName: "Caller ID",
    category: "dimension",
    description: "Caller's phone number",
  },
  {
    column: "callStatus",
    displayName: "Call Status",
    category: "dimension",
    description: "Status of the call",
  },

  // --- Tag columns (prefixed with tag:) ---
  {
    column: "tag:InboundNumber:State",
    displayName: "Caller State",
    category: "tag",
    description: "State derived from the inbound number",
  },
  {
    column: "tag:InboundNumber:City",
    displayName: "Caller City",
    category: "tag",
    description: "City derived from the inbound number",
  },
  {
    column: "tag:InboundNumber:Zip",
    displayName: "Caller ZIP",
    category: "tag",
    description: "ZIP code derived from the inbound number",
  },
];

const DEFAULT_VALUE_COLUMNS: string[] = [
  "callCount",
  "liveCallCount",
  "completedCalls",
  "endedCalls",
  "connectedCallCount",
  "payoutCount",
  "convertedCalls",
  "nonConnectedCallCount",
  "duplicateCalls",
  "blockedCalls",
  "incompleteCalls",
  "earningsPerCallGross",
  "conversionAmount",
  "payoutAmount",
  "profitGross",
  "profitMarginGross",
  "convertedPercent",
  "callLengthInSeconds",
  "avgHandleTime",
  "totalCost",
];

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

loadEnvFiles([
  path.join(projectRoot, ".env"),
  path.resolve(projectRoot, "../RingbaApi/.env"),
  path.resolve(projectRoot, "../RingbaApi/.env.local"),
]);

const RINGBA_ACCOUNT_ID = process.env.RINGBA_ACCOUNT_ID;
const RINGBA_API_TOKEN = process.env.RINGBA_API_TOKEN;

const PORT = Number.parseInt(process.env.MCP_PORT ?? "3031", 10);
const HOST = process.env.MCP_HOST ?? "0.0.0.0";
const MCP_PATH = process.env.MCP_PATH ?? "/mcp";

const RINGBA_INSIGHTS_URL = `https://api.ringba.com/v2/${RINGBA_ACCOUNT_ID}/insights`;

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

async function main() {
  validateEnv();

  const app = createServer(async (req, res) => {
    await handleHttpRequest(req, res);
  });

  app.listen(PORT, HOST, () => {
    console.log(
      `ringba-api-mcp listening on ${HOST}:${PORT} with Streamable HTTP at ${MCP_PATH}`,
    );
  });
}

main().catch((error) => {
  console.error(formatError(error));
  process.exit(1);
});

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

// ---------------------------------------------------------------------------
// Request handling
// ---------------------------------------------------------------------------

async function handleHttpRequest(req: IncomingMessage, res: ServerResponse) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  const requestUrl = new URL(
    req.url ?? "/",
    `http://${req.headers.host ?? "localhost"}`,
  );
  if (requestUrl.pathname !== MCP_PATH) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32601, message: "Not found" },
        id: null,
      }),
    );
    return;
  }

  try {
    const parsedBody = await readRequestBody(req);
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    await server.connect(transport);

    res.on("close", () => {
      void transport.close();
      void server.close();
    });

    await transport.handleRequest(req, res, parsedBody);
  } catch (error) {
    console.error(formatError(error));
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        }),
      );
    }
  }
}

// ---------------------------------------------------------------------------
// MCP server definition
// ---------------------------------------------------------------------------

function createMcpServer() {
  const server = new Server(
    {
      name: "ringba-api-mcp",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "ringba_insights",
        description:
          "Run a Ringba EHG insights report. " +
          "Groups call data by a chosen dimension (target, publisher, state, etc.) " +
          "and returns aggregated metrics for the specified date range. " +
          "Supports filtering and custom value column selection.",
        inputSchema: {
          type: "object",
          properties: {
            reportStart: {
              type: "string",
              description:
                "Start of the report period as an ISO 8601 timestamp, e.g. 2026-06-11T06:00:00Z.",
            },
            reportEnd: {
              type: "string",
              description:
                "End of the report period as an ISO 8601 timestamp, e.g. 2026-06-18T05:59:59Z.",
            },
            groupByColumn: {
              type: "string",
              description:
                "Column to group results by. Common values: targetName, publisherName, " +
                "campaignName, buyerName, inboundNumber, callerId, callStatus, " +
                "tag:InboundNumber:State, tag:InboundNumber:City, tag:InboundNumber:Zip.",
            },
            groupByDisplayName: {
              type: "string",
              description:
                "Human-readable label for the group-by column in the output. " +
                "Defaults to the groupByColumn value.",
            },
            valueColumns: {
              type: "array",
              items: { type: "string" },
              description:
                "Array of metric columns to include. " +
                "If omitted, all 20 common metrics are returned. " +
                "Use ringba_list_available_columns to see all options.",
            },
            filters: {
              type: "array",
              items: { type: "object" },
              description:
                "Array of filter objects. Each filter has an anyConditionToMatch array " +
                "of conditions: { column, value, isNegativeMatch (bool), comparisonType }. " +
                "comparisonType can be: CONTAINS, EQUALS, STARTS_WITH, etc.",
            },
            orderByColumn: {
              type: "string",
              description:
                "Column to order results by. Default: callCount.",
            },
            orderDirection: {
              type: "string",
              enum: ["asc", "desc"],
              description: "Sort direction. Default: desc.",
            },
            maxResultsPerGroup: {
              type: "number",
              description:
                "Maximum results per group. Default 1000.",
            },
            formatTimeZone: {
              type: "string",
              description:
                "IANA timezone for date formatting in the response. Default: America/Denver.",
            },
            formatTimespans: {
              type: "boolean",
              description:
                "Whether to format timespan columns as human-readable strings. Default: true.",
            },
            formatPercentages: {
              type: "boolean",
              description:
                "Whether to format percentage columns as human-readable strings. Default: true.",
            },
            generateRollups: {
              type: "boolean",
              description:
                "Whether to include aggregate rollup rows in the response. Default: true.",
            },
          },
          required: ["reportStart", "reportEnd", "groupByColumn"],
        },
      },
      {
        name: "ringba_list_available_columns",
        description:
          "List all available columns for Ringba insights reports — both " +
          "group-by dimensions (targetName, publisherName, etc.) and value " +
          "metrics (callCount, convertedCalls, profitGross, etc.). " +
          "Includes tag columns like tag:InboundNumber:State.",
        inputSchema: {
          type: "object",
          properties: {
            category: {
              type: "string",
              enum: ["metric", "dimension", "tag"],
              description:
                "Filter by column category. Omit to return all columns.",
            },
          },
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const { name, arguments: rawArgs } = request.params;
      const args = (rawArgs ?? {}) as Record<string, unknown>;

      switch (name) {
        case "ringba_insights":
          return await handleRingbaInsights(args);

        case "ringba_list_available_columns":
          return handleListAvailableColumns(args);

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      return {
        content: [{ type: "text", text: formatError(error) }],
        isError: true,
      };
    }
  });

  return server;
}

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

async function handleRingbaInsights(args: Record<string, unknown>) {
  const reportStart = requiredString(args.reportStart, "reportStart");
  const reportEnd = requiredString(args.reportEnd, "reportEnd");
  const groupByColumn = requiredString(args.groupByColumn, "groupByColumn");
  const groupByDisplayName =
    optionalString(args.groupByDisplayName) ?? groupByColumn;

  // Build groupByColumns array
  const groupByColumns = [
    { column: groupByColumn, displayName: groupByDisplayName },
  ];

  // Build valueColumns array
  const rawValueColumns = args.valueColumns as string[] | undefined;
  const valueColumnNames =
    rawValueColumns && rawValueColumns.length > 0
      ? rawValueColumns
      : DEFAULT_VALUE_COLUMNS;
  const valueColumns = valueColumnNames.map((col) => ({
    column: col,
    aggregateFunction: null,
  }));

  // Build orderByColumns
  const orderByColumn = optionalString(args.orderByColumn) ?? "callCount";
  const orderDirection = optionalString(args.orderDirection) ?? "desc";
  const orderByColumns = [
    { column: orderByColumn, direction: orderDirection },
  ];

  // Optional parameters with defaults
  const filters = (args.filters as Record<string, unknown>[]) ?? [];
  const maxResultsPerGroup =
    (args.maxResultsPerGroup as number) ?? 1000;
  const formatTimeZone =
    optionalString(args.formatTimeZone) ?? "America/Denver";
  const formatTimespans = (args.formatTimespans as boolean) ?? true;
  const formatPercentages = (args.formatPercentages as boolean) ?? true;
  const generateRollups = (args.generateRollups as boolean) ?? true;

  const requestBody = {
    reportStart,
    reportEnd,
    groupByColumns,
    valueColumns,
    orderByColumns,
    formatTimespans,
    formatPercentages,
    generateRollups,
    maxResultsPerGroup,
    filters,
    formatTimeZone,
  };

  console.log(
    `[ringba_insights] ${reportStart} → ${reportEnd} grouped by ${groupByColumn}`,
  );

  const apiResponse = await callRingbaApi(RINGBA_INSIGHTS_URL, requestBody);

  const responseData =
    apiResponse && typeof apiResponse === "object" ? apiResponse : { raw: apiResponse };

  return toTextResult({
    request: {
      url: RINGBA_INSIGHTS_URL,
      reportStart,
      reportEnd,
      groupByColumn,
      valueColumnCount: valueColumns.length,
      filterCount: filters.length,
    },
    response: responseData,
  });
}

function handleListAvailableColumns(args: Record<string, unknown>) {
  const category = optionalString(args.category);

  const columns = category
    ? AVAILABLE_COLUMNS.filter((c) => c.category === category)
    : AVAILABLE_COLUMNS;

  return toTextResult({
    totalColumns: columns.length,
    category: category ?? "all",
    defaultValueColumns: DEFAULT_VALUE_COLUMNS,
    columns: columns.map((c) => ({
      column: c.column,
      displayName: c.displayName,
      category: c.category,
      description: c.description,
    })),
  });
}

// ---------------------------------------------------------------------------
// Ringba API client
// ---------------------------------------------------------------------------

async function callRingbaApi(
  url: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Token ${RINGBA_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();

  if (!response.ok) {
    let detail = text;
    try {
      const parsed = JSON.parse(text);
      detail = JSON.stringify(parsed, null, 2);
    } catch {
      // use raw text
    }
    throw new Error(
      `Ringba API returned HTTP ${response.status} ${response.statusText}\n${detail}`,
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateEnv() {
  if (!RINGBA_ACCOUNT_ID) {
    throw new Error("RINGBA_ACCOUNT_ID is required. Set it in .env.");
  }
  if (!RINGBA_API_TOKEN) {
    throw new Error("RINGBA_API_TOKEN is required. Set it in .env.");
  }
}

function requiredString(value: unknown, name: string): string {
  const str = typeof value === "string" ? value.trim() : "";
  if (!str) {
    throw new Error(`${name} is required and must be a non-empty string.`);
  }
  return str;
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

async function readRequestBody(req: IncomingMessage) {
  if (req.method === "GET" || req.method === "HEAD") {
    return undefined;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return undefined;
  }

  const rawBody = Buffer.concat(chunks).toString("utf8").trim();
  if (!rawBody) {
    return undefined;
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    return rawBody;
  }
}

function setCorsHeaders(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, DELETE, OPTIONS",
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, MCP-Session-Id, Authorization",
  );
}

function loadEnvFiles(filePaths: string[]) {
  for (const filePath of filePaths) {
    if (existsSync(filePath)) {
      dotenv.config({ path: filePath, override: false });
    }
  }
}

function toTextResult(payload: unknown) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function formatError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" ? error : JSON.stringify(error);
}
