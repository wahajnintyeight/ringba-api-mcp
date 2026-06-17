# Ringba API MCP Server

Streamable HTTP MCP server that exposes Ringba analytics APIs as tools for
AI-assisted workflows — starting with EHG insights reports, with more Ringba
endpoints to follow.

## Quick Start

```bash
npm install
cp .env.example .env   # then edit .env with your credentials
npm run build
npm start
```

The server listens on `http://0.0.0.0:3031/mcp-ringba` by default. Point your
MCP client at that URL.

## Architecture

```
Client (Claude Code / IDE)
  │
  │  JSON-RPC 2.0 over Streamable HTTP
  ▼
ringba-api-mcp  (TypeScript, @modelcontextprotocol/sdk)
  │
  │  POST  Authorization: Token <api_key>
  ▼
Ringba API  (api.ringba.com/v2/{accountId}/insights)
```

- **Transport:** Streamable HTTP (`/mcp-ringba`), stateless, no session IDs
- **Auth:** Ringba API token in `Authorization` header on upstream calls
- **Port/Host:** Configurable via `MCP_PORT` / `MCP_HOST` (defaults: `3031` / `0.0.0.0`)
- **CORS:** Open (`*`) for local tooling

## Environment Variables

| Variable               | Required | Default         | Description                                      |
|------------------------|----------|-----------------|--------------------------------------------------|
| `RINGBA_ACCOUNT_ID`    | yes      | —               | Ringba account ID (e.g. `RAc...`)                |
| `RINGBA_API_TOKEN`     | yes      | —               | Ringba API token                                 |
| `MCP_PORT`             | no       | `3031`          | HTTP listen port                                 |
| `MCP_HOST`             | no       | `0.0.0.0`       | HTTP bind address                                |
| `MCP_PATH`             | no       | `/mcp-ringba`   | MCP endpoint path                                |

The server also loads `../RingbaApi/.env` and `../RingbaApi/.env.local` if they
exist, so you can share credentials with the main RingbaApi project.

## Tools

### `ringba_insights`

Run an EHG insights report — group call data by a dimension and get aggregated
metrics for a date range.

**Required parameters:**

| Parameter    | Type   | Description                                                 |
|--------------|--------|-------------------------------------------------------------|
| `reportStart`| string | ISO 8601 start timestamp (`2026-06-11T06:00:00Z`)          |
| `reportEnd`  | string | ISO 8601 end timestamp (`2026-06-18T05:59:59Z`)            |
| `groupByColumn` | string | Dimension to group by (see available columns below)      |

**Optional parameters:**

| Parameter             | Type           | Default                      | Description                              |
|-----------------------|----------------|------------------------------|------------------------------------------|
| `groupByDisplayName`  | string         | same as `groupByColumn`      | Label in output                         |
| `valueColumns`        | string[]       | all 20 default metrics       | Metrics to include                      |
| `filters`             | object[]       | `[]`                         | Filter conditions                       |
| `orderByColumn`       | string         | `callCount`                  | Sort column                             |
| `orderDirection`      | `asc` \| `desc`| `desc`                       | Sort direction                          |
| `maxResultsPerGroup`  | number         | `1000`                       | Row cap per group                       |
| `formatTimeZone`      | string         | `America/Denver`             | IANA timezone for dates                 |
| `formatTimespans`     | boolean        | `true`                       | Human-readable durations                |
| `formatPercentages`   | boolean        | `true`                       | Human-readable percentages              |
| `generateRollups`     | boolean        | `true`                       | Include aggregate rows                  |

**Filter syntax:**

Each filter object wraps an `anyConditionToMatch` array of conditions:

```json
{
  "column": "targetName",
  "value": "Elevated",
  "isNegativeMatch": false,
  "comparisonType": "CONTAINS"
}
```

Supported comparison types: `CONTAINS`, `EQUALS`, `STARTS_WITH`, `ENDS_WITH`,
`GREATER_THAN`, `LESS_THAN`, and others provided by the Ringba API.

**Example call via MCP:**

```json
{
  "name": "ringba_insights",
  "arguments": {
    "reportStart": "2026-06-11T06:00:00Z",
    "reportEnd": "2026-06-18T05:59:59Z",
    "groupByColumn": "targetName",
    "filters": [
      {
        "anyConditionToMatch": [
          {
            "column": "targetName",
            "value": "Elevated",
            "isNegativeMatch": false,
            "comparisonType": "CONTAINS"
          }
        ]
      }
    ]
  }
}
```

### `ringba_list_available_columns`

Reference tool — returns all known columns you can use in `groupByColumn`,
`valueColumns`, `orderByColumn`, and `filters`.

**Optional parameter:**

| Parameter  | Type   | Description                                              |
|------------|--------|----------------------------------------------------------|
| `category` | string | Filter by `metric`, `dimension`, or `tag`. Omit for all. |

**Available group-by dimensions:**

`targetName`, `publisherName`, `campaignName`, `buyerName`, `inboundNumber`,
`callerId`, `callStatus`, `tag:InboundNumber:State`, `tag:InboundNumber:City`,
`tag:InboundNumber:Zip`

**Default value metrics (20 columns):**

`callCount`, `liveCallCount`, `completedCalls`, `endedCalls`,
`connectedCallCount`, `nonConnectedCallCount`, `duplicateCalls`, `blockedCalls`,
`incompleteCalls`, `payoutCount`, `convertedCalls`, `conversionAmount`,
`payoutAmount`, `profitGross`, `profitMarginGross`, `earningsPerCallGross`,
`totalCost`, `callLengthInSeconds`, `avgHandleTime`, `convertedPercent`

## Extending

This server is scoped to `ringba-api-mcp` so additional Ringba endpoints
(number management, campaign config, etc.) can be added as new tools under the
same server without breaking existing clients.

To add a new endpoint:

1. Add a tool definition in `ListToolsRequestSchema` handler
2. Add a case in the `CallToolRequestSchema` switch
3. Write a handler that calls the Ringba API via `fetch()`
4. Add any new column definitions to `AVAILABLE_COLUMNS` if needed

## Differences from `db-mcp-server`

| Aspect               | `db-mcp-server`              | `ringba-api-mcp`              |
|----------------------|------------------------------|-------------------------------|
| Backend              | Prisma / PostgreSQL          | Ringba REST API               |
| Operations           | CRUD (no delete) on DB models| API endpoints as tools        |
| Auth                 | Database credentials         | Ringba API token              |
| Default port         | `3030`                       | `3031`                        |
| Default path         | `/mcp`                       | `/mcp-ringba`                 |
