/** Configuración por entorno (12-factor). Los secretos llegan por variables inyectadas desde Secrets Manager. */
export interface AppConfig {
  port: number;
  databaseUrl: string;
  queueUrl: string | undefined;
  awsRegion: string;
  awsEndpoint: string | undefined; // LocalStack en desarrollo
  schemasDir: string;
  version: string;
}

export const APP_CONFIG = Symbol('APP_CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL es obligatorio');
  return {
    port: Number(env.PORT ?? 3000),
    databaseUrl,
    queueUrl: env.SQS_QUEUE_URL,
    awsRegion: env.AWS_REGION ?? 'us-east-1',
    awsEndpoint: env.AWS_ENDPOINT_URL,
    schemasDir: env.SCHEMAS_DIR ?? `${__dirname}/../../../../data/schemas`,
    version: env.APP_VERSION ?? '0.1.0',
  };
}
