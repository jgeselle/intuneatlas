// IntuneAtlas on Azure Container Apps — the shared web UI, on HTTPS, with its data on a file share.
//
// This file is the source. The "Deploy to Azure" button needs plain ARM JSON, so azuredeploy.json
// beside it is this file compiled:  bicep build main.bicep --outfile azuredeploy.json
// (CI fails if the two drift apart).
//
// What it creates, all in one resource group:
//   - a Container Apps environment and one container app, reachable on its own https://…azurecontainerapps.io
//   - a storage account with a file share, mounted at /data — scans, notes, staged changes, baselines
//   - a Log Analytics workspace for the container's output
//
// What it can't create: the Entra app registration people sign in through. Register it first (see
// intuneatlas.com/docs), pass its client ID here, then add the `redirectUri` this deployment outputs
// to that registration.

@description('Name of the container app. It becomes the first part of the address.')
@minLength(2)
@maxLength(32)
param name string = 'intuneatlas'

@description('Azure region. Defaults to the resource group\'s.')
param location string = resourceGroup().location

@description('The Entra tenant people sign in to — a tenant ID or domain. Defaults to the tenant this subscription belongs to.')
param tenantId string = subscription().tenantId

@description('Application (client) ID of the Entra app registration IntuneAtlas signs in with.')
@minLength(36)
@maxLength(36)
param clientId string

@description('Keep one instance running at all times. Turned off, the app stops after a few idle minutes and costs next to nothing, but the first visit afterwards waits for it to start and everyone signs in again.')
param alwaysOn bool = true

@description('The container image to run.')
param image string = 'ghcr.io/jgeselle/intuneatlas:latest'

var suffix = uniqueString(resourceGroup().id, name)
var shareName = 'data'
var mountName = 'data'

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${name}-logs'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  // 3–24 lowercase letters and digits, unique across Azure.
  name: 'atlas${suffix}'
  location: location
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
  }

  resource files 'fileServices' = {
    name: 'default'

    resource share 'shares' = {
      name: shareName
      properties: { shareQuota: 5 }
    }
  }
}

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${name}-env'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
  }

  resource data 'storages' = {
    name: mountName
    properties: {
      azureFile: {
        accountName: storage.name
        accountKey: storage.listKeys().keys[0].value
        shareName: shareName
        accessMode: 'ReadWrite'
      }
    }
    dependsOn: [storage::files::share]
  }
}

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: name
  location: location
  properties: {
    managedEnvironmentId: environment.id
    configuration: {
      activeRevisionsMode: 'Single'
      // HTTPS on the app's own hostname, terminated by the platform; the container itself speaks plain HTTP on 7878.
      ingress: {
        external: true
        targetPort: 7878
        transport: 'auto'
        allowInsecure: false
      }
    }
    template: {
      containers: [
        {
          name: 'intuneatlas'
          image: image
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            { name: 'INTUNEATLAS_TENANT_ID', value: tenantId }
            { name: 'INTUNEATLAS_CLIENT_ID', value: clientId }
          ]
          volumeMounts: [
            { volumeName: mountName, mountPath: '/data' }
          ]
        }
      ]
      // Never more than one: the data is a SQLite file, and sign-in sessions live in the process.
      scale: {
        minReplicas: alwaysOn ? 1 : 0
        maxReplicas: 1
      }
      volumes: [
        {
          name: mountName
          storageType: 'AzureFile'
          storageName: environment::data.name
          // nobrl: SQLite's byte-range locks aren't honoured on an SMB share and fail as "database is
          // locked" — with a single instance they aren't needed. uid/gid: the image runs as user 1000.
          mountOptions: 'nobrl,uid=1000,gid=1000,dir_mode=0700,file_mode=0600'
        }
      ]
    }
  }
}

@description('Where the app is running.')
output url string = 'https://${app.properties.configuration.ingress.fqdn}'

@description('Add this to the app registration: Authentication → Mobile and desktop applications → custom redirect URI.')
output redirectUri string = 'https://${app.properties.configuration.ingress.fqdn}/auth/callback'
