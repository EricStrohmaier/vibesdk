import { SandboxSdkClient } from "./sandboxSdkClient";
import { RemoteSandboxServiceClient } from "./remoteSandboxService";
import { LocalSandboxService } from "./localSandboxService";
import { BaseSandboxService } from "./BaseSandboxService";
import { env } from 'cloudflare:workers'

export function getSandboxService(sessionId: string, agentId: string): BaseSandboxService {
    if (env.SANDBOX_SERVICE_TYPE == 'runner') {
        console.log("[getSandboxService] Using runner service for sandboxing");
        return new RemoteSandboxServiceClient(sessionId);
    }

    if (env.ENVIRONMENT === 'dev' || env.ENVIRONMENT === 'development' || env.ENVIRONMENT === 'local') {
        console.log("[getSandboxService] Using local sandbox service for dev mode");
        return new LocalSandboxService(sessionId);
    }

    console.log("[getSandboxService] Using sandboxsdk service for sandboxing");
    return new SandboxSdkClient(sessionId, agentId);
}
