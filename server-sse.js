import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import { fileURLToPath } from "url";
import https from "https";
import apiBasedTools from "./api-based-tools.js";

// Inicialització del servidor MCP
const server = new McpServer({
  name: "bus-arrivals-server",
  version: "1.0.0",
});

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
apiBasedTools(server, stopsMapping);

// Configuració d'Express per a App Runner (SSE)
const app = express();
let transport = null;

app.get("/sse", async (req, res) => {
  console.log("Nova connexió SSE");
  transport = new SSEServerTransport("/messages", res);
  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  console.log("Missatge rebut");
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(400).send("No hi ha cap sessió SSE activa");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor MCP escortant a http://localhost:${PORT}`);
  console.log(`Endpoint SSE: http://localhost:${PORT}/sse`);
  console.log(`Endpoint missatges: http://localhost:${PORT}/messages`);
});
