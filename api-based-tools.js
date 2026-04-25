import { z } from "zod";
import { formatArrivals } from "./formatters.js";

export default function apiBasedTools(server, stopsMapping) {
  const API_BASE_URL = "https://glo6ir56yyjdlmdtig4ztnqu7q0dcwlz.lambda-url.eu-central-1.on.aws/api";

  // Helper function to make HTTP requests
  async function makeRequest(method, url, data = null, options = {}) {
    const config = {
      method,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    };

    // Merge other options except headers (which we already handled)
    const { headers: _, ...otherOptions } = options;
    Object.assign(config, otherOptions);

    if (data) {
      config.body = JSON.stringify(data);
    }

    try {
      const response = await fetch(url, config);
      const result = await response.text();

      let jsonResult;
      try {
        jsonResult = JSON.parse(result);
      } catch {
        jsonResult = result;
      }

      return {
        status: response.status,
        data: jsonResult,
        headers: Object.fromEntries(response.headers.entries()),
      };
    } catch (error) {
      return {
        status: 0,
        error: error.message,
      };
    }
  }

  server.registerTool(
    "bus-arrivals",
    {
      title: "Bus Arrivals",
      description: "Get a list of bus arrivals for a bus stop name",
      inputSchema: {
        bus_stop_name: z
          .string()
          .describe("Search by bus stop name (partial match)"),
      },
    },
    async (params) => {
      const { bus_stop_name } = params;

      if (!stopsMapping) {
        return {
          content: [{ type: "text", text: "Stops mapping data is not available." }],
          isError: true,
        };
      }

      // Find the stop IDs based on the bus stop name (partial match)
      const matchingStops = Object.values(stopsMapping).filter((stop) =>
        stop.name.toLowerCase().includes(bus_stop_name.toLowerCase())
      );

      if (matchingStops.length === 0) {
        return {
          content: [{ type: "text", text: `No stops found matching "${bus_stop_name}".` }],
        };
      }

      // Limit to top 3 matches to avoid overwhelming the API or output
      const stopsToFetch = matchingStops.slice(0, 3);

      const results = await Promise.all(
        stopsToFetch.map(async (stop) => {
          const url = `${API_BASE_URL}/json/GetTiemposParada/es/${stop.id}/${stop.lineId}/${stop.zoneId}`;
          const result = await makeRequest("GET", url);
          
          return {
            stopName: stop.name,
            stopId: stop.id,
            arrivals: formatArrivals(result.data)
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
    }
  );
}
