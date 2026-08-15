import * as z from "zod";
import type { LevelWithSilentOrString } from "pino";
import { exit } from "process";

const envSchema = z.object({
  DATABASE_URL: z.string(),
  DB_USERNAME: z.string(),
  DB_PASSWORD: z.string(),
  DB_NAME: z.string(),
  DB_PORT: z.string(),
  // TODO: figure out a way to import from pino definition file
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("debug")
});

export type env = z.infer<typeof envSchema>;

let envVariables: env;
try {
  envVariables = envSchema.parse(process.env);
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error(error.issues);
  }
  else {
    console.error("Something went wrong while reading the environment variables...", error);
  }
  exit(-1);
}

export default envVariables;
