/** Configuración por entorno (12-factor). Los secretos llegan por variables inyectadas desde Secrets Manager. */
export interface AppConfig {
  port: number;
  databaseUrl: string;
  queueUrl: string | undefined;
  awsRegion: string;
  awsEndpoint: string | undefined; // LocalStack en desarrollo
  importsBucket: string | undefined;
  exportsBucket: string | undefined;
  cognitoIssuer: string | undefined;
  cognitoUserPoolId: string | undefined; // alta de cuentas e invitaciones por correo
  schemasDir: string;
  version: string;
}

export const APP_CONFIG = Symbol('APP_CONFIG');

/** DATABASE_URL en local; en ECS llegan PGHOST/PGUSER/PGPASSWORD… desde Secrets Manager (terraform/modules/compute). */
function databaseUrlFrom(env: NodeJS.ProcessEnv): string {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  const { PGHOST, PGPORT = '5432', PGDATABASE, PGUSER, PGPASSWORD, PGSSLMODE = 'require' } = env;
  if (!PGHOST || !PGDATABASE || !PGUSER || !PGPASSWORD) {
    throw new Error('Defina DATABASE_URL o PGHOST, PGDATABASE, PGUSER y PGPASSWORD');
  }
  const auth = `${encodeURIComponent(PGUSER)}:${encodeURIComponent(PGPASSWORD)}`;
  return `postgresql://${auth}@${PGHOST}:${PGPORT}/${PGDATABASE}?sslmode=${PGSSLMODE}`;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const databaseUrl = databaseUrlFrom(env);
  return {
    port: Number(env.PORT ?? 3000),
    databaseUrl,
    queueUrl: env.SQS_QUEUE_URL,
    awsRegion: env.AWS_REGION ?? 'us-east-1',
    awsEndpoint: env.AWS_ENDPOINT_URL,
    importsBucket: env.IMPORTS_BUCKET,
    exportsBucket: env.EXPORTS_BUCKET,
    cognitoIssuer: env.COGNITO_ISSUER,
    cognitoUserPoolId: env.COGNITO_USER_POOL_ID,
    schemasDir: env.SCHEMAS_DIR ?? `${__dirname}/../../../../data/schemas`,
    version: env.APP_VERSION ?? '0.1.0',
  };
}
