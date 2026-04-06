import { createRequire } from "node:module";
import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";
const require = createRequire(import.meta.url);

const createTransport = () => {
  if (isProduction) {
    return undefined;
  }

  try {
    require.resolve("pino-pretty");
    return pino.transport({
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:standard",
      },
    });
  } catch {
    return undefined;
  }
};

export const createLogger = (name: string) => {
  const transport = createTransport();

  return transport
    ? pino(
        {
          name,
          level: "debug",
        },
        transport,
      )
    : pino({
        name,
        level: isProduction ? "info" : "debug",
      });
};

const logger = createLogger("backend");

export default logger;
export { logger };
