import { createRequire } from "node:module";
import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";
const require = createRequire(import.meta.url);
const baseOptions: pino.LoggerOptions = {
  name: "spira",
  level: isProduction ? "info" : "debug",
  serializers: {
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err,
  },
};

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
  const options: pino.LoggerOptions = {
    ...baseOptions,
    name,
    level: "debug",
  };

  return transport
    ? pino(options, transport)
    : pino({
        ...baseOptions,
        name,
      });
};

const logger = createLogger("backend");

export default logger;
export { logger };
