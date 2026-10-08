# IntuneAtlas on Azure

The shared web UI as an Azure Container App: its own HTTPS address, everyone
signing in with their own Microsoft account, data kept on a file share.

[![Deploy to Azure](https://aka.ms/deploytoazurebutton)](https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2Fjgeselle%2Fintuneatlas%2Fmain%2Finfra%2Fazure%2Fazuredeploy.json)

## Steps

1. **Register the Entra app** as described in the
   [getting started guide](https://intuneatlas.com/docs/#register-app), if you
   haven't. Skip the redirect URIs for now; you need the Application (client)
   ID.
2. **Deploy.** Click the button, pick a resource group and paste the client
   ID. The tenant defaults to the one the subscription belongs to.
3. **Add the redirect URI.** When the deployment finishes, open its
   **Outputs** and copy `redirectUri`. In the app registration:
   **Authentication → Add a platform → Mobile and desktop applications →
   Custom redirect URI**, paste it, save.
4. **Open `url`** from the same outputs, sign in, and click **Scan now**.

From the command line instead of the button:

```sh
az group create --name intuneatlas --location westeurope
az deployment group create --resource-group intuneatlas \
  --template-file infra/azure/main.bicep \
  --parameters clientId=<application-id>
```

## What it creates

| Resource | For |
|---|---|
| Container app (0.5 vCPU, 1 GiB, one instance) | The app, on `https://<name>.<random>.<region>.azurecontainerapps.io` |
| Container Apps environment | Required by the container app |
| Storage account with a 5 GiB file share | Everything the app keeps: scans, notes, staged changes, baselines |
| Log Analytics workspace | The container's output, kept 30 days |

No secrets are passed in and none are created for sign-in: people sign in
with their own accounts, and what they may do follows the app roles on the
registration.

## Parameters

| Parameter | Default | |
|---|---|---|
| `clientId` | — | Application (client) ID of your app registration |
| `tenantId` | the subscription's tenant | Tenant people sign in to |
| `name` | `intuneatlas` | Name of the container app, and the start of its address |
| `location` | the resource group's | Azure region |
| `alwaysOn` | `true` | Keep one instance running. Off, the app stops when idle and costs next to nothing, but the next visit waits for it to start and everyone signs in again |
| `image` | `ghcr.io/jgeselle/intuneatlas:latest` | Image to run; pin a version tag to control updates |

## Good to know

- **One instance, by design.** The data is a SQLite file and sign-in sessions
  live in the process, so the app never scales beyond one.
- **Updating.** With the default `latest` tag, restart the app's revision to
  pull a newer image; with a pinned tag, redeploy with the new one. The data
  on the file share is untouched either way.
- **Removing it.** Delete the resource group. That deletes the file share and
  everything on it.
- **The file share is mounted with `nobrl`.** SQLite's file locks aren't
  honoured on an SMB share and would fail as "database is locked"; with a
  single instance they aren't needed.
- **`main.bicep` is the source**, `azuredeploy.json` is that file compiled
  (`bicep build main.bicep --outfile azuredeploy.json`) because the button
  can only read JSON. CI fails if they differ.
