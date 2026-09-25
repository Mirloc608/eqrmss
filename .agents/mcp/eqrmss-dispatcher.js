// ============================================================================
// EQRMSS — MCP PLAN STATE DISPATCHER
// ============================================================================
//
// PURPOSE
// -------
// Exposes the authoritative EQRMSS plan state through a minimal MCP
// Streamable HTTP endpoint.
//
// This service exists as a coordination boundary between external agent
// clients (such as Continue) and the EQRMSS planning state.
//
// CURRENT CAPABILITIES
// --------------------
// - MCP initialize
// - MCP notifications/initialized
// - MCP tools/list
// - MCP tools/call
// - eqrmss_plan_status
// - eqrmss_get_task
//
// TRANSPORT
// ---------
// MCP Streamable HTTP
//
// Default endpoint:
//     http://<server>:3333/mcp
//
// The implementation intentionally uses only Node.js built-in modules.
// No external MCP SDK is required.
//
// AUTHORITY
// ---------
// The authoritative plan state remains:
//
//     .agents/state/current-plan.json
//
// The dispatcher does NOT become the authority for plan identity.
//
// NON-RESPONSIBILITIES
// --------------------
// This dispatcher does NOT:
//
// - authorize tasks
// - revoke authorization
// - execute workers
// - implement repository changes
// - validate implementation
// - modify current-plan.json
// - modify repository source files
// - create plans
// - alter task definitions
//
// SECURITY
// --------
// Authentication is disabled by default for initial commissioning.
//
// Set:
//
//     EQRMSS_MCP_TOKEN=<token>
//
// to require:
//
//     Authorization: Bearer <token>
//
// SESSION MODEL
// -------------
// MCP Streamable HTTP sessions are kept in memory.
//
// This is intentional for the current commissioning boundary.
// Restarting the dispatcher invalidates existing sessions.
//
// ARCHITECTURE
// ------------
// Continue
//    |
//    | MCP Streamable HTTP
//    v
// /mcp
//    |
//    v
// EQRMSS MCP Dispatcher
//    |
//    +--> current-plan.json
//    |
//    +--> plan-state-manager.js status
//    |
//    v
// Read-only MCP tools
//
// ============================================================================

"use strict";

const http = require("node:http");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

// ============================================================================
// CONFIGURATION
// ============================================================================

const REPOSITORY_ROOT = path.resolve(__dirname, "../..");

const STATE_PATH = path.join(
  REPOSITORY_ROOT,
  ".agents",
  "state",
  "current-plan.json"
);

const STATE_MANAGER_PATH = path.join(
  REPOSITORY_ROOT,
  ".agents",
  "state",
  "plan-state-manager.js"
);

const HOST = process.env.EQRMSS_MCP_HOST || "0.0.0.0";

const PORT = Number.parseInt(
  process.env.EQRMSS_MCP_PORT || "3333",
  10
);

const MCP_PATH = normalizePath(
  process.env.EQRMSS_MCP_PATH || "/mcp"
);

const MCP_TOKEN =
  typeof process.env.EQRMSS_MCP_TOKEN === "string" &&
  process.env.EQRMSS_MCP_TOKEN.length > 0
    ? process.env.EQRMSS_MCP_TOKEN
    : null;

const SERVER_NAME = "EQRMSS Plan State MCP Dispatcher";
const SERVER_VERSION = "1.1.1";

const MCP_PROTOCOL_VERSION = "2025-03-26";

// ============================================================================
// SESSION STATE
// ============================================================================

/**
 * Active MCP sessions.
 *
 * Session state is intentionally ephemeral.
 *
 * Map:
 *   sessionId -> {
 *     createdAt: number,
 *     lastActivityAt: number,
 *     protocolVersion: string
 *   }
 */
const sessions = new Map();

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function normalizePath(value) {
  if (!value || value === "/") {
    return "/";
  }

  const normalized = value.startsWith("/")
    ? value
    : `/${value}`;

  return normalized.endsWith("/")
    ? normalized.slice(0, -1)
    : normalized;
}

function sendJson(
  response,
  statusCode,
  payload,
  headers = {}
) {
  const body = JSON.stringify(payload);

  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    ...headers
  });

  response.end(body);
}

function sendEmpty(
  response,
  statusCode,
  headers = {}
) {
  response.writeHead(statusCode, headers);
  response.end();
}

function sendText(
  response,
  statusCode,
  text,
  headers = {}
) {
  const body = String(text);

  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    ...headers
  });

  response.end(body);
}

function sendMethodNotAllowed(response) {
  sendJson(
    response,
    405,
    {
      error: "Method not allowed."
    },
    {
      Allow: "GET, POST, DELETE, OPTIONS"
    }
  );
}

function sendNotFound(response) {
  sendJson(response, 404, {
    error: "Not found."
  });
}

function sendInvalidRequest(response, message) {
  sendJson(response, 400, {
    error: message
  });
}

function sendUnauthorized(response) {
  sendJson(
    response,
    401,
    {
      error: "Unauthorized."
    },
    {
      "WWW-Authenticate": "Bearer"
    }
  );
}

function sendInternalError(response, message) {
  sendJson(response, 500, {
    error: message
  });
}

function parseBearerToken(request) {
  const header = request.headers.authorization;

  if (typeof header !== "string") {
    return null;
  }

  const match = header.match(/^Bearer\s+(.+)$/i);

  return match ? match[1] : null;
}

function isAuthorized(request) {
  if (!MCP_TOKEN) {
    return true;
  }

  const suppliedToken = parseBearerToken(request);

  return (
    typeof suppliedToken === "string" &&
    suppliedToken === MCP_TOKEN
  );
}

function generateSessionId() {
  return crypto.randomUUID();
}

function createSession(protocolVersion) {
  const now = Date.now();
  const sessionId = generateSessionId();

  sessions.set(sessionId, {
    createdAt: now,
    lastActivityAt: now,
    protocolVersion
  });

  return sessionId;
}

function getSession(sessionId) {
  if (!sessionId) {
    return null;
  }

  return sessions.get(sessionId) || null;
}

function touchSession(sessionId) {
  const session = getSession(sessionId);

  if (!session) {
    return null;
  }

  session.lastActivityAt = Date.now();

  return session;
}

function removeSession(sessionId) {
  if (!sessionId) {
    return false;
  }

  return sessions.delete(sessionId);
}

function getSessionId(request) {
  const value = request.headers["mcp-session-id"];

  if (Array.isArray(value)) {
    return value[0] || null;
  }

  return typeof value === "string"
    ? value
    : null;
}

function getProtocolVersion(request) {
  const value = request.headers["mcp-protocol-version"];

  if (Array.isArray(value)) {
    return value[0] || MCP_PROTOCOL_VERSION;
  }

  return typeof value === "string" && value.length > 0
    ? value
    : MCP_PROTOCOL_VERSION;
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    request.on("data", (chunk) => {
      chunks.push(chunk);
    });

    request.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });

    request.on("error", reject);
  });
}

async function readJsonBody(request) {
  const body = await readRequestBody(request);

  if (!body.trim()) {
    return null;
  }

  try {
    return JSON.parse(body);
  } catch (error) {
    const parseError = new Error(
      `Invalid JSON request body: ${error.message}`
    );

    parseError.code = "INVALID_JSON";

    throw parseError;
  }
}

function isJsonRpcRequest(message) {
  return (
    message &&
    typeof message === "object" &&
    message.jsonrpc === "2.0" &&
    Object.prototype.hasOwnProperty.call(message, "id") &&
    typeof message.method === "string"
  );
}

function isJsonRpcNotification(message) {
  return (
    message &&
    typeof message === "object" &&
    message.jsonrpc === "2.0" &&
    !Object.prototype.hasOwnProperty.call(message, "id") &&
    typeof message.method === "string"
  );
}

function jsonRpcResult(id, result) {
  return {
    jsonrpc: "2.0",
    id,
    result
  };
}

function jsonRpcError(
  id,
  code,
  message,
  data
) {
  const error = {
    code,
    message
  };

  if (typeof data !== "undefined") {
    error.data = data;
  }

  return {
    jsonrpc: "2.0",
    id,
    error
  };
}

function jsonRpcNotificationResult() {
  return null;
}

// ============================================================================
// PLAN STATE ACCESS
// ============================================================================

function readCurrentPlan() {
  if (!fs.existsSync(STATE_PATH)) {
    throw new Error(
      `Authoritative plan state does not exist: ${STATE_PATH}`
    );
  }

  const raw = fs.readFileSync(
    STATE_PATH,
    "utf8"
  );

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Unable to parse authoritative plan state: ${error.message}`
    );
  }
}

function runPlanStateManagerStatus() {
  if (!fs.existsSync(STATE_MANAGER_PATH)) {
    throw new Error(
      `Plan state manager does not exist: ${STATE_MANAGER_PATH}`
    );
  }

  const result = spawnSync(
    process.execPath,
    [
      STATE_MANAGER_PATH,
      "status"
    ],
    {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8"
    }
  );

  if (result.error) {
    throw new Error(
      `Unable to execute plan state manager: ${result.error.message}`
    );
  }

  if (result.status !== 0) {
    const stderr =
      typeof result.stderr === "string" &&
      result.stderr.trim()
        ? result.stderr.trim()
        : "Unknown plan state manager error.";

    throw new Error(
      `Plan state manager status failed: ${stderr}`
    );
  }

  const stdout =
    typeof result.stdout === "string"
      ? result.stdout.trim()
      : "";

  if (!stdout) {
    throw new Error(
      "Plan state manager returned no status output."
    );
  }

  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(
      `Plan state manager returned invalid JSON: ${error.message}`
    );
  }
}

// ============================================================================
// READ-ONLY TOOL DEFINITIONS
// ============================================================================

const TOOLS = [
  {
    name: "eqrmss_plan_status",
    description:
      "Read the authoritative EQRMSS current plan state. This operation is read-only and does not authorize, execute, validate, or modify tasks.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: "eqrmss_get_task",
    description:
      "Read the exact frozen definition of an EQRMSS plan task from the authoritative current plan state.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description:
            "Exact plan task identifier, such as P001."
        }
      },
      required: [
        "taskId"
      ],
      additionalProperties: false
    }
  }
];

// ============================================================================
// READ-ONLY TOOL IMPLEMENTATIONS
// ============================================================================

function toolPlanStatus() {
  const plan = readCurrentPlan();

  let managerStatus = null;

  try {
    managerStatus = runPlanStateManagerStatus();
  } catch (error) {
    managerStatus = {
      error: error.message
    };
  }

  return {
    plan,
    stateManagerStatus: managerStatus
  };
}

function toolGetTask(argumentsObject) {
  const taskId =
    argumentsObject &&
    typeof argumentsObject.taskId === "string"
      ? argumentsObject.taskId.trim()
      : "";

  if (!taskId) {
    throw new Error(
      "taskId is required."
    );
  }

  const plan = readCurrentPlan();

  let task = null;

  // --------------------------------------------------------------------------
  // The authoritative current-plan.json schema stores tasks as an object
  // keyed by exact task ID:
  //
  //   "tasks": {
  //     "P001": {
  //       "id": "P001",
  //       ...
  //     }
  //   }
  //
  // Support that canonical structure directly. The array form is retained as
  // a compatibility path for older or alternate plan-state representations.
  // --------------------------------------------------------------------------

  if (
    plan.tasks &&
    typeof plan.tasks === "object" &&
    !Array.isArray(plan.tasks)
  ) {
    const candidate = plan.tasks[taskId];

    if (
      candidate &&
      typeof candidate === "object" &&
      candidate.id === taskId
    ) {
      task = candidate;
    }
  } else if (Array.isArray(plan.tasks)) {
    task =
      plan.tasks.find(
        (candidate) =>
          candidate &&
          candidate.id === taskId
      ) || null;
  }

  if (!task) {
    throw new Error(
      `Task ${taskId} is not defined in the authoritative current plan state.`
    );
  }

  return {
    planId: plan.planId ?? null,
    planVersion: plan.planVersion ?? null,
    planStatus: plan.status ?? null,
    task
  };
}

function callTool(
  name,
  argumentsObject
) {
  switch (name) {
    case "eqrmss_plan_status":
      return toolPlanStatus();

    case "eqrmss_get_task":
      return toolGetTask(argumentsObject);

    default:
      const error = new Error(
        `Unknown tool: ${name}`
      );

      error.code = "UNKNOWN_TOOL";

      throw error;
  }
}

// ============================================================================
// MCP INITIALIZATION
// ============================================================================

function buildInitializeResult() {
  return {
    protocolVersion: MCP_PROTOCOL_VERSION,

    capabilities: {
      tools: {
        listChanged: false
      }
    },

    serverInfo: {
      name: SERVER_NAME,
      version: SERVER_VERSION
    }
  };
}

function buildToolsListResult() {
  return {
    tools: TOOLS
  };
}

// ============================================================================
// JSON-RPC REQUEST DISPATCH
// ============================================================================

function handleJsonRpcRequest(
  message,
  sessionId
) {
  if (!isJsonRpcRequest(message)) {
    return jsonRpcError(
      message && message.id !== undefined
        ? message.id
        : null,
      -32600,
      "Invalid Request."
    );
  }

  const {
    id,
    method,
    params
  } = message;

  switch (method) {
    case "initialize": {
      const requestedProtocol =
        params &&
        typeof params.protocolVersion === "string"
          ? params.protocolVersion
          : MCP_PROTOCOL_VERSION;

      const negotiatedProtocol =
        requestedProtocol === MCP_PROTOCOL_VERSION
          ? requestedProtocol
          : MCP_PROTOCOL_VERSION;

      return {
        response: jsonRpcResult(
          id,
          {
            ...buildInitializeResult(),
            protocolVersion: negotiatedProtocol
          }
        ),
        createSession: true,
        negotiatedProtocol
      };
    }

    case "tools/list": {
      if (!sessionId) {
        return jsonRpcError(
          id,
          -32000,
          "MCP session is required."
        );
      }

      if (!getSession(sessionId)) {
        return jsonRpcError(
          id,
          -32000,
          "Unknown or expired MCP session."
        );
      }

      return {
        response: jsonRpcResult(
          id,
          buildToolsListResult()
        )
      };
    }

    case "tools/call": {
      if (!sessionId) {
        return jsonRpcError(
          id,
          -32000,
          "MCP session is required."
        );
      }

      if (!getSession(sessionId)) {
        return jsonRpcError(
          id,
          -32000,
          "Unknown or expired MCP session."
        );
      }

      const toolName =
        params &&
        typeof params.name === "string"
          ? params.name
          : "";

      const toolArguments =
        params &&
        params.arguments &&
        typeof params.arguments === "object"
          ? params.arguments
          : {};

      if (!toolName) {
        return jsonRpcError(
          id,
          -32602,
          "tools/call requires a tool name."
        );
      }

      try {
        const result = callTool(
          toolName,
          toolArguments
        );

        return {
          response: jsonRpcResult(
            id,
            {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    result,
                    null,
                    2
                  )
                }
              ],
              structuredContent: result,
              isError: false
            }
          )
        };
      } catch (error) {
        if (error && error.code === "UNKNOWN_TOOL") {
          return {
            response: jsonRpcError(
              id,
              -32602,
              error.message
            )
          };
        }

        return {
          response: jsonRpcResult(
            id,
            {
              content: [
                {
                  type: "text",
                  text: error.message
                }
              ],
              isError: true
            }
          )
        };
      }
    }

    default:
      return {
        response: jsonRpcError(
          id,
          -32601,
          `Method not found: ${method}`
        )
      };
  }
}

function handleJsonRpcNotification(
  message,
  sessionId
) {
  if (!isJsonRpcNotification(message)) {
    return;
  }

  switch (message.method) {
    case "notifications/initialized":
      if (sessionId) {
        touchSession(sessionId);
      }
      return;

    default:
      return;
  }
}

// ============================================================================
// STREAMABLE HTTP
// ============================================================================

function getCommonSessionHeaders(
  sessionId
) {
  if (!sessionId) {
    return {};
  }

  return {
    "Mcp-Session-Id": sessionId,
    "Mcp-Protocol-Version": MCP_PROTOCOL_VERSION
  };
}

function validateSessionForRequest(
  request,
  response
) {
  const sessionId = getSessionId(request);

  if (!sessionId) {
    return {
      valid: false,
      sessionId: null,
      responseSent: false
    };
  }

  if (!getSession(sessionId)) {
    sendJson(
      response,
      404,
      {
        error: "Unknown or expired MCP session."
      }
    );

    return {
      valid: false,
      sessionId,
      responseSent: true
    };
  }

  touchSession(sessionId);

  return {
    valid: true,
    sessionId,
    responseSent: false
  };
}

async function handleMcpPost(
  request,
  response
) {
  if (!isAuthorized(request)) {
    sendUnauthorized(response);
    return;
  }

  let message;

  try {
    message = await readJsonBody(request);
  } catch (error) {
    if (error.code === "INVALID_JSON") {
      sendJson(
        response,
        400,
        {
          error: error.message
        }
      );

      return;
    }

    sendInternalError(
      response,
      error.message
    );

    return;
  }

  if (!message) {
    sendInvalidRequest(
      response,
      "Request body is required."
    );

    return;
  }

  const sessionId = getSessionId(request);

  // --------------------------------------------------------------------------
  // INITIALIZE
  // --------------------------------------------------------------------------

  if (
    isJsonRpcRequest(message) &&
    message.method === "initialize"
  ) {
    if (sessionId) {
      sendJson(
        response,
        400,
        {
          error:
            "An MCP initialize request must not use an existing session."
        }
      );

      return;
    }

    const result = handleJsonRpcRequest(
      message,
      null
    );

    if (!result || !result.response) {
      sendInternalError(
        response,
        "Initialization failed."
      );

      return;
    }

    const negotiatedProtocol =
      result.negotiatedProtocol ||
      MCP_PROTOCOL_VERSION;

    const newSessionId = createSession(
      negotiatedProtocol
    );

    sendJson(
      response,
      200,
      result.response,
      {
        ...getCommonSessionHeaders(
          newSessionId
        )
      }
    );

    return;
  }

  // --------------------------------------------------------------------------
  // EXISTING SESSION REQUESTS
  // --------------------------------------------------------------------------

  const sessionValidation =
    validateSessionForRequest(
      request,
      response
    );

  if (!sessionValidation.valid) {
    if (!sessionValidation.responseSent) {
      sendJson(
        response,
        400,
        {
          error:
            "MCP session is required."
        }
      );
    }

    return;
  }

  const activeSessionId =
    sessionValidation.sessionId;

  if (isJsonRpcNotification(message)) {
    handleJsonRpcNotification(
      message,
      activeSessionId
    );

    // MCP notifications do not require a JSON-RPC response.
    sendEmpty(
      response,
      202,
      getCommonSessionHeaders(
        activeSessionId
      )
    );

    return;
  }

  if (!isJsonRpcRequest(message)) {
    sendJson(
      response,
      400,
      jsonRpcError(
        null,
        -32600,
        "Invalid Request."
      ),
      getCommonSessionHeaders(
        activeSessionId
      )
    );

    return;
  }

  const result = handleJsonRpcRequest(
    message,
    activeSessionId
  );

  if (!result || !result.response) {
    sendInternalError(
      response,
      "MCP request produced no response."
    );

    return;
  }

  sendJson(
    response,
    200,
    result.response,
    getCommonSessionHeaders(
      activeSessionId
    )
  );
}

// ============================================================================
// SSE SUPPORT
// ============================================================================

function openSseStream(
  request,
  response
) {
  if (!isAuthorized(request)) {
    sendUnauthorized(response);
    return;
  }

  const sessionId = getSessionId(request);

  if (!sessionId || !getSession(sessionId)) {
    sendJson(
      response,
      404,
      {
        error:
          "A valid MCP session is required for SSE."
      }
    );

    return;
  }

  touchSession(sessionId);

  response.writeHead(
    200,
    {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      ...getCommonSessionHeaders(
        sessionId
      )
    }
  );

  response.write(": eqrmss-mcp\n\n");

  const keepAlive = setInterval(() => {
    if (response.writableEnded) {
      clearInterval(keepAlive);
      return;
    }

    response.write(": keepalive\n\n");
  }, 15000);

  request.on("close", () => {
    clearInterval(keepAlive);
  });
}

// ============================================================================
// DELETE SESSION
// ============================================================================

function handleMcpDelete(
  request,
  response
) {
  if (!isAuthorized(request)) {
    sendUnauthorized(response);
    return;
  }

  const sessionId = getSessionId(request);

  if (!sessionId) {
    sendEmpty(
      response,
      405,
      {
        Allow: "POST, GET, OPTIONS"
      }
    );

    return;
  }

  if (!getSession(sessionId)) {
    sendJson(
      response,
      404,
      {
        error: "Unknown or expired MCP session."
      }
    );

    return;
  }

  removeSession(sessionId);

  sendEmpty(
    response,
    200
  );
}

// ============================================================================
// HTTP SERVER
// ============================================================================

const server = http.createServer(
  async (request, response) => {
    try {
      const requestUrl =
        new URL(
          request.url,
          `http://${request.headers.host || "localhost"}`
        );

      // ----------------------------------------------------------------------
      // OPTIONS
      // ----------------------------------------------------------------------

      if (request.method === "OPTIONS") {
        response.writeHead(
          204,
          {
            Allow: "GET, POST, DELETE, OPTIONS",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers":
              "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version",
            "Access-Control-Allow-Methods":
              "GET, POST, DELETE, OPTIONS"
          }
        );

        response.end();
        return;
      }

      // ----------------------------------------------------------------------
      // Root status endpoint
      // ----------------------------------------------------------------------

      if (
        requestUrl.pathname === "/" &&
        request.method === "GET"
      ) {
        sendJson(
          response,
          200,
          {
            service: SERVER_NAME,
            version: SERVER_VERSION,
            transport: "streamable-http",
            mcpPath: MCP_PATH,
            statePath: STATE_PATH,
            stateManagerPath: STATE_MANAGER_PATH,
            authentication:
              MCP_TOKEN
                ? "enabled"
                : "disabled",
            tools: TOOLS.map(
              (tool) => tool.name
            )
          }
        );

        return;
      }

      // ----------------------------------------------------------------------
      // MCP endpoint
      // ----------------------------------------------------------------------

      if (
        requestUrl.pathname !== MCP_PATH
      ) {
        sendNotFound(response);
        return;
      }

      if (request.method === "POST") {
        await handleMcpPost(
          request,
          response
        );

        return;
      }

      if (request.method === "GET") {
        openSseStream(
          request,
          response
        );

        return;
      }

      if (request.method === "DELETE") {
        handleMcpDelete(
          request,
          response
        );

        return;
      }

      sendMethodNotAllowed(response);
    } catch (error) {
      if (!response.headersSent) {
        sendInternalError(
          response,
          error.message
        );
      } else {
        response.destroy();
      }
    }
  }
);

// ============================================================================
// STARTUP
// ============================================================================

server.listen(
  PORT,
  HOST,
  () => {
    console.log(
      JSON.stringify(
        {
          service: SERVER_NAME,
          version: SERVER_VERSION,
          transport: "streamable-http",
          host: HOST,
          port: PORT,
          mcpPath: MCP_PATH,
          endpoint:
            `http://${HOST === "0.0.0.0" ? "<server>" : HOST}:${PORT}${MCP_PATH}`,
          statePath: STATE_PATH,
          stateManagerPath: STATE_MANAGER_PATH,
          authentication:
            MCP_TOKEN
              ? "enabled"
              : "disabled",
          tools: TOOLS.map(
            (tool) => tool.name
          )
        },
        null,
        2
      )
    );
  }
);

// ============================================================================
// SHUTDOWN
// ============================================================================

function shutdown(signal) {
  console.log(
    JSON.stringify({
      service: SERVER_NAME,
      event: "shutdown",
      signal
    })
  );

  for (const sessionId of sessions.keys()) {
    sessions.delete(sessionId);
  }

  server.close(() => {
    process.exit(0);
  });
}

process.on(
  "SIGINT",
  () => shutdown("SIGINT")
);

process.on(
  "SIGTERM",
  () => shutdown("SIGTERM")
);

