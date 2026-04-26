import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
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

// --- CONFIGURACIÓ DEL TRANSPORT SSE AMB EXPRESS ---

// Map sessionId -> { transport, server }
const transports = new Map();

// Endpoint 1: El client es connecta aquí per establir el canal de comunicació SSE
app.get("/sse", async (req, res) => {
  console.log("Nova connexió SSE establerta");
  // Creem el transport. El primer paràmetre és la ruta on el client haurà d'enviar els POST
  const transport = new SSEServerTransport("/messages", res);

  // Create a fresh Server instance for this connection and connect it
  const serverInstance = createServerInstance();
  await serverInstance.connect(transport);

  // Track the transport by sessionId so POSTs can be routed correctly
  transports.set(transport.sessionId, { transport, server: serverInstance });

  // Cleanup when the transport closes
  transport.onclose = () => {
    transports.delete(transport.sessionId);
    serverInstance.close().catch(() => { });
  };
});

// Endpoint 2: El client envia les consultes JSON-RPC a través d'aquest endpoint
app.post("/messages", async (req, res) => {
  // Expect clients to include `?sessionId=...` as provided by the SSE `endpoint` event
  const sessionId = req.query.sessionId;
  if (!sessionId) {
    return res.status(400).send("Missing sessionId query parameter.");
  }

  const entry = transports.get(sessionId);
  if (!entry) {
    return res.status(404).send("Sessió no trobada");
  }

  await entry.transport.handlePostMessage(req, res);
});

// Iniciem l'aplicació Express
app.listen(PORT, () => {
  console.log(`Servidor MCP escoltant a http://localhost:${PORT}`);
  console.log(`Endpoint SSE: http://localhost:${PORT}/sse`);
});






// // Some MCP clients POST messages to the same path used for the SSE
// // subscription. Accept POSTs to `/sse` and forward to the matching session.
// app.post("/sse", async (req, res) => {
//   const sessionId = req.query.sessionId;
//   const transport = transports.get(sessionId);
//   if (!transport) {
//     res.status(404).send("Sessió no trobada");
//     return;
//   }
//   await transport.handlePostMessage(req, res);
// });

// app.post("/messages", async (req, res) => {
//   console.log("Missatge rebut");
  
//   // The MCP SDK automatically appends ?sessionId=... to this request
//   const sessionId = req.query.sessionId;
//   const transport = transports.get(sessionId);
  
//   // If the session doesn't exist or dropped, fail gracefully instead of crashing
//   if (!transport) {
//     res.status(404).send("Sessió no trobada");
//     return;
//   }
  
//   await transport.handlePostMessage(req, res);
// });

// const PORT = process.env.PORT || 3001;

// app.listen(PORT, '0.0.0.0', () => {
//   console.log(`Servidor MCP escortant a http://0.0.0.0:${PORT}`);
//   console.log(`Endpoint SSE: http://0.0.0.0:${PORT}/sse`);
//   console.log(`Endpoint missatges: http://0.0.0.0:${PORT}/messages`);
//   console.log(`Health check: http://0.0.0.0:${PORT}/`);
// });
