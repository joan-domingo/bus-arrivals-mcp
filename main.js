import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import path from "path";
import { fileURLToPath } from "url";
import https from "https";
import apiBasedTools from "./api-based-tools.js";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create an MCP server
const server = new McpServer({
  name: "bus-arrivals-mcp-server",
  version: "1.0.0",
});

// Load mapping data
async function loadStopsMapping() {
  const url = "https://quantriga.com/stops/all.json.gz";
  try {
    // Note: If you encounter certificate issues (SELF_SIGNED_CERT_IN_CHAIN), 
    // we use a custom agent to bypass TLS verification for this specific request.
    const agent = new https.Agent({
      rejectUnauthorized: false
    });
    
    const response = await fetch(url, { agent });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    
    // Decompress the .gz stream
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

// Register API-based tools
apiBasedTools(server, stopsMapping);

// Start receiving messages on stdin and sending messages on stdout
const transport = new StdioServerTransport();
await server.connect(transport);