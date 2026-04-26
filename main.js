import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'crypto';
import express from "express";
import { fileURLToPath } from "url";
import https from "https";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { formatArrivals } from "./formatters.js";

const app = express();
const PORT = process.env.PORT || 3001;

// Helper to create a configured MCP Server instance per connection
function createServerInstance() {
  const server = new Server(
    {
      name: "bus-arrivals-mcp-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
        logging: {},
      },
    }
  );

  // Register tool handlers on this server instance
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "bus-arrivals",
          description: "Get a list of bus arrivals for a bus stop name",
          inputSchema: {
            type: "object",
            properties: {
              bus_stop_name: {
                type: "string",
                description: "The bus stop name you want to query. (e.g., 'les fontetes', 'sagrera')"
              }
            },
            required: ["bus_stop_name"],
          },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "bus-arrivals") {
      const busStop = request.params.arguments.bus_stop_name;
      console.log(`L'IA ha demanat informació sobre la parada d'autobús: ${busStop}`);

      try {
        const matchingStops = Object.values(stopsMapping).filter((stop) =>
          stop.name.toLowerCase().includes(busStop.toLowerCase())
        );

        if (matchingStops.length === 0) {
          return {
            content: [{ type: "text", text: `No stops found matching "${busStop}".` }],
          };
        }

        const stopsToFetch = matchingStops.slice(0, 3);
        const API_BASE_URL = "https://glo6ir56yyjdlmdtig4ztnqu7q0dcwlz.lambda-url.eu-central-1.on.aws/api";

        const results = await Promise.all(
          stopsToFetch.map(async (stop) => {
            const url = `${API_BASE_URL}/json/GetTiemposParada/es/${stop.id}/${stop.lineId}/${stop.zoneId}`;
            const result = await fetch(url);
            const data = await result.json();

            return {
              stopName: stop.name,
              stopId: stop.id,
              arrivals: formatArrivals(data)
            };
          })
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `There was an error calling the API: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }

    throw new Error("Tool not found: " + request.params.name);
  });

  return server;
}

// Carrega de dades de mapeig
async function loadStopsMapping() {
  const url = "https://quantriga.com/stops/all.json.gz";
  try {
    const agent = new https.Agent({ rejectUnauthorized: false });
    const response = await fetch(url, { agent });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const decompressedStream = response.body.pipeThrough(new DecompressionStream("gzip"));
    const reader = decompressedStream.getReader();
    const decoder = new TextDecoder();
    let result = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      result += decoder.decode(value, { stream: true });
    }
    result += decoder.decode();
    return JSON.parse(result);
  } catch (error) {
    console.error("Failed to load stops mapping:", error);
    return null;
  }
}

const stopsMapping = await loadStopsMapping();

// Tool handlers are registered per-connection inside `createServerInstance()` above.

// Health check for AWS
app.get('/', (req, res) => {
  res.status(200).send('OK');
});

// --- CONFIGURACIÓ DEL TRANSPORT StreamableHttp AMB EXPRESS ---

// Map sessionId -> { transport, server }
const transports = new Map();

app.use(express.json());

async function handleStreamableRequest(req, res) {
  const headerSessionId = req.headers['mcp-session-id'] || req.query.sessionId;

  if (headerSessionId) {
    const entry = transports.get(headerSessionId);
    if (!entry) {
      return res.status(404).send('Sessió no trobada');
    }
    await entry.transport.handleRequest(req, res, req.body);
    return;
  }

  // No session id provided: create a new stateful transport for this initialization
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });

  // Create a fresh Server instance for this connection and connect it
  // Temporary debug: capture transport errors with full stack trace
  transport.onerror = (err) => {
    console.error('Temporary transport.onerror — full error:', err);
    if (err && err.stack) console.error(err.stack);
    else console.error(String(err));
  };

  const serverInstance = createServerInstance();
  await serverInstance.connect(transport);

  // Wire up cleanup
  transport.onclose = () => {
    if (transport.sessionId) transports.delete(transport.sessionId);
    serverInstance.close().catch(() => { });
  };

  // Handle the incoming request (could be POST initialize or GET SSE)
  await transport.handleRequest(req, res, req.body);

  // If transport produced a sessionId during initialization, track it
  if (transport.sessionId) {
    transports.set(transport.sessionId, { transport, server: serverInstance });
  }
}

// Routes: accept both the GET stream and POST messages paths for compatibility
app.all('/stream', handleStreamableRequest);
app.all('/messages', handleStreamableRequest);

// Iniciem l'aplicació Express
app.listen(PORT, () => {
  console.log(`Servidor MCP escoltant a http://localhost:${PORT}`);
  console.log(`Endpoint StreamableHttp: http://localhost:${PORT}/stream`);
});
