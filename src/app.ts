import 'dotenv/config';
import Fastify, { FastifyInstance, FastifyServerOptions } from "fastify";
import cors from "@fastify/cors";
import { readdirSync } from "node:fs";
import path from "node:path";

export interface AppOptions extends FastifyServerOptions {}

const options: AppOptions = {
  routerOptions: {
    ignoreTrailingSlash: true,
  },
  logger: {
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "HH:MM:ss",
        singleLine: false,
        ignore: "pid,hostname,reqId,responseTime,level",
      },
    },
  },
};

const app: FastifyInstance = Fastify(options);

app.register(cors, {
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  credentials: true,
});

app.setErrorHandler((error, request, reply) => {
  const err = error as any;
  const code = Number(err.statusCode) || 500;

  if (code >= 400 && code < 500) {
    request.log.info(err);
  } else {
    request.log.error(err);
  }

  return reply.code(err.statusCode || 500).send({
    error: true,
    message: err.message || "Internal Server Error",
    details: err.error || {},
  });
});

const dirs = ["./routes"];

for (const dir of dirs) {
  for (const file of readdirSync(path.join(__dirname, dir))) {
    if (file.endsWith(".ts") || file.endsWith(".js")) {
      app.register(require(path.join(__dirname, dir, file)));
    }
  }
}
// Minimal test route for diagnostics
app.get("/test", async (request, reply) => {
  return { message: "Test route works" };
});

export default app;
export { app, options };
