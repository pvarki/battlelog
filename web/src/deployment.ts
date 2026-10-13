// ponytail: assumes PVARKI's naming (battlelog.<deployment> → synapse.<deployment>, tak.<deployment>);
// replace with a server-provided URL if a deployment ever breaks the pattern.
export const deploymentForHost = (hostname: string): string =>
  hostname
    .replace(/^mtls\./, "")
    .split(".")
    .slice(1)
    .join(".");

/** The PVARKI deployment we belong to: from VITE_PVARKI_DEPLOYMENT in dev, else our own host. */
export const pvarkiDeployment = (): string =>
  import.meta.env.VITE_PVARKI_DEPLOYMENT || deploymentForHost(window.location.hostname);
