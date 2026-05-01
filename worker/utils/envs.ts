function normalizeEnvValue(value: string | undefined): string {
    return (value ?? '').replace(/^["']|["']$/g, '').trim();
}

export function isProd(env: Env) {
    const val = normalizeEnvValue(env.ENVIRONMENT);
    return val === 'prod' || val === 'production';
}

export function isDev(env: Env) {
    const val = normalizeEnvValue(env.ENVIRONMENT);
    return val === 'dev' || val === 'development' || val === 'local';
}
