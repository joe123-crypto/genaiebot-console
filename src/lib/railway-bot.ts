import "server-only";
import { RAILWAY_PROVISIONING, type RailwayProvisioning } from "@/src/config";
import { RailwayError, asString, field, railwayRequest } from "./railway-api";

/**
 * The Railway calls creating and removing a bot make, in this feature's
 * vocabulary.
 *
 * Each one checks the answer it gets rather than trusting the shape: an answer
 * we cannot read is a `RailwayError`, not a value carried forward into the next
 * step. Every field asked for is one this feature uses.
 *
 * The settings come from `RAILWAY_PROVISIONING`, which is null unless the whole
 * environment is set, so a provisioner can never run half-configured.
 */

function settings(): RailwayProvisioning {
  if (!RAILWAY_PROVISIONING) {
    throw new RailwayError("This console is not set up to create bots. Ask whoever runs it to finish configuring it.");
  }
  return RAILWAY_PROVISIONING;
}

/** A service's name is also how a run recognises its own work after a crash. */
export function serviceName(workspaceId: string): string {
  return `bot-${workspaceId}`;
}

export type RailwayService = { id: string; name: string };

/**
 * Every service in the project, by id and name.
 *
 * A service whose id or name cannot be read fails the whole answer rather than
 * being skipped. Both callers act on absence -- the provisioner creates what it
 * does not find, the teardown leaves alone what it does not find -- so an entry
 * we could not read must never look like one that is not there.
 */
export async function listServices(): Promise<RailwayService[]> {
  const config = settings();
  const document = `query($projectId: String!) {
    project(id: $projectId) { services { edges { node { id name } } } }
  }`;
  return railwayRequest(config.token, document, { projectId: config.projectId }, (data) => {
    const edges = field(field(field(data, "project"), "services"), "edges");
    if (!Array.isArray(edges)) return null;
    const services: RailwayService[] = [];
    for (const edge of edges) {
      const node = field(edge, "node");
      const id = asString(field(node, "id"));
      const name = asString(field(node, "name"));
      if (!id || !name) return null;
      services.push({ id, name });
    }
    return services;
  });
}

/**
 * The id of the service with this name, if the project already has one.
 *
 * This is the guard against an orphan. A run records every id the moment
 * Railway hands it over, but a crash between the call returning and that write
 * would leave a service nobody has written down. Asking by name first means the
 * next attempt adopts it instead of creating a second one.
 */
export async function findService(name: string): Promise<string | null> {
  return (await listServices()).find((service) => service.name === name)?.id ?? null;
}

/**
 * A new service for this workspace's bot, WITHOUT a source.
 *
 * Deliberately sourceless: a `serviceCreate` that names an image deploys
 * immediately -- measured, not assumed -- which would boot the bot before its
 * volume is mounted and before it holds any of its config. So the source is set
 * last, by `setServiceSource`, and that is the one deploy.
 *
 * `GENAIE_WORKSPACE_ID` is set here all the same, so the service says whose it
 * is from its first instant, independently of its name. The rest of the
 * variables wait: they include the bot's own domain, which does not exist yet.
 */
export async function createService(workspaceId: string): Promise<string> {
  const config = settings();
  const document = `mutation($input: ServiceCreateInput!) {
    serviceCreate(input: $input) { id }
  }`;
  const input: Record<string, unknown> = {
    projectId: config.projectId,
    environmentId: config.environmentId,
    name: serviceName(workspaceId),
    variables: { GENAIE_WORKSPACE_ID: workspaceId },
  };
  return railwayRequest(config.token, document, { input }, (data) =>
    asString(field(field(data, "serviceCreate"), "id")));
}

/**
 * Give the service its image, and with it its first deployment.
 *
 * The region is set here too, and it is not cosmetic: the volume is pinned to
 * one region, and a service left to deploy elsewhere could not mount it.
 */
export async function setServiceSource(serviceId: string): Promise<void> {
  const config = settings();
  const document = `mutation($environmentId: String!, $serviceId: String!, $input: ServiceInstanceUpdateInput!) {
    serviceInstanceUpdate(environmentId: $environmentId, serviceId: $serviceId, input: $input)
  }`;
  const input: Record<string, unknown> = {
    source: { image: config.image }, region: config.region, numReplicas: 1,
  };
  if (config.registry) input.registryCredentials = config.registry;
  await railwayRequest(config.token, document,
    { environmentId: config.environmentId, serviceId, input }, (data) =>
      field(data, "serviceInstanceUpdate") === true ? true : null);
}

/**
 * The newest deployment this service has, or null when it has none yet.
 *
 * Setting the source starts a deployment but answers only `true`, so this is
 * how the run learns which deployment to watch. Null is not a failure: the next
 * poll looks again.
 */
export async function readLatestDeployment(serviceId: string): Promise<string | null> {
  const config = settings();
  const document = `query($serviceId: String!) {
    service(id: $serviceId) { deployments { edges { node { id createdAt } } } }
  }`;
  return railwayRequest(config.token, document, { serviceId }, (data) => {
    const edges = field(field(field(data, "service"), "deployments"), "edges");
    if (!Array.isArray(edges)) return null;
    let newest: { id: string; at: number } | null = null;
    for (const edge of edges) {
      const node = field(edge, "node");
      const id = asString(field(node, "id"));
      const at = Date.parse(String(field(node, "createdAt") ?? ""));
      if (!id || Number.isNaN(at)) continue;
      if (!newest || at > newest.at) newest = { id, at };
    }
    return { id: newest?.id ?? null } as { id: string | null };
  }).then((found) => found.id);
}

/** The bot's state volume. It must exist before the deploy that counts, or the
 *  bot boots with nowhere durable to keep its WhatsApp session. */
export async function createVolume(serviceId: string): Promise<string> {
  const config = settings();
  const document = `mutation($input: VolumeCreateInput!) {
    volumeCreate(input: $input) { id }
  }`;
  const input = {
    projectId: config.projectId, environmentId: config.environmentId, serviceId,
    mountPath: config.mountPath, region: config.region,
  };
  return railwayRequest(config.token, document, { input }, (data) =>
    asString(field(field(data, "volumeCreate"), "id")));
}

/** The address the console will reach this bot at. */
export async function createDomain(serviceId: string): Promise<{ id: string; domain: string }> {
  const config = settings();
  const document = `mutation($input: ServiceDomainCreateInput!) {
    serviceDomainCreate(input: $input) { id domain }
  }`;
  const input = { environmentId: config.environmentId, serviceId, targetPort: config.port };
  return railwayRequest(config.token, document, { input }, (data) => {
    const created = field(data, "serviceDomainCreate");
    const id = asString(field(created, "id"));
    const domain = asString(field(created, "domain"));
    return id && domain ? { id, domain } : null;
  });
}

/**
 * The template service's variables, as the values a new bot needs.
 *
 * `unrendered` is deliberately off: a rendered value is the literal the new
 * service needs, where a reference to another service would not resolve in its
 * own right. A sealed variable comes back with no value at all -- that is not an
 * error here, it is something the caller checks for before anything is built.
 */
export async function readTemplateVariables(): Promise<Record<string, string>> {
  const config = settings();
  const document = `query($projectId: String!, $environmentId: String!, $serviceId: String!) {
    variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId)
  }`;
  return railwayRequest(config.token, document, {
    projectId: config.projectId, environmentId: config.environmentId,
    serviceId: config.templateServiceId,
  }, (data) => {
    const variables = field(data, "variables");
    if (!variables || typeof variables !== "object" || Array.isArray(variables)) return null;
    const kept: Record<string, string> = {};
    for (const [name, value] of Object.entries(variables as Record<string, unknown>)) {
      if (typeof value === "string") kept[name] = value;
    }
    return kept;
  });
}

/**
 * Put the whole variable set on the new service.
 *
 * `replace` so the service holds exactly this set and nothing survives from the
 * image or an earlier attempt -- `GENAIE_ASSET_KEY_PREFIX` must be absent, and
 * absent is not something a merge can express. `skipDeploys` because the deploy
 * is triggered once, afterwards, deliberately.
 */
export async function writeVariables(serviceId: string, variables: Record<string, string>): Promise<void> {
  const config = settings();
  const document = `mutation($input: VariableCollectionUpsertInput!) {
    variableCollectionUpsert(input: $input)
  }`;
  const input = {
    projectId: config.projectId, environmentId: config.environmentId, serviceId,
    variables, replace: true, skipDeploys: true,
  };
  await railwayRequest(config.token, document, { input }, (data) =>
    field(data, "variableCollectionUpsert") === true ? true : null);
}

export async function deployService(serviceId: string): Promise<string> {
  const config = settings();
  const document = `mutation($environmentId: String!, $serviceId: String!) {
    serviceInstanceDeployV2(environmentId: $environmentId, serviceId: $serviceId)
  }`;
  return railwayRequest(config.token, document, { environmentId: config.environmentId, serviceId }, (data) =>
    asString(field(data, "serviceInstanceDeployV2")));
}

/**
 * Where a deployment has got to. The whole `DeploymentStatus` enum is sorted by
 * the caller: this only reports what Railway said, and refuses a value that is
 * not a string so an unreadable answer cannot be mistaken for a status.
 */
export async function readDeploymentStatus(deploymentId: string): Promise<string> {
  const config = settings();
  const document = `query($id: String!) { deployment(id: $id) { status } }`;
  return railwayRequest(config.token, document, { id: deploymentId }, (data) =>
    asString(field(field(data, "deployment"), "status")));
}

/**
 * One volume as the configured environment holds it.
 *
 * Read per environment, not from the project's `volumes`: a deleted volume
 * stays in the project-wide list for days, and only its instance says it is
 * going (`isPendingDeletion`). `serviceId` is null once the service it was
 * mounted on has been deleted -- measured against the live API -- which is why
 * a teardown reads these BEFORE it deletes the service.
 */
export type VolumeInstance = { volumeId: string; serviceId: string | null; pendingDeletion: boolean };

export async function listVolumeInstances(): Promise<VolumeInstance[]> {
  const config = settings();
  const document = `query($environmentId: String!) {
    environment(id: $environmentId) { volumeInstances { edges { node { volumeId serviceId isPendingDeletion } } } }
  }`;
  return railwayRequest(config.token, document, { environmentId: config.environmentId }, (data) => {
    const edges = field(field(field(data, "environment"), "volumeInstances"), "edges");
    if (!Array.isArray(edges)) return null;
    const volumes: VolumeInstance[] = [];
    for (const edge of edges) {
      const node = field(edge, "node");
      const volumeId = asString(field(node, "volumeId"));
      const serviceId = field(node, "serviceId");
      const pending = field(node, "isPendingDeletion");
      // Unreadable is not "nobody's": the same rule as `listServices`.
      if (!volumeId || typeof pending !== "boolean") return null;
      if (serviceId !== null && !asString(serviceId)) return null;
      volumes.push({ volumeId, serviceId: serviceId as string | null, pendingDeletion: pending });
    }
    return volumes;
  });
}

/**
 * Delete a bot's service in the configured environment, which stops it and
 * takes its domain with it. Railway deletes the service itself once no
 * environment has an instance of it, and a provisioned bot only ever has this
 * one. Its volume is NOT deleted by this (`docs/provision-bot.md`).
 */
export async function deleteService(serviceId: string): Promise<void> {
  const config = settings();
  const document = `mutation($id: String!, $environmentId: String) {
    serviceDelete(id: $id, environmentId: $environmentId)
  }`;
  await railwayRequest(config.token, document, { id: serviceId, environmentId: config.environmentId }, (data) =>
    field(data, "serviceDelete") === true ? true : null);
}

/**
 * Delete a volume. Railway answers at once but keeps the volume for a few days
 * before erasing it; until then its instance reports `isPendingDeletion`.
 */
export async function deleteVolume(volumeId: string): Promise<void> {
  const config = settings();
  const document = `mutation($volumeId: String!) { volumeDelete(volumeId: $volumeId) }`;
  await railwayRequest(config.token, document, { volumeId }, (data) =>
    field(data, "volumeDelete") === true ? true : null);
}
