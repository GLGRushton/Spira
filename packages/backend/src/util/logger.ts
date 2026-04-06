import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const createLogger = (name: string) =>
  pino({
    name,
    level: process.env.LOG_LEVEL ?? "info",
    transport: isProduction
      ? undefined
      : {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
          },
        },
  });

const logger = createLogger("backend");

export default logger;
export { logger };
