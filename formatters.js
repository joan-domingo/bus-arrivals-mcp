/**
 * Formats the raw bus arrival data into a clean, LLM-friendly structure.
 * 
 * @param {Array} rawData - The raw JSON response from the bus arrivals API.
 * @returns {Array} A simplified list of upcoming arrivals.
 */
export function formatArrivals(rawData) {
  if (!Array.isArray(rawData)) return [];

  const formattedResults = [];

  rawData.forEach((line) => {
    const lineName = line.desc_linea;
    const lineId = line.idLinea;

    if (line.trayectos) {
      Object.entries(line.trayectos).forEach(([direction, arrivalsMap]) => {
        Object.values(arrivalsMap).forEach((arrival) => {
          formattedResults.push({
            line: lineName,
            lineId: lineId,
            destination: direction,
            arrivalIn: arrival.minutos.replace(/''/g, '"').replace(/'/g, "'"), // Clean up format
            estimatedTime: arrival.hora,
            timeStatus: arrival.real === "S" ? "Real-time" : "Scheduled",
          });
        });
      });
    }
  });

  // Sort by arrival time (closest first)
  // Note: Since 'minutos' is a string like "03' 00''", we extract the leading digits for sorting.
  return formattedResults.sort((a, b) => {
    const timeA = parseInt(a.arrivalIn) || 0;
    const timeB = parseInt(b.arrivalIn) || 0;
    return timeA - timeB;
  });
}
